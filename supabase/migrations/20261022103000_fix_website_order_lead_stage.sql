-- Production already applied 20261021120000. That version set crm_accounts.lead_stage to null,
-- which violates the NOT NULL check and rolled back every paid website checkout.

create or replace function public.place_website_order(
  p_external_order_id text,
  p_hold_id uuid,
  p_package_id text,
  p_guests int,
  p_client_name text,
  p_client_email text,
  p_client_phone text,
  p_agent_profile_id uuid,
  p_owner_profile_id uuid,
  p_unit_price numeric,
  p_currency text,
  p_client_nationality text default '',
  p_bill_line1 text default '',
  p_bill_line2 text default null,
  p_bill_city text default '',
  p_bill_postcode text default '',
  p_bill_country text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg record;
  v_hold public.website_checkout_holds%rowtype;
  v_sellable int;
  v_unit numeric;
  v_total numeric;
  v_currency text;
  v_order_id uuid;
  v_order_ref text;
  v_invoice_id uuid;
  v_deal_id uuid;
  v_deal_ref text;
  v_account_id uuid;
  v_contact_id uuid;
  v_account_name text;
  v_email text;
  v_phone text;
  v_name text;
  v_ext text := nullif(btrim(p_external_order_id), '');
  v_paid_at timestamptz := timezone('utc', now());
  v_low_stock_threshold int := 5;
  v_is_primary boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if v_ext is null then
    raise exception 'external_order_id_required';
  end if;
  if p_owner_profile_id is null then
    raise exception 'owner_profile_required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_owner_profile_id
      and p.role in ('admin', 'finance', 'sales')
  ) then
    raise exception 'owner_profile_invalid';
  end if;
  if p_agent_profile_id is null then
    raise exception 'agent_profile_id_required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_agent_profile_id and p.approval_status = 'approved'
  ) then
    raise exception 'agent_not_approved';
  end if;
  if p_guests is null or p_guests <= 0 then
    raise exception 'invalid_guests';
  end if;

  select o.id, o.reference, o.deal_id
  into v_order_id, v_order_ref, v_deal_id
  from public.orders o
  where o.external_order_id = v_ext
  limit 1;

  if v_order_id is not null then
    select reference into v_deal_ref from public.deals where id = v_deal_id;
    return jsonb_build_object(
      'order_id', v_order_id,
      'order_reference', v_order_ref,
      'deal_id', v_deal_id,
      'deal_reference', v_deal_ref,
      'duplicate', true
    );
  end if;

  if p_hold_id is not null then
    select * into v_hold
    from public.website_checkout_holds
    where id = p_hold_id
    for update;
    if not found then
      raise exception 'hold_not_found';
    end if;
    if v_hold.status = 'converted' and v_hold.order_id is not null then
      select o.id, o.reference, o.deal_id
      into v_order_id, v_order_ref, v_deal_id
      from public.orders o
      where o.id = v_hold.order_id;
      select reference into v_deal_ref from public.deals where id = v_deal_id;
      return jsonb_build_object(
        'order_id', v_order_id,
        'order_reference', v_order_ref,
        'deal_id', v_deal_id,
        'deal_reference', v_deal_ref,
        'duplicate', true
      );
    end if;
    if v_hold.package_id is distinct from p_package_id then
      raise exception 'hold_package_mismatch';
    end if;
    if v_hold.guests is distinct from p_guests then
      raise exception 'hold_guests_mismatch';
    end if;
    if round(v_hold.unit_price, 2) is distinct from round(p_unit_price::numeric, 2) then
      raise exception 'hold_price_mismatch';
    end if;
    if v_hold.status in ('released', 'expired') then
      v_hold.id := null;
    elsif v_hold.expires_at <= timezone('utc', now()) then
      if v_hold.inventory_hold_id is not null then
        update public.inventory_holds
        set released_at = timezone('utc', now())
        where id = v_hold.inventory_hold_id
          and released_at is null;
        perform public.reconcile_holds_for_package(v_hold.package_id);
      end if;
      update public.website_checkout_holds
      set status = 'expired', updated_at = timezone('utc', now())
      where id = v_hold.id;
      v_hold.id := null;
    end if;
  end if;

  select
    pk.id,
    pk.is_enquiry,
    pk.trade_price,
    pk.currency,
    pk.circuit,
    pk.name,
    pk.event_date,
    pk.race_id
  into v_pkg
  from public.packages pk
  where pk.id = p_package_id
  for update;

  if not found then
    raise exception 'package_not_found';
  end if;
  if v_pkg.event_date < (current_timestamp at time zone 'Europe/London')::date then
    raise exception 'event_has_ended';
  end if;
  if v_pkg.is_enquiry then
    raise exception 'package_enquiry_only';
  end if;
  if p_unit_price is null or p_unit_price <= 0 then
    raise exception 'package_price_missing';
  end if;

  v_unit := round(p_unit_price::numeric, 2);
  v_currency := coalesce(nullif(btrim(p_currency), ''), nullif(btrim(v_pkg.currency), ''), 'USD');
  v_total := round(v_unit * p_guests, 2);
  v_name := nullif(btrim(p_client_name), '');
  v_email := nullif(btrim(lower(p_client_email)), '');
  v_phone := nullif(btrim(p_client_phone), '');
  if v_name is null then
    raise exception 'client_name_required';
  end if;
  if v_email is null then
    raise exception 'client_email_required';
  end if;

  perform public.lock_package_inventory(p_package_id);
  if not exists (select 1 from public.package_inventory where package_id = p_package_id) then
    raise exception 'inventory_missing';
  end if;

  v_sellable := public.linked_inventory_sellable(p_package_id, p_agent_profile_id);
  if v_sellable < p_guests then
    raise exception 'insufficient_stock';
  end if;
  if v_sellable <= v_low_stock_threshold and (v_sellable - p_guests) = 1 then
    raise exception 'leaves_one_remaining';
  end if;

  v_order_ref := 'ZK-' || to_char(timezone('utc', now()), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.orders (
    reference,
    agent_profile_id,
    package_id,
    status,
    channel,
    external_order_id,
    guests,
    unit_price,
    total_amount,
    currency,
    client_name,
    client_email,
    client_phone,
    client_nationality,
    shipping_address_line1,
    shipping_address_line2,
    shipping_city,
    shipping_postcode,
    shipping_country,
    billing_address_line1,
    billing_address_line2,
    billing_city,
    billing_postcode,
    billing_country
  )
  values (
    v_order_ref,
    p_agent_profile_id,
    p_package_id,
    'confirmed',
    'website',
    v_ext,
    p_guests,
    v_unit,
    v_total,
    v_currency,
    v_name,
    v_email,
    coalesce(v_phone, '—'),
    coalesce(btrim(p_client_nationality), ''),
    coalesce(btrim(p_bill_line1), ''),
    coalesce(btrim(p_bill_line2), ''),
    coalesce(btrim(p_bill_city), ''),
    coalesce(btrim(p_bill_postcode), ''),
    coalesce(btrim(p_bill_country), ''),
    coalesce(btrim(p_bill_line1), ''),
    coalesce(btrim(p_bill_line2), ''),
    coalesce(btrim(p_bill_city), ''),
    coalesce(btrim(p_bill_postcode), ''),
    coalesce(btrim(p_bill_country), '')
  )
  returning id into v_order_id;

  perform public.adjust_linked_inventory_available(p_package_id, -p_guests);
  perform public.allocate_order_cost_layers(v_order_id, p_package_id, p_guests, v_currency);

  if v_hold.inventory_hold_id is not null then
    update public.inventory_holds
    set released_at = timezone('utc', now())
    where id = v_hold.inventory_hold_id
      and released_at is null;
    perform public.reconcile_holds_for_package(p_package_id);
  end if;

  insert into public.invoices (
    order_id, reference, amount, currency, status, issued_at, due_date, paid_at
  )
  values (
    v_order_id,
    v_order_ref,
    v_total,
    v_currency,
    'paid',
    v_paid_at,
    (v_paid_at at time zone 'utc')::date,
    v_paid_at
  )
  returning id into v_invoice_id;

  select c.id, c.account_id
  into v_contact_id, v_account_id
  from public.crm_contacts c
  where c.active = true
    and c.email is not null
    and lower(c.email) = v_email
  order by c.created_at
  limit 1;

  if v_account_id is null then
    select id into v_account_id
    from public.crm_accounts
    where active = true
      and email is not null
      and lower(email) = v_email
    order by created_at
    limit 1;
  end if;

  if v_account_id is null then
    v_account_name := v_name;
    if exists (
      select 1 from public.crm_accounts where lower(btrim(name)) = lower(v_account_name)
    ) then
      v_account_name := left(v_name || ' (' || v_email || ')', 180);
    end if;
    insert into public.crm_accounts (
      name,
      account_type,
      account_types,
      email,
      phone,
      source,
      lifecycle,
      lead_stage,
      active
    )
    values (
      v_account_name,
      'direct_client',
      array['direct_client']::text[],
      v_email,
      v_phone,
      'website',
      'client',
      'talking',
      true
    )
    returning id into v_account_id;
  else
    update public.crm_accounts
    set lifecycle = 'client',
        email = coalesce(email, v_email),
        phone = coalesce(phone, v_phone),
        updated_at = timezone('utc', now())
    where id = v_account_id;
  end if;

  if v_contact_id is null then
    v_is_primary := not exists (
      select 1 from public.crm_contacts
      where account_id = v_account_id and active = true and is_primary
    );
    insert into public.crm_contacts (
      account_id,
      full_name,
      email,
      phone,
      is_primary,
      active
    )
    values (
      v_account_id,
      v_name,
      v_email,
      v_phone,
      v_is_primary,
      true
    )
    returning id into v_contact_id;
  else
    update public.crm_contacts
    set phone = coalesce(phone, v_phone),
        full_name = coalesce(nullif(btrim(full_name), ''), v_name)
    where id = v_contact_id;
  end if;

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
    next_action,
    order_id,
    closed_at,
    created_at,
    updated_at
  )
  values (
    'DL0000',
    v_account_id,
    v_contact_id,
    p_owner_profile_id,
    v_pkg.race_id,
    'website',
    'paid_confirmed',
    v_currency,
    v_total,
    concat_ws(
      E'\n',
      'Paid website checkout from the Abu Dhabi GP site.',
      'Stripe session: ' || v_ext,
      'Package: ' || v_pkg.name,
      'Guests: ' || p_guests::text
    ),
    'Hand over to fulfilment',
    v_order_id,
    v_paid_at,
    v_paid_at,
    v_paid_at
  )
  returning id, reference into v_deal_id, v_deal_ref;

  insert into public.deal_line_items (
    deal_id,
    package_id,
    quantity,
    unit_sale_price,
    currency,
    sourcing_mode,
    reservation_status,
    sort_order
  )
  values (
    v_deal_id,
    p_package_id,
    p_guests,
    v_unit,
    v_currency,
    'owned',
    'none',
    0
  );

  update public.orders
  set deal_id = v_deal_id,
      crm_account_id = v_account_id,
      crm_contact_id = v_contact_id
  where id = v_order_id;

  insert into public.deal_activities (deal_id, actor_profile_id, action, summary, metadata)
  values (
    v_deal_id,
    p_owner_profile_id,
    'website_checkout_paid',
    'Paid website checkout from the Abu Dhabi GP website.',
    jsonb_build_object(
      'order_id', v_order_id,
      'order_reference', v_order_ref,
      'channel', 'website',
      'stripe_session_id', v_ext
    )
  );

  if p_hold_id is not null then
    update public.website_checkout_holds
    set status = 'converted',
        order_id = v_order_id,
        stripe_session_id = coalesce(stripe_session_id, v_ext),
        updated_at = timezone('utc', now())
    where id = p_hold_id;
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_reference', v_order_ref,
    'deal_id', v_deal_id,
    'deal_reference', v_deal_ref,
    'package_name', v_pkg.name,
    'circuit', v_pkg.circuit,
    'total_amount', v_total,
    'currency', v_currency,
    'guests', p_guests,
    'duplicate', false
  );
end;
$$;

revoke all on function public.place_website_order(text, uuid, text, int, text, text, text, uuid, uuid, numeric, text, text, text, text, text, text, text) from public;
grant execute on function public.place_website_order(text, uuid, text, int, text, text, text, uuid, uuid, numeric, text, text, text, text, text, text, text) to service_role;
