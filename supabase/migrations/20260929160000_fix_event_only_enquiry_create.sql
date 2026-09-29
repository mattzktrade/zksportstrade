-- The first event-only create function still mentioned the package record in
-- expressions that run even when no package was chosen. Postgres then refused
-- to save the enquiry. Copy the package fields into plain variables first.

create or replace function public.admin_create_deal_with_existing_links(
  p_account_id uuid,
  p_contact_id uuid default null,
  p_package_id text default null,
  p_quantity int default 1,
  p_unit_sale_price numeric default null,
  p_source text default 'offline',
  p_stage text default 'draft',
  p_notes text default null,
  p_reserve boolean default false,
  p_race_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal_id uuid;
  v_line_id uuid;
  v_package record;
  v_has_package boolean := false;
  v_qty int;
  v_price numeric;
  v_ref text;
  v_reservation_id uuid;
  v_available int;
  v_held int;
  v_race_id text;
  v_currency text := 'USD';
  v_package_id text;
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1 from public.crm_accounts a
    where a.id = p_account_id and a.active = true
  ) then
    raise exception 'account_not_found';
  end if;

  if p_contact_id is not null and not exists (
    select 1 from public.crm_contacts c
    where c.id = p_contact_id
      and c.account_id = p_account_id
      and c.active = true
  ) then
    raise exception 'contact_not_found_for_account';
  end if;

  v_qty := greatest(1, coalesce(p_quantity, 1));
  v_price := coalesce(p_unit_sale_price, 0);
  v_race_id := nullif(btrim(p_race_id), '');

  if nullif(btrim(p_package_id), '') is not null then
    select p.id, p.race_id, p.trade_price, p.currency, p.inventory_pool_id
    into v_package
    from public.packages p
    where p.id = btrim(p_package_id)
      and p.shell_parent_package_id is null;

    if v_package.id is null then
      raise exception 'package_not_found';
    end if;
    v_has_package := true;
    v_package_id := v_package.id;
    v_race_id := v_package.race_id;
    v_currency := coalesce(v_package.currency, 'USD');
    v_price := coalesce(p_unit_sale_price, v_package.trade_price, 0);
  end if;

  if not v_has_package and v_race_id is not null then
    if not exists (
      select 1
      from public.races r
      where r.id = v_race_id
        and coalesce(r.is_archived, false) = false
    ) then
      raise exception 'event_not_found';
    end if;
  end if;

  if v_price < 0 then
    raise exception 'invalid_price';
  end if;

  v_ref := 'D-' || to_char(timezone('utc', now()), 'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.deals (
    reference,
    account_id,
    primary_contact_id,
    owner_profile_id,
    race_id,
    source,
    stage,
    currency,
    total_amount,
    notes,
    created_by
  ) values (
    v_ref,
    p_account_id,
    p_contact_id,
    auth.uid(),
    v_race_id,
    coalesce(nullif(btrim(p_source), ''), 'offline'),
    coalesce(nullif(btrim(p_stage), ''), 'draft'),
    v_currency,
    case when v_has_package then v_price * v_qty else 0 end,
    nullif(btrim(p_notes), ''),
    auth.uid()
  )
  returning id into v_deal_id;

  if v_has_package then
    insert into public.deal_line_items (
      deal_id,
      package_id,
      quantity,
      unit_sale_price,
      currency,
      reservation_status
    ) values (
      v_deal_id,
      v_package.id,
      v_qty,
      v_price,
      coalesce(v_package.currency, 'USD'),
      'none'
    )
    returning id into v_line_id;

    if coalesce(p_reserve, false) then
      select coalesce(qty_available, 0), coalesce(qty_held, 0)
      into v_available, v_held
      from public.package_inventory
      where package_id = v_package.id
      for update;

      if not found then
        raise exception 'inventory_missing';
      end if;

      if (v_available - v_held) < v_qty then
        raise exception 'insufficient_stock';
      end if;

      update public.package_inventory
      set qty_held = v_held + v_qty
      where package_id = v_package.id;

      insert into public.inventory_reservations (
        package_id,
        pool_id,
        kind,
        quantity,
        status,
        deal_id,
        expires_at,
        created_by,
        note
      ) values (
        v_package.id,
        v_package.inventory_pool_id,
        'deal_reservation',
        v_qty,
        'active',
        v_deal_id,
        timezone('utc', now()) + interval '7 days',
        auth.uid(),
        'Reserved with deal creation'
      )
      returning id into v_reservation_id;

      update public.deal_line_items
      set reservation_id = v_reservation_id,
          reservation_status = 'active',
          updated_at = timezone('utc', now())
      where id = v_line_id;

      update public.deals
      set hold_expires_at = timezone('utc', now()) + interval '7 days',
          stage = case when stage = 'draft' then 'proposal' else stage end,
          updated_at = timezone('utc', now())
      where id = v_deal_id;

      perform public.admin_append_inventory_ledger(
        v_package.id,
        'reservation',
        -v_qty,
        'Deal reservation created',
        null,
        v_package.inventory_pool_id,
        'inventory_reservations',
        v_reservation_id::text,
        null,
        null,
        null,
        v_reservation_id,
        v_deal_id,
        jsonb_build_object('deal_reference', v_ref)
      );
    end if;
  end if;

  insert into public.deal_activities (
    deal_id, actor_profile_id, action, summary, metadata
  ) values (
    v_deal_id,
    auth.uid(),
    'deal_created',
    case
      when v_has_package then 'Deal created against existing CRM account/contact'
      else 'Enquiry created for an event'
    end,
    jsonb_build_object(
      'reference', v_ref,
      'account_id', p_account_id,
      'contact_id', p_contact_id,
      'package_id', v_package_id,
      'race_id', v_race_id,
      'quantity', case when v_has_package then v_qty else null end,
      'reserved', coalesce(p_reserve, false) and v_has_package
    )
  );

  return v_deal_id;
end;
$$;

notify pgrst, 'reload schema';
