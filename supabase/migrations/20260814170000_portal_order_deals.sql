-- Link committed portal/admin orders to CRM deals without creating a second
-- order or invoice. Portal checkout terms stand in for the booking form.
-- Existing unlinked orders are backfilled, then deal IDs are resequenced
-- so DL numbers stay chronological.

create unique index if not exists deals_order_id_unique_idx
  on public.deals (order_id)
  where order_id is not null;

create or replace function public.attach_deal_for_committed_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_invoice_status text;
  v_account_id uuid;
  v_contact_id uuid;
  v_deal_id uuid;
  v_account_name text;
  v_account_kind text;
  v_profile_id uuid;
  v_profile_email text;
  v_profile_name text;
  v_profile_company text;
  v_profile_phone text;
  v_profile_kind text;
  v_bill_line1 text;
  v_bill_line2 text;
  v_bill_city text;
  v_bill_postcode text;
  v_bill_country text;
  v_stage text;
  v_next_action text;
  v_source text;
  v_notes text;
  v_race_id text;
  v_line record;
  v_line_id uuid;
  v_sort int := 0;
  v_has_lines boolean := false;
  v_is_primary boolean;
begin
  if p_order_id is null then
    raise exception 'order_id_required';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'order_not_found';
  end if;

  if v_order.deal_id is not null then
    return v_order.deal_id;
  end if;

  if auth.uid() is not null
    and not public.is_cms_staff()
    and v_order.agent_profile_id is distinct from auth.uid()
  then
    raise exception 'forbidden';
  end if;

  select id into v_deal_id
  from public.deals
  where order_id = v_order.id
  limit 1;
  if v_deal_id is not null then
    update public.orders
    set deal_id = v_deal_id,
        crm_account_id = coalesce(crm_account_id, (select account_id from public.deals where id = v_deal_id)),
        crm_contact_id = coalesce(crm_contact_id, (select primary_contact_id from public.deals where id = v_deal_id))
    where id = v_order.id;
    return v_deal_id;
  end if;

  if coalesce(v_order.channel, 'trade_portal') in ('wix', 'native_deal') then
    return null;
  end if;

  select status into v_invoice_status
  from public.invoices
  where order_id = v_order.id
  order by created_at desc
  limit 1;

  if v_order.status = 'cancelled' then
    v_stage := 'cancelled';
    v_next_action := 'No action — closed';
  elsif v_invoice_status in ('paid', 'delivered') then
    v_stage := 'paid_confirmed';
    v_next_action := 'Hand over to fulfilment';
  elsif v_invoice_status = 'awaiting_payment' then
    v_stage := 'awaiting_payment';
    v_next_action := 'Follow up payment';
  else
    v_stage := 'awaiting_invoice';
    v_next_action := 'Invoice sending';
  end if;

  v_source := case
    when coalesce(v_order.channel, 'trade_portal') = 'admin' then 'offline'
    else 'portal'
  end;

  if v_order.crm_account_id is not null then
    v_account_id := v_order.crm_account_id;
  end if;
  if v_order.crm_contact_id is not null then
    v_contact_id := v_order.crm_contact_id;
  end if;

  if v_order.agent_profile_id is not null then
    select
      id,
      email,
      nullif(btrim(full_name), ''),
      nullif(btrim(company_name), ''),
      nullif(btrim(mobile), ''),
      nullif(btrim(company_type), ''),
      nullif(btrim(billing_address_line1), ''),
      nullif(btrim(billing_address_line2), ''),
      nullif(btrim(billing_city), ''),
      nullif(btrim(billing_postcode), ''),
      nullif(btrim(billing_country), '')
    into
      v_profile_id,
      v_profile_email,
      v_profile_name,
      v_profile_company,
      v_profile_phone,
      v_profile_kind,
      v_bill_line1,
      v_bill_line2,
      v_bill_city,
      v_bill_postcode,
      v_bill_country
    from public.profiles
    where id = v_order.agent_profile_id;
  end if;

  v_account_name := coalesce(
    v_profile_company,
    v_profile_name,
    nullif(btrim(v_order.client_name), ''),
    'Portal client'
  );

  v_account_kind := case
    when v_profile_kind in ('concierge', 'travel_agency', 'ticket_agent', 'hospitality_agency', 'other')
      then v_profile_kind
    else 'ticket_agent'
  end;

  if v_account_id is null and v_order.agent_profile_id is not null then
    select id into v_account_id
    from public.crm_accounts
    where portal_profile_id = v_order.agent_profile_id
    limit 1;
  end if;

  if v_account_id is null then
    begin
      insert into public.crm_accounts (
        name,
        account_type,
        account_types,
        email,
        phone,
        portal_profile_id,
        source,
        billing_address_line1,
        billing_address_line2,
        billing_city,
        billing_postcode,
        billing_country,
        created_by
      ) values (
        v_account_name,
        'agent_company',
        array[v_account_kind]::text[],
        coalesce(v_profile_email, nullif(btrim(v_order.client_email), '')),
        coalesce(v_profile_phone, nullif(btrim(v_order.client_phone), '')),
        v_order.agent_profile_id,
        'website',
        coalesce(v_bill_line1, nullif(btrim(v_order.billing_address_line1), '')),
        coalesce(v_bill_line2, nullif(btrim(v_order.billing_address_line2), '')),
        coalesce(v_bill_city, nullif(btrim(v_order.billing_city), '')),
        coalesce(v_bill_postcode, nullif(btrim(v_order.billing_postcode), '')),
        coalesce(v_bill_country, nullif(btrim(v_order.billing_country), '')),
        v_order.agent_profile_id
      )
      returning id into v_account_id;
    exception
      when unique_violation then
        select id into v_account_id
        from public.crm_accounts
        where lower(btrim(name)) = lower(v_account_name)
        limit 1;
        if v_account_id is not null and v_order.agent_profile_id is not null then
          update public.crm_accounts
          set portal_profile_id = coalesce(portal_profile_id, v_order.agent_profile_id),
              updated_at = timezone('utc', now())
          where id = v_account_id;
        end if;
    end;
  end if;

  if v_account_id is null then
    raise exception 'account_required_for_deal';
  end if;

  if v_contact_id is not null
    and not exists (
      select 1 from public.crm_contacts
      where id = v_contact_id and account_id = v_account_id
    )
  then
    v_contact_id := null;
  end if;

  if v_contact_id is null and v_profile_id is not null then
    select id into v_contact_id
    from public.crm_contacts
    where account_id = v_account_id
      and (
        portal_profile_id = v_profile_id
        or (v_profile_email is not null and lower(coalesce(email, '')) = lower(v_profile_email))
      )
    order by case when portal_profile_id = v_profile_id then 0 else 1 end, created_at
    limit 1;
  end if;

  if v_contact_id is null then
    v_is_primary := not exists (
      select 1 from public.crm_contacts where account_id = v_account_id and is_primary
    );
    insert into public.crm_contacts (
      account_id,
      full_name,
      email,
      phone,
      is_primary,
      portal_profile_id,
      created_by
    ) values (
      v_account_id,
      coalesce(v_profile_name, nullif(btrim(v_order.client_name), ''), v_account_name),
      coalesce(v_profile_email, nullif(btrim(v_order.client_email), '')),
      coalesce(v_profile_phone, nullif(btrim(v_order.client_phone), '')),
      v_is_primary,
      v_profile_id,
      v_order.agent_profile_id
    )
    returning id into v_contact_id;
  end if;

  v_notes := nullif(concat_ws(
    E'\n',
    case
      when nullif(btrim(v_order.client_name), '') is not null
        then 'End client: ' || btrim(v_order.client_name)
      else null
    end,
    case
      when nullif(btrim(v_order.client_email), '') is not null
        then 'End client email: ' || btrim(v_order.client_email)
      else null
    end,
    case
      when nullif(btrim(v_order.po_number), '') is not null
        then 'PO: ' || btrim(v_order.po_number)
      else null
    end,
    'Confirmed at checkout — terms accepted in place of a booking form.'
  ), '');

  select race_id into v_race_id
  from public.packages
  where id = v_order.package_id;

  insert into public.deals (
    account_id,
    primary_contact_id,
    owner_profile_id,
    race_id,
    source,
    stage,
    currency,
    total_amount,
    notes,
    next_action,
    created_by,
    created_at,
    updated_at,
    order_id,
    closed_at
  ) values (
    v_account_id,
    v_contact_id,
    null,
    v_race_id,
    v_source,
    v_stage,
    coalesce(v_order.currency, 'USD'),
    coalesce(v_order.total_amount, 0),
    v_notes,
    v_next_action,
    v_order.agent_profile_id,
    v_order.created_at,
    v_order.created_at,
    v_order.id,
    case when v_stage in ('paid_confirmed', 'cancelled') then v_order.created_at else null end
  )
  returning id into v_deal_id;

  for v_line in
    select *
    from public.order_line_items
    where order_id = v_order.id
    order by sort_order, created_at
  loop
    insert into public.deal_line_items (
      deal_id,
      package_id,
      quantity,
      unit_sale_price,
      currency,
      sourcing_mode,
      reservation_status,
      sort_order
    ) values (
      v_deal_id,
      v_line.package_id,
      v_line.quantity,
      v_line.unit_price,
      coalesce(v_line.currency, v_order.currency, 'USD'),
      coalesce(v_line.sourcing_mode, 'owned'),
      'none',
      v_sort
    )
    returning id into v_line_id;
    update public.order_line_items
    set deal_line_item_id = coalesce(deal_line_item_id, v_line_id)
    where id = v_line.id;
    v_sort := v_sort + 1;
    v_has_lines := true;
  end loop;

  if not v_has_lines and v_order.package_id is not null then
    insert into public.deal_line_items (
      deal_id,
      package_id,
      quantity,
      unit_sale_price,
      currency,
      sourcing_mode,
      reservation_status,
      sort_order
    ) values (
      v_deal_id,
      v_order.package_id,
      greatest(1, coalesce(v_order.guests, 1)),
      coalesce(v_order.unit_price, 0),
      coalesce(v_order.currency, 'USD'),
      'owned',
      'none',
      0
    );
  end if;

  update public.orders
  set deal_id = v_deal_id,
      crm_account_id = coalesce(crm_account_id, v_account_id),
      crm_contact_id = coalesce(crm_contact_id, v_contact_id)
  where id = v_order.id;

  insert into public.deal_activities (deal_id, actor_profile_id, action, summary, metadata)
  values (
    v_deal_id,
    v_order.agent_profile_id,
    'portal_checkout_confirmed',
    'Portal checkout confirmed the booking. Terms accepted in place of a booking form.',
    jsonb_build_object(
      'order_id', v_order.id,
      'order_reference', v_order.reference,
      'channel', coalesce(v_order.channel, 'trade_portal')
    )
  );

  return v_deal_id;
