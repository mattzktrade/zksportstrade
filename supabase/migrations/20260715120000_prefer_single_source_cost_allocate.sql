-- Prefer single fulfilment-block / supplier when allocating order cost layers.
-- Also resolve cost layers from the linked 3-day parent when a day package has none
-- (Sunday-only sales still consume the shared purchase ledger).

create or replace function public.resolve_cost_ledger_package_id(p_package_id text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_group text;
  v_own_remaining int;
  v_parent_id text;
begin
  select inventory_group_id
  into v_group
  from public.packages
  where id = p_package_id;

  select coalesce(sum(quantity_remaining), 0)::int
  into v_own_remaining
  from public.package_cost_layers
  where package_id = p_package_id
    and quantity_remaining > 0;

  if v_own_remaining > 0 or v_group is null or btrim(v_group) = '' then
    return p_package_id;
  end if;

  -- Linked day/combo packages share the 3-day parent's purchase ledger.
  select p.id
  into v_parent_id
  from public.packages p
  where p.inventory_group_id = v_group
    and p.duration = '3_day'
    and p.shell_parent_package_id is null
  order by p.id
  limit 1;

  if v_parent_id is not null then
    return v_parent_id;
  end if;

  return p_package_id;
end;
$$;

revoke all on function public.resolve_cost_ledger_package_id(text) from public;
grant execute on function public.resolve_cost_ledger_package_id(text) to authenticated;
grant execute on function public.resolve_cost_ledger_package_id(text) to service_role;

create or replace function public.package_largest_same_suite_remaining(p_package_id text)
returns int
language plpgsql
stable
set search_path = public
as $$
declare
  v_ledger text;
  v_max int := 0;
begin
  v_ledger := public.resolve_cost_ledger_package_id(p_package_id);

  select coalesce(max(src.remaining), 0)::int
  into v_max
  from (
    select
      case
        when fulfilment_block_id is not null then 'block:' || fulfilment_block_id::text
        when purchase_order_id is not null then 'po:' || purchase_order_id::text
        when nullif(btrim(source), '') is not null then 'src:' || lower(btrim(source))
        else 'layer:' || id::text
      end as source_key,
      sum(quantity_remaining)::int as remaining
    from public.package_cost_layers
    where package_id = v_ledger
      and quantity_remaining > 0
    group by 1
  ) src;

  return greatest(0, coalesce(v_max, 0));
end;
$$;

revoke all on function public.package_largest_same_suite_remaining(text) from public;
grant execute on function public.package_largest_same_suite_remaining(text) to authenticated;
grant execute on function public.package_largest_same_suite_remaining(text) to service_role;
grant execute on function public.package_largest_same_suite_remaining(text) to anon;

/**
 * Allocate guests onto cost layers for an order.
 * Preference order (keep a party together when possible):
 *   1) one fulfilment block with enough remaining
 *   2) one purchase order / supplier with enough remaining
 *   3) one individual cost layer with enough remaining
 *   4) FIFO across all layers (may split)
 * Within the chosen set, still consume FIFO by received_at.
 */
create or replace function public.allocate_order_cost_layers(
  p_order_id uuid,
  p_order_package_id text,
  p_guests int,
  p_currency text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ledger text;
  v_units int := p_guests;
  v_take int;
  v_layer record;
  v_preferred_block uuid;
  v_preferred_po uuid;
  v_preferred_source text;
  v_preferred_layer uuid;
  v_filter_mode text := 'all';
begin
  if p_guests is null or p_guests <= 0 then
    return;
  end if;

  v_ledger := public.resolve_cost_ledger_package_id(p_order_package_id);

  -- Lock all candidate layers first.
  perform 1
  from public.package_cost_layers
  where package_id = v_ledger
    and quantity_remaining > 0
  for update;

  -- 1) Prefer a single fulfilment block that can cover the whole party.
  select fulfilment_block_id
  into v_preferred_block
  from public.package_cost_layers
  where package_id = v_ledger
    and quantity_remaining > 0
    and fulfilment_block_id is not null
  group by fulfilment_block_id
  having sum(quantity_remaining) >= p_guests
  order by min(received_at) asc, fulfilment_block_id asc
  limit 1;

  if v_preferred_block is not null then
    v_filter_mode := 'block';
  else
    -- 2) Prefer a single purchase order / supplier pool.
    select purchase_order_id
    into v_preferred_po
    from public.package_cost_layers
    where package_id = v_ledger
      and quantity_remaining > 0
      and purchase_order_id is not null
    group by purchase_order_id
    having sum(quantity_remaining) >= p_guests
    order by min(received_at) asc, purchase_order_id asc
    limit 1;

    if v_preferred_po is not null then
      v_filter_mode := 'po';
    else
      select lower(btrim(source))
      into v_preferred_source
      from public.package_cost_layers
      where package_id = v_ledger
        and quantity_remaining > 0
        and nullif(btrim(source), '') is not null
        and purchase_order_id is null
        and fulfilment_block_id is null
      group by lower(btrim(source))
      having sum(quantity_remaining) >= p_guests
      order by min(received_at) asc, lower(btrim(source)) asc
      limit 1;

      if v_preferred_source is not null then
        v_filter_mode := 'source';
      else
        -- 3) Prefer a single layer that can cover the party.
        select id
        into v_preferred_layer
        from public.package_cost_layers
        where package_id = v_ledger
          and quantity_remaining >= p_guests
        order by received_at asc, id asc
        limit 1;

        if v_preferred_layer is not null then
          v_filter_mode := 'layer';
        end if;
      end if;
    end if;
  end if;

  for v_layer in
    select id, quantity_remaining, unit_cost, currency
    from public.package_cost_layers
    where package_id = v_ledger
      and quantity_remaining > 0
      and (
        v_filter_mode = 'all'
        or (v_filter_mode = 'block' and fulfilment_block_id = v_preferred_block)
        or (v_filter_mode = 'po' and purchase_order_id = v_preferred_po)
        or (v_filter_mode = 'source' and lower(btrim(source)) = v_preferred_source)
        or (v_filter_mode = 'layer' and id = v_preferred_layer)
      )
    order by received_at asc, id asc
  loop
    exit when v_units <= 0;
    v_take := least(v_layer.quantity_remaining, v_units);

    insert into public.order_cost_consumptions (
      order_id, cost_layer_id, package_id, quantity, unit_cost, currency
    )
    values (
      p_order_id, v_layer.id, p_order_package_id, v_take, v_layer.unit_cost, v_layer.currency
    );

    update public.package_cost_layers
    set quantity_remaining = quantity_remaining - v_take
    where id = v_layer.id;

    v_units := v_units - v_take;
  end loop;

  -- If preference filter somehow under-delivered, finish with global FIFO.
  if v_units > 0 and v_filter_mode <> 'all' then
    for v_layer in
      select id, quantity_remaining, unit_cost, currency
      from public.package_cost_layers
      where package_id = v_ledger
        and quantity_remaining > 0
      order by received_at asc, id asc
      for update
    loop
      exit when v_units <= 0;
      v_take := least(v_layer.quantity_remaining, v_units);

      insert into public.order_cost_consumptions (
        order_id, cost_layer_id, package_id, quantity, unit_cost, currency
      )
      values (
        p_order_id, v_layer.id, p_order_package_id, v_take, v_layer.unit_cost, v_layer.currency
      );

      update public.package_cost_layers
      set quantity_remaining = quantity_remaining - v_take
      where id = v_layer.id;

      v_units := v_units - v_take;
    end loop;
  end if;

  if v_units > 0 then
    insert into public.order_cost_consumptions (
      order_id, cost_layer_id, package_id, quantity, unit_cost, currency
    )
    values (
      p_order_id, null, p_order_package_id, v_units, null, coalesce(nullif(btrim(p_currency), ''), 'USD')
    );
  end if;
end;
$$;

revoke all on function public.allocate_order_cost_layers(uuid, text, int, text) from public;
grant execute on function public.allocate_order_cost_layers(uuid, text, int, text) to service_role;
grant execute on function public.allocate_order_cost_layers(uuid, text, int, text) to authenticated;


-- Wire place_order to prefer single-source allocation + linked ledger.
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

  perform public.allocate_order_cost_layers(v_order_id, p_package_id, p_guests, v_currency);

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

-- Wire place_wix_order the same way.
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
  v_paid_at timestamptz := timezone('utc', now());
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

  perform public.allocate_order_cost_layers(v_order_id, p_package_id, p_guests, v_currency);

  -- Prepaid on Wix: no awaiting_payment / Xero invoice email flow.
  insert into public.invoices (order_id, reference, amount, currency, status, issued_at, due_date)
  values (
    v_order_id,
    v_invoice_ref,
    v_total,
    v_currency,
    'paid',
    v_paid_at,
    (v_paid_at at time zone 'utc')::date
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
