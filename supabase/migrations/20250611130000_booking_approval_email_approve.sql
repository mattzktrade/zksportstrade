-- Email one-click approve: service_role RPC + place_order for agent on behalf of approved requests.

create or replace function public.service_approve_booking_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  select *
  into v_req
  from public.booking_approval_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'request_not_pending';
  end if;

  v_result := public.place_order(
    v_req.package_id,
    v_req.guests,
    v_req.client_name,
    v_req.client_email,
    v_req.client_phone,
    v_req.client_nationality,
    coalesce(v_req.dietary_requirements, ''),
    coalesce(v_req.special_requests, ''),
    coalesce(v_req.po_number, ''),
    v_req.shipping_address_line1,
    v_req.shipping_address_line2,
    v_req.shipping_city,
    v_req.shipping_postcode,
    v_req.shipping_country,
    v_req.billing_address_line1,
    v_req.billing_address_line2,
    v_req.billing_city,
    v_req.billing_postcode,
    v_req.billing_country,
    v_req.agent_profile_id
  );

  update public.booking_approval_requests
  set status = 'approved',
      order_id = (v_result->>'order_id')::uuid,
      reviewed_at = timezone('utc', now()),
      reviewed_by = null
  where id = p_request_id;

  return v_result || jsonb_build_object('request_id', p_request_id, 'request_reference', v_req.reference);
end;
$$;

revoke all on function public.service_approve_booking_request(uuid) from public;
grant execute on function public.service_approve_booking_request(uuid) to service_role;

-- place_order: allow service_role to book on behalf of an agent (email approval link).
create or replace function public.place_order(
  p_package_id text,
  p_guests int,
  p_client_name text,
  p_client_email text,
  p_client_phone text,
  p_client_nationality text,
  p_dietary text,
  p_special text,
  p_po text,
  p_ship_line1 text,
  p_ship_line2 text,
  p_ship_city text,
  p_ship_postcode text,
  p_ship_country text,
  p_bill_line1 text,
  p_bill_line2 text,
  p_bill_city text,
  p_bill_postcode text,
  p_bill_country text,
  p_agent_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_uid uuid;
  v_approved boolean;
  v_pkg record;
  v_requires_approval boolean;
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
  v_hold record;
  v_remaining int;
  v_take int;
  v_expired int;
  v_layer record;
  v_units_to_cost int;
  v_today_london date := (current_timestamp at time zone 'Europe/London')::date;
  v_low_stock_threshold int := 5;
begin
  v_expired := public.release_expired_inventory_holds();

  if auth.role() = 'service_role' and p_agent_profile_id is not null then
    v_uid := p_agent_profile_id;
    select (p.approval_status = 'approved' and p.role in ('agent', 'admin'))
    into v_approved
    from public.profiles p
    where p.id = v_uid;
    if not found then
      raise exception 'agent_not_found';
    end if;
    if not coalesce(v_approved, false) then
      raise exception 'agent_not_approved';
    end if;
  elsif v_caller is null then
    raise exception 'not_authenticated';
  elsif p_agent_profile_id is not null then
    if not public.is_admin() then
      raise exception 'forbidden';
    end if;
    v_uid := p_agent_profile_id;
    select (p.approval_status = 'approved' and p.role in ('agent', 'admin'))
    into v_approved
    from public.profiles p
    where p.id = v_uid;
    if not found then
      raise exception 'agent_not_found';
    end if;
    if not coalesce(v_approved, false) then
      raise exception 'agent_not_approved';
    end if;
  else
    v_uid := v_caller;
    select (p.approval_status = 'approved')
    into v_approved
    from public.profiles p
    where p.id = v_uid;
    if not found then
      raise exception 'profile_not_found';
    end if;
    if not coalesce(v_approved, false) then
      raise exception 'not_approved';
    end if;
  end if;

  if p_guests is null or p_guests <= 0 then
    raise exception 'invalid_guests';
  end if;

  select
    pk.id,
    pk.is_enquiry,
    pk.trade_price,
    pk.currency,
    pk.circuit,
    pk.name,
    pk.event_date,
    pk.requires_booking_approval
  into v_pkg
  from public.packages pk
  where pk.id = p_package_id
  for update;

  if not found then
    raise exception 'package_not_found';
  end if;

  v_requires_approval := coalesce(v_pkg.requires_booking_approval, false);
  if v_requires_approval and p_agent_profile_id is null then
    raise exception 'booking_approval_required';
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

  v_unit := v_pkg.trade_price::numeric;
  v_currency := coalesce(nullif(btrim(v_pkg.currency), ''), 'USD');
  v_circuit := v_pkg.circuit;
  v_pkg_name := v_pkg.name;
  v_total := round(v_unit * p_guests, 2);

  perform public.lock_package_inventory(p_package_id);

  if not exists (
    select 1 from public.package_inventory pi where pi.package_id = p_package_id
  ) then
    raise exception 'inventory_missing';
  end if;

  v_sellable := public.linked_inventory_sellable(p_package_id, v_uid);
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
    v_uid,
    p_package_id,
    'pending',
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

  v_remaining := p_guests;
  for v_hold in
    select id, quantity
    from public.inventory_holds
    where package_id = p_package_id
      and agent_profile_id = v_uid
      and released_at is null
      and expires_at > timezone('utc', now())
    order by created_at asc, id asc
    for update
  loop
    exit when v_remaining <= 0;
    if v_hold.quantity <= v_remaining then
      update public.package_inventory
      set qty_held = qty_held - v_hold.quantity
      where package_id = p_package_id;

      update public.inventory_holds
      set released_at = timezone('utc', now())
      where id = v_hold.id;

      v_remaining := v_remaining - v_hold.quantity;
    else
      v_take := v_remaining;
      update public.package_inventory
      set qty_held = qty_held - v_take
      where package_id = p_package_id;

      update public.inventory_holds
      set quantity = quantity - v_take
      where id = v_hold.id;

      v_remaining := 0;
    end if;
  end loop;

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
    'guests', p_guests
  );
end;
$$;