end;
$$;

revoke all on function public.attach_deal_for_committed_order(uuid) from public;
grant execute on function public.attach_deal_for_committed_order(uuid) to authenticated, service_role;

do $$
declare
  v_order_id uuid;
begin
  for v_order_id in
    select id
    from public.orders
    where deal_id is null
      and coalesce(channel, 'trade_portal') in ('trade_portal', 'admin', 'partner_api')
    order by created_at asc, id asc
  loop
    begin
      perform public.attach_deal_for_committed_order(v_order_id);
    exception
      when others then
        raise notice 'attach_deal_for_committed_order skipped %: %', v_order_id, sqlerrm;
    end;
  end loop;
end;
$$;

-- Keep DL numbers chronological now that portal bookings are deals too.
alter table public.deals drop constraint if exists deals_reference_format;

update public.deals
set reference = '__renumber_' || id::text
where reference not like '__renumber_%';

with numbered as (
  select
    id,
    row_number() over (
      order by coalesce(external_created_at, created_at) asc,
               created_at asc,
               id asc
    ) - 1 as n
  from public.deals
)
update public.deals d
set reference = public.format_deal_reference(numbered.n)
from numbered
where d.id = numbered.id;

do $$
declare
  v_max bigint;
begin
  select coalesce(max(substring(reference from 3)::bigint), -1)
  into v_max
  from public.deals
  where reference ~ '^DL[0-9]+$';

  if v_max < 0 then
    perform setval('public.deal_reference_seq', 0, false);
  else
    perform setval('public.deal_reference_seq', v_max, true);
  end if;
end;
$$;

alter table public.deals
  add constraint deals_reference_format
  check (reference ~ '^DL[0-9]{4,}$');
