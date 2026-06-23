-- Phase 4: Wix paid orders → portal (service-role only).

create or replace function public.place_wix_order(
  p_external_order_id text,
  p_package_id text,
  p_guests int,
  p_client_name text,
  p_client_email text,
  p_client_phone text,
  p_agent_profile_id uuid,
  p_client_nationality text default '',
  p_dietary text default null,
  p_special text default null,
  p_po text default null,
  p_ship_line1 text default '',
  p_ship_line2 text default null,
  p_ship_city text default '',
  p_ship_postcode text default '',
  p_ship_country text default '',
  p_bill_line1 text default '',
  p_bill_line2 text default null,
  p_bill_city text default '',
  p_bill_postcode text default '',
  p_bill_country text default '',
  p_unit_price numeric default null,
  p_currency text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg record;
  v_sellable int;
  v_unit numeric;
  v_total numeric;
  v_currency text;
  v_order_id uuid;
  v_order_ref text;
  v_invoice_id uuid;
  v_invoice_ref text;
  v_circuit text;
  v_pkg_name text;
  v_remaining int;
  v_take int;
  v_layer record;
  v_units_to_cost int;
  v_today_london date := (current_timestamp at time zone 'Europe/London')::date;
  v_low_stock_threshold int := 5;
  v_mult numeric := 1.10;
  v_ext text := nullif(btrim(p_external_order_id), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  if v_ext is null then
    raise exception 'external_order_id_required';
  end if;

  select o.id, o.reference
  into v_order_id, v_order_ref
  from public.orders o
  where o.external_order_id = v_ext
  limit 1;

  if v_order_id is not null then
    return jsonb_build_object(
      'order_id', v_order_id,
      'order_reference', v_order_ref,
      'duplicate', true
    );
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

  select
    pk.id,
    pk.is_enquiry,
    pk.trade_price,
    pk.retail_price_multiplier,
    pk.currency,
    pk.circuit,
    pk.name,
    pk.event_date
  into v_pkg
  from public.packages pk
  where pk.id = p_package_id
  for update;

  if not found then
    raise exception 'package_not_found';
  end if;

  if v_pkg.event_date < v_today_london then
    raise exception 'event_has_ended';
  end if;
  if v_pkg.is_enquiry then
    raise exception 'package_enquiry_only';
  end if;
  if v_pkg.trade_price is null then
    raise exception 'package_price_missing';
  end if;

  if p_unit_price is not null and p_unit_price > 0 then
    v_unit := round(p_unit_price::numeric, 2);
  else
    if v_pkg.retail_price_multiplier is not null and v_pkg.retail_price_multiplier > 0 then
      v_mult := v_pkg.retail_price_multiplier;
    end if;
    v_unit := round((v_pkg.trade_price * v_mult)::numeric, 2);
  end if;

  v_currency := coalesce(nullif(btrim(p_currency), ''), nullif(btrim(v_pkg.currency), ''), 'USD');
  v_circuit := v_pkg.circuit;
  v_pkg_name := v_pkg.name;
  v_total := round(v_unit * p_guests, 2);

  perform public.lock_package_inventory(p_package_id);

  if not exists (
    select 1 from public.package_inventory pi where pi.package_id = p_package_id
  ) then
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
  v_invoice_ref := v_order_ref;

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
    dietary_requirements,
    special_requests,
    po_number,
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
    'pending',
    'wix',
    v_ext,
    p_guests,
    v_unit,
    v_total,
    v_currency,
    btrim(p_client_name),
    btrim(lower(p_client_email)),
    btrim(p_client_phone),
    coalesce(btrim(p_client_nationality), ''),
    nullif(btrim(p_dietary), ''),
    nullif(btrim(p_special), ''),
    nullif(btrim(p_po), ''),
    coalesce(btrim(p_ship_line1), ''),
    coalesce(btrim(p_ship_line2), ''),
    coalesce(btrim(p_ship_city), ''),
    coalesce(btrim(p_ship_postcode), ''),
    coalesce(btrim(p_ship_country), ''),
    coalesce(btrim(p_bill_line1), ''),
    coalesce(btrim(p_bill_line2), ''),
    coalesce(btrim(p_bill_city), ''),
    coalesce(btrim(p_bill_postcode), ''),
    coalesce(btrim(p_bill_country), '')
  )
  returning id into v_order_id;

  perform public.adjust_linked_inventory_available(p_package_id, -p_guests);

  v_units_to_cost := p_guests;
  for v_layer in
    select id, quantity_remaining, unit_cost, currency
    from public.package_cost_layers
    where package_id = p_package_id
      and quantity_remaining > 0
    order by received_at asc, id asc
    for update
  loop
    exit when v_units_to_cost <= 0;
    v_take := least(v_layer.quantity_remaining, v_units_to_cost);

    insert into public.order_cost_consumptions (
      order_id, cost_layer_id, package_id, quantity, unit_cost, currency
    )
    values (
      v_order_id, v_layer.id, p_package_id, v_take, v_layer.unit_cost, v_layer.currency
    );

    update public.package_cost_layers
    set quantity_remaining = quantity_remaining - v_take
    where id = v_layer.id;

    v_units_to_cost := v_units_to_cost - v_take;
  end loop;

  if v_units_to_cost > 0 then
    insert into public.order_cost_consumptions (
      order_id, cost_layer_id, package_id, quantity, unit_cost, currency
    )
    values (
      v_order_id, null, p_package_id, v_units_to_cost, null, v_currency
    );
  end if;

  insert into public.invoices (order_id, reference, amount, currency, status, issued_at, due_date)
  values (
    v_order_id,
    v_invoice_ref,
    v_total,
    v_currency,
    'awaiting_invoice',
    null,
    null
  )
  returning id into v_invoice_id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_reference', v_order_ref,
    'package_name', v_pkg_name,
    'circuit', v_circuit,
    'total_amount', v_total,
    'currency', v_currency,
    'guests', p_guests,
    'duplicate', false
  );
end;
$$;

comment on function public.place_wix_order is
  'Service-role only: record a paid Wix order at retail price, idempotent on external_order_id.';

alter table public.channel_listings
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_sync_error text;
