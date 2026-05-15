-- Cost layers + per-order COGS for accurate gross profit tracking.
--
-- Model:
--   * Each restock event becomes a row in package_cost_layers (qty + unit_cost).
--   * place_order consumes layers FIFO (received_at, id) and writes immutable
--     snapshots to order_cost_consumptions so the COGS for each order stays
--     accurate even if buy prices or sale prices change later.
--   * If layers run short (legacy stock, or qty_available was edited directly
--     without an accompanying layer) the order still completes and the
--     un-priced shortfall is recorded with unit_cost = NULL so the dashboard
--     can flag it explicitly rather than guessing.
--   * Editing a layer's unit_cost optionally cascades to historical
--     consumption rows pointing at that layer, letting admin retroactively fix
--     a forgotten buy price.

-- ---------------------------------------------------------------------------
-- Cost layers
-- ---------------------------------------------------------------------------
create table if not exists public.package_cost_layers (
  id uuid primary key default gen_random_uuid(),
  package_id text not null references public.packages (id) on delete cascade,
  quantity int not null check (quantity > 0),
  quantity_remaining int not null check (quantity_remaining >= 0),
  unit_cost numeric not null default 0 check (unit_cost >= 0),
  currency text not null default 'USD',
  note text,
  received_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint package_cost_layers_remaining_lte_quantity
    check (quantity_remaining <= quantity)
);

create index if not exists package_cost_layers_package_received_idx
  on public.package_cost_layers (package_id, received_at, id);
create index if not exists package_cost_layers_active_idx
  on public.package_cost_layers (package_id)
  where quantity_remaining > 0;

create or replace function public.touch_package_cost_layers_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists package_cost_layers_set_updated_at on public.package_cost_layers;
create trigger package_cost_layers_set_updated_at
  before update on public.package_cost_layers
  for each row
  execute function public.touch_package_cost_layers_updated_at();

-- ---------------------------------------------------------------------------
-- Per-order cost consumption snapshots (one row per layer drawn, or one
-- NULL-cost row covering the un-priced shortfall when layers don't cover an
-- order). Snapshots stay correct even if the source layer is later edited.
-- ---------------------------------------------------------------------------
create table if not exists public.order_cost_consumptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  cost_layer_id uuid references public.package_cost_layers (id) on delete restrict,
  package_id text not null references public.packages (id) on delete restrict,
  quantity int not null check (quantity > 0),
  unit_cost numeric check (unit_cost is null or unit_cost >= 0),
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

create index if not exists order_cost_consumptions_order_idx
  on public.order_cost_consumptions (order_id);
create index if not exists order_cost_consumptions_layer_idx
  on public.order_cost_consumptions (cost_layer_id);
create index if not exists order_cost_consumptions_package_idx
  on public.order_cost_consumptions (package_id);

-- ---------------------------------------------------------------------------
-- RLS: admin-only reads. All writes go through SECURITY DEFINER RPCs below.
-- ---------------------------------------------------------------------------
alter table public.package_cost_layers enable row level security;
alter table public.order_cost_consumptions enable row level security;

drop policy if exists "package_cost_layers_select_admin" on public.package_cost_layers;
create policy "package_cost_layers_select_admin"
  on public.package_cost_layers for select
  using (public.is_admin());

drop policy if exists "order_cost_consumptions_select_admin" on public.order_cost_consumptions;
create policy "order_cost_consumptions_select_admin"
  on public.order_cost_consumptions for select
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Backfill: for every existing inventory row with qty_available > 0 that has
-- no layer yet, create a single placeholder layer with unit_cost = 0 so
-- future orders can consume against it. Admins set the real cost retroactively
-- via admin_update_cost_layer, which cascades to historical consumptions.
-- ---------------------------------------------------------------------------
insert into public.package_cost_layers (package_id, quantity, quantity_remaining, unit_cost, currency, note)
select
  pi.package_id,
  pi.qty_available,
  pi.qty_available,
  0,
  coalesce(nullif(btrim(p.currency), ''), 'USD'),
  'Legacy stock backfill — set buy price retroactively'
from public.package_inventory pi
join public.packages p on p.id = pi.package_id
where pi.qty_available > 0
  and not exists (
    select 1 from public.package_cost_layers cl where cl.package_id = pi.package_id
  );

-- ---------------------------------------------------------------------------
-- RPC: admin_add_cost_layer — restock with a buy price.
-- Atomically appends a cost layer AND bumps qty_available.
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

  update public.package_inventory
  set qty_available = qty_available + p_quantity
  where package_id = p_package_id;

  return v_layer_id;
end;
$$;

