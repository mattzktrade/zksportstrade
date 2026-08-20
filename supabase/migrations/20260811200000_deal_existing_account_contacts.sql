-- Phase 2A follow-up: create deals against existing CRM accounts/contacts.
-- Additive only; preserves the earlier free-text compatibility RPC.

-- Backfill one primary CRM contact for each approved portal agent account.
insert into public.crm_contacts (
  account_id,
  full_name,
  email,
  phone,
  is_primary,
  portal_profile_id,
  created_at,
  updated_at
)
select
  a.id,
  coalesce(nullif(btrim(p.full_name), ''), p.email),
  p.email,
  p.mobile,
  true,
  p.id,
  timezone('utc', now()),
  timezone('utc', now())
from public.crm_accounts a
join public.profiles p on p.id = a.portal_profile_id
where p.role = 'agent'
  and p.approval_status = 'approved'
  and not exists (
    select 1
    from public.crm_contacts c
    where c.account_id = a.id
      and (
        c.portal_profile_id = p.id
        or (
          c.email is not null
          and lower(btrim(c.email)) = lower(btrim(p.email))
        )
      )
  );

create or replace function public.admin_create_deal_with_existing_links(
  p_account_id uuid,
  p_contact_id uuid default null,
  p_package_id text default null,
  p_quantity int default 1,
  p_unit_sale_price numeric default null,
  p_source text default 'offline',
  p_stage text default 'draft',
  p_notes text default null,
  p_reserve boolean default false
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
  v_qty int;
  v_price numeric;
  v_ref text;
  v_reservation_id uuid;
  v_available int;
  v_held int;
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

  if p_package_id is not null then
    select p.id, p.race_id, p.trade_price, p.currency, p.inventory_pool_id
    into v_package
    from public.packages p
    where p.id = btrim(p_package_id)
      and p.shell_parent_package_id is null
      and p.is_hidden = false;

    if v_package.id is null then
      raise exception 'package_not_found';
    end if;
  end if;

  v_qty := greatest(1, coalesce(p_quantity, 1));
  v_price := coalesce(p_unit_sale_price, v_package.trade_price, 0);
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
    v_package.race_id,
    coalesce(nullif(btrim(p_source), ''), 'offline'),
    coalesce(nullif(btrim(p_stage), ''), 'draft'),
    coalesce(v_package.currency, 'USD'),
    case when v_package.id is null then 0 else v_price * v_qty end,
    nullif(btrim(p_notes), ''),
    auth.uid()
  )
  returning id into v_deal_id;

  if v_package.id is not null then
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
    'Deal created against existing CRM account/contact',
    jsonb_build_object(
      'reference', v_ref,
      'account_id', p_account_id,
      'contact_id', p_contact_id,
      'package_id', v_package.id,
      'quantity', v_qty,
      'reserved', coalesce(p_reserve, false)
    )
  );

  return v_deal_id;
end;
$$;

revoke all on function public.admin_create_deal_with_existing_links(
  uuid, uuid, text, int, numeric, text, text, text, boolean
) from public;
grant execute on function public.admin_create_deal_with_existing_links(
  uuid, uuid, text, int, numeric, text, text, text, boolean
) to authenticated;

