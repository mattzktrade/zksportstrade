-- Correct linked inventory: single-day sales only reduce that day + 2-day; the other day is unchanged.

alter table public.packages
  add column if not exists inventory_group_id text;

comment on column public.packages.inventory_group_id is
  'Links split day options for one product. Saturday/Sunday are independent; 2-day tracks min(Sat,Sun) and drops when either day sells.';

drop trigger if exists package_inventory_sync_linked_available on public.package_inventory;
drop function if exists public.trg_sync_linked_inventory_available();
drop function if exists public.linked_inventory_group_held(text);

-- ---------------------------------------------------------------------------
-- 2-day availability = min(Saturday, Sunday) in the same group
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_linked_multi_day_inventory(p_group_id text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_min int;
begin
  if p_group_id is null then
    return;
  end if;

  select min(pi.qty_available)
  into v_min
  from public.packages p
  join public.package_inventory pi on pi.package_id = p.id
  where p.inventory_group_id = p_group_id
    and p.duration in ('saturday_only', 'sunday_only');

  if v_min is null then
    return;
  end if;

  update public.package_inventory pi
  set qty_available = v_min
  from public.packages p
  where pi.package_id = p.id
    and p.inventory_group_id = p_group_id
    and p.duration = '2_day';
end;
$$;

-- ---------------------------------------------------------------------------
-- Apply qty delta with day-specific cascade rules
-- ---------------------------------------------------------------------------
create or replace function public.adjust_linked_inventory_available(
  p_package_id text,
  p_delta int
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_group text;
  v_duration text;
begin
  update public.package_inventory
  set qty_available = qty_available + p_delta
  where package_id = p_package_id;

  select inventory_group_id, duration
  into v_group, v_duration
  from public.packages
  where id = p_package_id;

  if v_group is null then
    return;
  end if;

  if v_duration = '2_day' then
    update public.package_inventory pi
    set qty_available = pi.qty_available + p_delta
    from public.packages p
    where pi.package_id = p.id
      and p.inventory_group_id = v_group
      and p.duration in ('saturday_only', 'sunday_only');
  elsif v_duration in ('saturday_only', 'sunday_only') then
    perform public.reconcile_linked_multi_day_inventory(v_group);
  end if;
end;
$$;

revoke all on function public.reconcile_linked_multi_day_inventory(text) from public;
grant execute on function public.reconcile_linked_multi_day_inventory(text) to authenticated;

-- Reconcile 2-day rows after manual Saturday/Sunday capacity edits
create or replace function public.trg_reconcile_linked_multi_day_on_day_change()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_group text;
  v_duration text;
begin
  if tg_op <> 'UPDATE' or new.qty_available is not distinct from old.qty_available then
    return new;
  end if;

  select inventory_group_id, duration
  into v_group, v_duration
  from public.packages
  where id = new.package_id;

  if v_group is not null and v_duration in ('saturday_only', 'sunday_only') then
    perform public.reconcile_linked_multi_day_inventory(v_group);
  end if;

  return new;
end;
$$;

drop trigger if exists package_inventory_reconcile_multi_day on public.package_inventory;
create trigger package_inventory_reconcile_multi_day
  after update of qty_available on public.package_inventory
  for each row
  execute function public.trg_reconcile_linked_multi_day_on_day_change();

-- Fix 2-day rows to min(Sat,Sun); leave single days as-is
select public.reconcile_linked_multi_day_inventory(p.inventory_group_id)
from (
  select distinct inventory_group_id
  from public.packages
  where inventory_group_id is not null
) p;

-- ---------------------------------------------------------------------------
-- Sellable units for checkout / holds (2-day = min of Sat and Sun sellable)
-- ---------------------------------------------------------------------------
create or replace function public.linked_inventory_sellable(
  p_package_id text,
  p_agent_profile_id uuid
)
returns int
language plpgsql
stable
set search_path = public
as $$
declare
  v_duration text;
  v_group text;
  v_my_hold int;
  v_avail int;
  v_held int;
  v_sat_sellable int;
  v_sun_sellable int;
  r record;
begin
  select duration, inventory_group_id
  into v_duration, v_group
  from public.packages
  where id = p_package_id;

  if v_group is not null and v_duration = '2_day' then
    v_sat_sellable := null;
    v_sun_sellable := null;

    for r in
      select p.id, p.duration, pi.qty_available, pi.qty_held
      from public.packages p
      join public.package_inventory pi on pi.package_id = p.id
      where p.inventory_group_id = v_group
        and p.duration in ('saturday_only', 'sunday_only')
    loop
      select coalesce(sum(h.quantity), 0)::int
      into v_my_hold
      from public.inventory_holds h
      where h.package_id = r.id
        and h.agent_profile_id = p_agent_profile_id
        and h.released_at is null
        and h.expires_at > timezone('utc', now());

      if r.duration = 'saturday_only' then
        v_sat_sellable := (r.qty_available - r.qty_held) + v_my_hold;
      elsif r.duration = 'sunday_only' then
        v_sun_sellable := (r.qty_available - r.qty_held) + v_my_hold;
      end if;
    end loop;

    if v_sat_sellable is not null and v_sun_sellable is not null then
      return least(v_sat_sellable, v_sun_sellable);
    end if;
  end if;

  select coalesce(sum(h.quantity), 0)::int
  into v_my_hold
  from public.inventory_holds h
  where h.package_id = p_package_id
    and h.agent_profile_id = p_agent_profile_id
    and h.released_at is null
    and h.expires_at > timezone('utc', now());

  select pi.qty_available, pi.qty_held
  into v_avail, v_held
  from public.package_inventory pi
  where pi.package_id = p_package_id;

  return coalesce(v_avail, 0) - coalesce(v_held, 0) + v_my_hold;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_create_hold: per-package capacity only
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_hold(
  p_package_id text,
  p_agent_profile_id uuid,
  p_quantity int,
  p_note text default null,
  p_hold_hours int default 24
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold_id uuid;
  v_qty_available int;
  v_qty_held int;
  v_agent_role text;
  v_hours int;
  v_expires timestamptz;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid quantity';
  end if;

  v_hours := coalesce(p_hold_hours, 24);
  if v_hours < 1 or v_hours > 720 then
    raise exception 'hold duration must be between 1 and 720 hours';
  end if;
  v_expires := timezone('utc', now()) + (v_hours * interval '1 hour');

  select role into v_agent_role
  from public.profiles
  where id = p_agent_profile_id;
  if not found then
    raise exception 'profile not found';
  end if;
  if v_agent_role is distinct from 'agent' then
    raise exception 'holds can only be assigned to agent profiles';
  end if;

  perform public.lock_package_inventory(p_package_id);

  select qty_available, qty_held into v_qty_available, v_qty_held
  from public.package_inventory
  where package_id = p_package_id;
  if not found then
    raise exception 'inventory row missing for package';
  end if;
  if v_qty_held + p_quantity > v_qty_available then
    raise exception 'insufficient free capacity';
  end if;

  insert into public.inventory_holds (package_id, agent_profile_id, quantity, note, expires_at)
  values (
    p_package_id,
    p_agent_profile_id,
    p_quantity,
    case when p_note is null or btrim(p_note) = '' then null else btrim(p_note) end,
    v_expires
  )
  returning id into v_hold_id;

  update public.package_inventory
  set qty_held = v_qty_held + p_quantity
  where package_id = p_package_id;

  return v_hold_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cost layer RPCs: cascade via adjust_linked_inventory_available
-- ---------------------------------------------------------------------------
create or replace function public.admin_add_cost_layer(
  p_package_id text,
  p_quantity int,
  p_unit_cost numeric,
  p_currency text default null,
  p_note text default null,
  p_received_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer_id uuid;
  v_currency text;
  v_received timestamptz;
  v_pkg_currency text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'invalid_unit_cost';
  end if;

  select coalesce(nullif(btrim(pk.currency), ''), 'USD')
  into v_pkg_currency
  from public.packages pk
  where pk.id = p_package_id;
  if not found then
    raise exception 'package_not_found';
  end if;

  v_currency := coalesce(nullif(btrim(p_currency), ''), v_pkg_currency);
  v_received := coalesce(p_received_at, now());

  if not exists (select 1 from public.package_inventory pi where pi.package_id = p_package_id) then
    insert into public.package_inventory (package_id, qty_available, qty_held)
    values (p_package_id, 0, 0);
  end if;

  perform public.lock_package_inventory(p_package_id);

  insert into public.package_cost_layers (
    package_id, quantity, quantity_remaining, unit_cost, currency, note, received_at, created_by
  )
  values (
    p_package_id,
    p_quantity,
    p_quantity,
    p_unit_cost,
    v_currency,
    nullif(btrim(p_note), ''),
    v_received,
    auth.uid()
  )
  returning id into v_layer_id;

  perform public.adjust_linked_inventory_available(p_package_id, p_quantity);

  return v_layer_id;
end;
$$;

create or replace function public.admin_delete_cost_layer(p_layer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer record;
  v_qty_held int;
  v_qty_available int;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select id, package_id, quantity, quantity_remaining
  into v_layer
  from public.package_cost_layers
  where id = p_layer_id
  for update;
  if not found then
    raise exception 'cost_layer_not_found';
  end if;

  if v_layer.quantity_remaining is distinct from v_layer.quantity then
    raise exception 'layer_already_consumed';
  end if;

  if exists (select 1 from public.order_cost_consumptions where cost_layer_id = p_layer_id) then
    raise exception 'layer_already_consumed';
  end if;

  perform public.lock_package_inventory(v_layer.package_id);

  select qty_available, qty_held
  into v_qty_available, v_qty_held
  from public.package_inventory
  where package_id = v_layer.package_id;

  if found then
    if (v_qty_available - v_layer.quantity) < v_qty_held then
      raise exception 'qty_held_would_exceed_capacity';
    end if;
    perform public.adjust_linked_inventory_available(v_layer.package_id, -v_layer.quantity);
  end if;

  delete from public.package_cost_layers where id = p_layer_id;
end;
$$;

create or replace function public.admin_update_cost_layer_quantity(
  p_layer_id uuid,
  p_new_quantity int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer record;
  v_consumed int;
  v_delta int;
  v_qty_available int;
  v_qty_held int;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'invalid_quantity';
  end if;

  select id, package_id, quantity, quantity_remaining
  into v_layer
  from public.package_cost_layers
  where id = p_layer_id
  for update;
  if not found then
    raise exception 'cost_layer_not_found';
  end if;

  v_consumed := v_layer.quantity - v_layer.quantity_remaining;
  if p_new_quantity < v_consumed then
    raise exception 'quantity_below_consumed';
  end if;

  v_delta := p_new_quantity - v_layer.quantity;
  if v_delta = 0 then
    return;
  end if;

  perform public.lock_package_inventory(v_layer.package_id);

  select qty_available, qty_held
  into v_qty_available, v_qty_held
  from public.package_inventory
  where package_id = v_layer.package_id;
  if not found then
    raise exception 'inventory_missing';
  end if;

  if (v_qty_available + v_delta) < v_qty_held then
    raise exception 'would_drop_below_holds';
  end if;
  if (v_qty_available + v_delta) < 0 then
    raise exception 'inventory_negative';
  end if;

  update public.package_cost_layers
  set quantity = p_new_quantity,
      quantity_remaining = quantity_remaining + v_delta
  where id = p_layer_id;

  perform public.adjust_linked_inventory_available(v_layer.package_id, v_delta);
end;
$$;

-- ---------------------------------------------------------------------------
-- place_order: day-specific cascade on sale
-- ---------------------------------------------------------------------------
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

  if v_caller is null then
    raise exception 'not_authenticated';
  end if;

  if p_agent_profile_id is not null then
    if not public.is_admin() then
      raise exception 'forbidden';
    end if;
    v_uid := p_agent_profile_id;
    select (p.approval_status = 'approved' and p.role = 'agent')
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