revoke all on function public.admin_add_cost_layer(text, int, numeric, text, text, timestamptz) from public;
grant execute on function public.admin_add_cost_layer(text, int, numeric, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: admin_update_cost_layer — edit buy price, currency, note, received_at.
-- When p_cascade_to_consumptions is true (default), unit_cost / currency
-- updates also rewrite the snapshotted values on order_cost_consumptions for
-- this layer, so historical gross profit reflects the corrected cost basis.
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_cost_layer(
  p_layer_id uuid,
  p_unit_cost numeric default null,
  p_currency text default null,
  p_note text default null,
  p_received_at timestamptz default null,
  p_cascade_to_consumptions boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer record;
  v_new_unit_cost numeric;
  v_new_currency text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select id, unit_cost, currency, note, received_at
  into v_layer
  from public.package_cost_layers
  where id = p_layer_id
  for update;
  if not found then
    raise exception 'cost_layer_not_found';
  end if;

  v_new_unit_cost := coalesce(p_unit_cost, v_layer.unit_cost);
  if v_new_unit_cost < 0 then
    raise exception 'invalid_unit_cost';
  end if;
  v_new_currency := coalesce(nullif(btrim(p_currency), ''), v_layer.currency);

  update public.package_cost_layers
  set unit_cost   = v_new_unit_cost,
      currency    = v_new_currency,
      note        = case
                      when p_note is null then note
                      when btrim(p_note) = '' then null
                      else btrim(p_note)
                    end,
      received_at = coalesce(p_received_at, received_at)
  where id = p_layer_id;

  if coalesce(p_cascade_to_consumptions, true)
     and (v_new_unit_cost is distinct from v_layer.unit_cost
          or v_new_currency is distinct from v_layer.currency) then
    update public.order_cost_consumptions
    set unit_cost = v_new_unit_cost,
        currency  = v_new_currency
    where cost_layer_id = p_layer_id;
  end if;
end;
$$;

revoke all on function public.admin_update_cost_layer(uuid, numeric, text, text, timestamptz, boolean) from public;
grant execute on function public.admin_update_cost_layer(uuid, numeric, text, text, timestamptz, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: admin_delete_cost_layer — only allowed when the layer is untouched
-- (no consumptions, full quantity remaining). Reduces qty_available by the
-- layer quantity. qty_held is preserved unless that would push it past the
-- new qty_available, in which case the call fails so admin sees the conflict.
-- ---------------------------------------------------------------------------
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

  select qty_available, qty_held
  into v_qty_available, v_qty_held
  from public.package_inventory
  where package_id = v_layer.package_id
  for update;

  if found then
    if (v_qty_available - v_layer.quantity) < v_qty_held then
      raise exception 'qty_held_would_exceed_capacity';
    end if;
    update public.package_inventory
    set qty_available = qty_available - v_layer.quantity
    where package_id = v_layer.package_id;
  end if;

  delete from public.package_cost_layers where id = p_layer_id;
end;
$$;

revoke all on function public.admin_delete_cost_layer(uuid) from public;
grant execute on function public.admin_delete_cost_layer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- place_order: same 19-arg signature as 20250515150000, but now consumes cost
-- layers FIFO inside the same transaction and records per-layer COGS
-- snapshots in order_cost_consumptions. Any shortfall (no/insufficient layers)
-- is recorded with unit_cost = NULL so it shows as "cost unknown" in admin.
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
  p_bill_country text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_approved boolean;
  v_pkg record;
  v_qty_available int;
  v_qty_held int;
  v_my_hold_units int;
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
begin
  v_expired := public.release_expired_inventory_holds();

  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select
    (p.approval_status = 'approved')
  into v_approved
  from public.profiles p
  where p.id = v_uid;
  if not found then
    raise exception 'profile_not_found';
  end if;
  if not coalesce(v_approved, false) then
    raise exception 'not_approved';
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

  select pi.qty_available, pi.qty_held
  into v_qty_available, v_qty_held
  from public.package_inventory pi
  where pi.package_id = p_package_id
  for update;

  if not found then
    raise exception 'inventory_missing';
  end if;

  select coalesce(sum(h.quantity), 0)::int
  into v_my_hold_units
  from public.inventory_holds h
  where h.package_id = p_package_id
    and h.agent_profile_id = v_uid
    and h.released_at is null
    and h.expires_at > timezone('utc', now());

  v_sellable := (v_qty_available - v_qty_held) + v_my_hold_units;
  if v_sellable < p_guests then
    raise exception 'insufficient_stock';
  end if;

  v_order_ref := 'ZK-' || to_char(timezone('utc', now()), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_invoice_ref := 'INV-' || to_char(timezone('utc', now()), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

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

  update public.package_inventory
  set qty_available = qty_available - p_guests
  where package_id = p_package_id;

  -- Consume cost layers FIFO and snapshot COGS per layer.
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
    'invoice_id', v_invoice_id,
    'invoice_reference', v_invoice_ref,
    'package_name', v_pkg_name,
    'circuit', v_circuit,
    'total_amount', v_total,
    'currency', v_currency,
    'guests', p_guests
  );
end;
$$;
