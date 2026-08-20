-- Phase 1B — Native inventory foundation (additive only).
--
-- Introduces suppliers, an immutable inventory ledger, deal/manual reservations,
-- shared physical inventory pools with day-capacity consumption, and sourcing
-- shortages. Legacy package_inventory / cost layers / holds / shells remain.
-- No Salesforce or historical rows are deleted.

-- ---------------------------------------------------------------------------
-- suppliers
-- ---------------------------------------------------------------------------
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint suppliers_name_nonempty check (btrim(name) <> ''),
  constraint suppliers_code_nonempty check (code is null or btrim(code) <> '')
);

create unique index if not exists suppliers_name_unique_idx
  on public.suppliers (lower(btrim(name)));

create unique index if not exists suppliers_code_unique_idx
  on public.suppliers (lower(btrim(code)))
  where code is not null;

create index if not exists suppliers_active_idx
  on public.suppliers (active, lower(btrim(name)));

alter table public.suppliers enable row level security;

drop policy if exists "suppliers_admin_all" on public.suppliers;
create policy "suppliers_admin_all"
  on public.suppliers for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "suppliers_approved_select" on public.suppliers;
create policy "suppliers_approved_select"
  on public.suppliers for select
  using (
    auth.uid() is not null
    and exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid()
        and pr.approval_status = 'approved'
    )
  );

comment on table public.suppliers is
  'Structured supplier directory. Free-text purchase_orders.supplier / cost layer source remain for legacy compatibility.';

-- ---------------------------------------------------------------------------
-- Link existing purchase/cost rows to suppliers (nullable FKs)
-- ---------------------------------------------------------------------------
alter table public.purchase_orders
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;

create index if not exists purchase_orders_supplier_id_idx
  on public.purchase_orders (supplier_id)
  where supplier_id is not null;

alter table public.package_cost_layers
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;

create index if not exists package_cost_layers_supplier_id_idx
  on public.package_cost_layers (supplier_id)
  where supplier_id is not null;

-- ---------------------------------------------------------------------------
-- inventory_pools + day capacity + package day consumption
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_pools (
  id uuid primary key default gen_random_uuid(),
  race_id text not null references public.races (id) on delete cascade,
  name text not null,
  inventory_group_id text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_pools_name_nonempty check (btrim(name) <> ''),
  constraint inventory_pools_group_nonempty check (
    inventory_group_id is null or btrim(inventory_group_id) <> ''
  )
);

create unique index if not exists inventory_pools_group_unique_idx
  on public.inventory_pools (inventory_group_id)
  where inventory_group_id is not null;

create index if not exists inventory_pools_race_idx
  on public.inventory_pools (race_id, active);

alter table public.inventory_pools enable row level security;

drop policy if exists "inventory_pools_admin_all" on public.inventory_pools;
create policy "inventory_pools_admin_all"
  on public.inventory_pools for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "inventory_pools_approved_select" on public.inventory_pools;
create policy "inventory_pools_approved_select"
  on public.inventory_pools for select
  using (
    auth.uid() is not null
    and exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid()
        and pr.approval_status = 'approved'
    )
  );

comment on table public.inventory_pools is
  'Shared physical stock pool for genuine day / 2-day / 3-day sellable products. Replaces Salesforce shell reporting for native inventory math.';

create table if not exists public.inventory_pool_day_capacity (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.inventory_pools (id) on delete cascade,
  day_slot text not null,
  owned_qty int not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_pool_day_capacity_slot_check
    check (day_slot in ('thursday', 'friday', 'saturday', 'sunday')),
  constraint inventory_pool_day_capacity_owned_nonneg check (owned_qty >= 0),
  constraint inventory_pool_day_capacity_unique unique (pool_id, day_slot)
);

create index if not exists inventory_pool_day_capacity_pool_idx
  on public.inventory_pool_day_capacity (pool_id);

alter table public.inventory_pool_day_capacity enable row level security;

drop policy if exists "inventory_pool_day_capacity_admin_all" on public.inventory_pool_day_capacity;
create policy "inventory_pool_day_capacity_admin_all"
  on public.inventory_pool_day_capacity for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "inventory_pool_day_capacity_approved_select" on public.inventory_pool_day_capacity;
create policy "inventory_pool_day_capacity_approved_select"
  on public.inventory_pool_day_capacity for select
  using (
    auth.uid() is not null
    and exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid()
        and pr.approval_status = 'approved'
    )
  );

create table if not exists public.package_day_consumption (
  id uuid primary key default gen_random_uuid(),
  package_id text not null references public.packages (id) on delete cascade,
  day_slot text not null,
  units_per_sale int not null default 1,
  created_at timestamptz not null default timezone('utc', now()),
  constraint package_day_consumption_slot_check
    check (day_slot in ('thursday', 'friday', 'saturday', 'sunday')),
  constraint package_day_consumption_units_pos check (units_per_sale > 0),
  constraint package_day_consumption_unique unique (package_id, day_slot)
);

create index if not exists package_day_consumption_package_idx
  on public.package_day_consumption (package_id);

alter table public.package_day_consumption enable row level security;

drop policy if exists "package_day_consumption_admin_all" on public.package_day_consumption;
create policy "package_day_consumption_admin_all"
  on public.package_day_consumption for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "package_day_consumption_approved_select" on public.package_day_consumption;
create policy "package_day_consumption_approved_select"
  on public.package_day_consumption for select
  using (
    auth.uid() is not null
    and exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid()
        and pr.approval_status = 'approved'
    )
  );

alter table public.packages
  add column if not exists inventory_pool_id uuid references public.inventory_pools (id) on delete set null;

create index if not exists packages_inventory_pool_id_idx
  on public.packages (inventory_pool_id)
  where inventory_pool_id is not null;

comment on column public.packages.inventory_pool_id is
  'Optional native shared physical pool. Legacy inventory_group_id remains during cutover.';

-- ---------------------------------------------------------------------------
-- Immutable ledger
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  package_id text not null references public.packages (id) on delete cascade,
  pool_id uuid references public.inventory_pools (id) on delete set null,
  entry_type text not null,
  quantity_delta int not null default 0,
  quantity_absolute int,
  reason text not null,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  source_table text,
  source_id text,
  cost_layer_id uuid references public.package_cost_layers (id) on delete set null,
  purchase_order_id uuid references public.purchase_orders (id) on delete set null,
  supplier_id uuid references public.suppliers (id) on delete set null,
  reservation_id uuid,
  deal_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint inventory_ledger_entries_type_check check (
    entry_type in (
      'purchase',
      'adjustment',
      'hold',
      'hold_release',
      'reservation',
      'reservation_release',
      'order_commit',
      'order_cancel',
      'opening_balance',
      'sourcing_shortage',
      'sourcing_clear',
      'day_capacity_seed'
    )
  ),
  constraint inventory_ledger_entries_reason_nonempty check (btrim(reason) <> ''),
  constraint inventory_ledger_entries_absolute_nonneg check (
    quantity_absolute is null or quantity_absolute >= 0
  )
);

create unique index if not exists inventory_ledger_entries_source_unique_idx
  on public.inventory_ledger_entries (source_table, source_id, entry_type)
  where source_table is not null and source_id is not null;

create index if not exists inventory_ledger_entries_package_idx
  on public.inventory_ledger_entries (package_id, created_at desc);

create index if not exists inventory_ledger_entries_pool_idx
  on public.inventory_ledger_entries (pool_id, created_at desc)
  where pool_id is not null;

create index if not exists inventory_ledger_entries_type_idx
  on public.inventory_ledger_entries (entry_type, created_at desc);

alter table public.inventory_ledger_entries enable row level security;

drop policy if exists "inventory_ledger_entries_admin_select" on public.inventory_ledger_entries;
create policy "inventory_ledger_entries_admin_select"
  on public.inventory_ledger_entries for select
  using (public.is_admin());

drop policy if exists "inventory_ledger_entries_admin_insert" on public.inventory_ledger_entries;
create policy "inventory_ledger_entries_admin_insert"
  on public.inventory_ledger_entries for insert
  with check (public.is_admin());

comment on table public.inventory_ledger_entries is
  'Append-only inventory audit/ledger. package_inventory remains the operational projection during cutover.';

-- ---------------------------------------------------------------------------
-- Reservations (deal holds + bridge to manual holds)
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  package_id text not null references public.packages (id) on delete cascade,
  pool_id uuid references public.inventory_pools (id) on delete set null,
  kind text not null,
  quantity int not null,
  status text not null default 'active',
  agent_profile_id uuid references public.profiles (id) on delete set null,
  deal_id uuid,
  inventory_hold_id uuid,
  expires_at timestamptz,
  released_at timestamptz,
  converted_at timestamptz,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_reservations_kind_check
    check (kind in ('manual_hold', 'deal_reservation', 'sourcing')),
  constraint inventory_reservations_status_check
    check (status in ('active', 'released', 'converted', 'expired', 'cancelled')),
  constraint inventory_reservations_quantity_pos check (quantity > 0)
);

create index if not exists inventory_reservations_package_status_idx
  on public.inventory_reservations (package_id, status, expires_at);

create index if not exists inventory_reservations_deal_idx
  on public.inventory_reservations (deal_id)
  where deal_id is not null;

create index if not exists inventory_reservations_hold_idx
  on public.inventory_reservations (inventory_hold_id)
  where inventory_hold_id is not null;

alter table public.inventory_reservations enable row level security;

drop policy if exists "inventory_reservations_admin_all" on public.inventory_reservations;
create policy "inventory_reservations_admin_all"
  on public.inventory_reservations for all
  using (public.is_admin())
  with check (public.is_admin());

comment on table public.inventory_reservations is
  'Native reservation abstraction for booking-form holds and future deals. Manual inventory_holds remain during cutover.';

alter table public.inventory_ledger_entries
  drop constraint if exists inventory_ledger_entries_reservation_fk;

alter table public.inventory_ledger_entries
  add constraint inventory_ledger_entries_reservation_fk
  foreign key (reservation_id) references public.inventory_reservations (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Sourcing shortages (negative stock list substrate)
-- ---------------------------------------------------------------------------
create table if not exists public.sourcing_shortages (
  id uuid primary key default gen_random_uuid(),
  package_id text not null references public.packages (id) on delete cascade,
  pool_id uuid references public.inventory_pools (id) on delete set null,
  deal_id uuid,
  quantity int not null,
  unit_cost_quoted numeric,
  currency text not null default 'USD',
  supplier_id uuid references public.suppliers (id) on delete set null,
  supplier_quote_at timestamptz,
  status text not null default 'open',
  purchase_order_id uuid references public.purchase_orders (id) on delete set null,
  cost_layer_id uuid references public.package_cost_layers (id) on delete set null,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  cleared_at timestamptz,
  constraint sourcing_shortages_quantity_pos check (quantity > 0),
  constraint sourcing_shortages_status_check check (
    status in ('open', 'quoted', 'confirmed', 'purchased', 'cancelled')
  )
);

create index if not exists sourcing_shortages_status_idx
  on public.sourcing_shortages (status, created_at desc);

create index if not exists sourcing_shortages_package_idx
  on public.sourcing_shortages (package_id, status);

alter table public.sourcing_shortages enable row level security;

drop policy if exists "sourcing_shortages_admin_all" on public.sourcing_shortages;
create policy "sourcing_shortages_admin_all"
  on public.sourcing_shortages for all
  using (public.is_admin())
  with check (public.is_admin());

comment on table public.sourcing_shortages is
  'Negative-stock / sourcing records. Never increase storefront sellable quantity.';

-- ---------------------------------------------------------------------------
-- Helper: ensure / resolve supplier by name
-- ---------------------------------------------------------------------------
create or replace function public.admin_ensure_supplier(
  p_name text,
  p_code text default null,
  p_contact_name text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  v_name := nullif(btrim(p_name), '');
  if v_name is null then
    raise exception 'supplier_name_required';
  end if;

  select id into v_id
  from public.suppliers
  where lower(btrim(name)) = lower(v_name)
  limit 1;

  if v_id is not null then
    update public.suppliers
    set code = coalesce(nullif(btrim(p_code), ''), code),
        contact_name = coalesce(nullif(btrim(p_contact_name), ''), contact_name),
        contact_email = coalesce(nullif(btrim(p_contact_email), ''), contact_email),
        contact_phone = coalesce(nullif(btrim(p_contact_phone), ''), contact_phone),
        notes = coalesce(nullif(btrim(p_notes), ''), notes),
        active = true,
        updated_at = timezone('utc', now())
    where id = v_id;
    return v_id;
  end if;

  insert into public.suppliers (
    name, code, contact_name, contact_email, contact_phone, notes, created_by
  ) values (
    v_name,
    nullif(btrim(p_code), ''),
    nullif(btrim(p_contact_name), ''),
    nullif(btrim(p_contact_email), ''),
    nullif(btrim(p_contact_phone), ''),
    nullif(btrim(p_notes), ''),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.admin_ensure_supplier(text, text, text, text, text, text) from public;
grant execute on function public.admin_ensure_supplier(text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Append ledger entry (idempotent by source)
-- ---------------------------------------------------------------------------
create or replace function public.admin_append_inventory_ledger(
  p_package_id text,
  p_entry_type text,
  p_quantity_delta int,
  p_reason text,
  p_quantity_absolute int default null,
  p_pool_id uuid default null,
  p_source_table text default null,
  p_source_id text default null,
  p_cost_layer_id uuid default null,
  p_purchase_order_id uuid default null,
  p_supplier_id uuid default null,
  p_reservation_id uuid default null,
  p_deal_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_pkg text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  v_pkg := nullif(btrim(p_package_id), '');
  if v_pkg is null then
    raise exception 'package_id_required';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'reason_required';
  end if;
  if p_entry_type is null or btrim(p_entry_type) = '' then
    raise exception 'entry_type_required';
  end if;

  if p_source_table is not null and p_source_id is not null then
    select id into v_id
    from public.inventory_ledger_entries
    where source_table = p_source_table
      and source_id = p_source_id
      and entry_type = p_entry_type
    limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.inventory_ledger_entries (
    package_id,
    pool_id,
    entry_type,
    quantity_delta,
    quantity_absolute,
    reason,
    actor_profile_id,
    source_table,
    source_id,
    cost_layer_id,
    purchase_order_id,
    supplier_id,
    reservation_id,
    deal_id,
    metadata
  ) values (
    v_pkg,
    p_pool_id,
    p_entry_type,
    coalesce(p_quantity_delta, 0),
    p_quantity_absolute,
    btrim(p_reason),
    auth.uid(),
    nullif(btrim(p_source_table), ''),
    nullif(btrim(p_source_id), ''),
    p_cost_layer_id,
    p_purchase_order_id,
    p_supplier_id,
    p_reservation_id,
    p_deal_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.admin_append_inventory_ledger(
  text, text, int, text, int, uuid, text, text, uuid, uuid, uuid, uuid, uuid, jsonb
) from public;
grant execute on function public.admin_append_inventory_ledger(
  text, text, int, text, int, uuid, text, text, uuid, uuid, uuid, uuid, uuid, jsonb
) to authenticated;

-- ---------------------------------------------------------------------------
-- Opening balance / verified live stock reset
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_opening_balance(
  p_package_id text,
  p_verified_qty int,
  p_reason text default 'Opening balance reset'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg text;
  v_qty int;
  v_held int;
  v_available int;
  v_delta int;
  v_ledger_id uuid;
  v_pool uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  v_pkg := nullif(btrim(p_package_id), '');
  if v_pkg is null then
    raise exception 'package_id_required';
  end if;

  v_qty := greatest(0, coalesce(p_verified_qty, 0));

  select coalesce(qty_held, 0), coalesce(qty_available, 0)
  into v_held, v_available
  from public.package_inventory
  where package_id = v_pkg
  for update;

  if not found then
    insert into public.package_inventory (package_id, qty_available, qty_held)
    values (v_pkg, v_qty, 0);
    v_held := 0;
    v_available := 0;
  end if;

  if v_qty < v_held then
    raise exception 'opening_balance_below_held';
  end if;

  v_delta := v_qty - v_available;

  update public.package_inventory
  set qty_available = v_qty
  where package_id = v_pkg;

  select inventory_pool_id into v_pool
  from public.packages
  where id = v_pkg;

  v_ledger_id := public.admin_append_inventory_ledger(
    v_pkg,
    'opening_balance',
    v_delta,
    coalesce(nullif(btrim(p_reason), ''), 'Opening balance reset'),
    v_qty,
    v_pool,
    'package_inventory',
    v_pkg || ':opening:' || timezone('utc', now())::text,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object('previous_available', v_available, 'held', v_held)
  );

  return v_ledger_id;
end;
$$;

revoke all on function public.admin_set_opening_balance(text, int, text) from public;
grant execute on function public.admin_set_opening_balance(text, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Safe stock adjustment with ledger reason
-- ---------------------------------------------------------------------------
create or replace function public.admin_adjust_stock_with_reason(
  p_package_id text,
  p_delta int,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg text;
  v_delta int;
  v_available int;
  v_held int;
  v_next int;
  v_ledger_id uuid;
  v_pool uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  v_pkg := nullif(btrim(p_package_id), '');
  if v_pkg is null then
    raise exception 'package_id_required';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'reason_required';
  end if;

  v_delta := coalesce(p_delta, 0);
  if v_delta = 0 then
    raise exception 'delta_required';
  end if;

  select coalesce(qty_available, 0), coalesce(qty_held, 0)
  into v_available, v_held
  from public.package_inventory
  where package_id = v_pkg
  for update;

  if not found then
    insert into public.package_inventory (package_id, qty_available, qty_held)
    values (v_pkg, greatest(0, v_delta), 0);
    v_available := 0;
    v_held := 0;
  end if;

  v_next := v_available + v_delta;
  if v_next < v_held then
    raise exception 'adjustment_below_held';
  end if;
  if v_next < 0 then
    raise exception 'adjustment_below_zero';
  end if;

  -- Prefer linked cascade when available so day/2-day/3-day stay coherent.
  begin
    perform public.adjust_linked_inventory_available(v_pkg, v_delta);
  exception
    when undefined_function then
      update public.package_inventory
      set qty_available = v_next
      where package_id = v_pkg;
  end;

  select inventory_pool_id into v_pool
  from public.packages
  where id = v_pkg;

  v_ledger_id := public.admin_append_inventory_ledger(
    v_pkg,
    'adjustment',
    v_delta,
    btrim(p_reason),
    null,
    v_pool,
    'manual_adjustment',
    v_pkg || ':adj:' || timezone('utc', now())::text,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object('previous_available', v_available)
  );

  return v_ledger_id;
end;
$$;

revoke all on function public.admin_adjust_stock_with_reason(text, int, text) from public;
grant execute on function public.admin_adjust_stock_with_reason(text, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Day consumption helpers for a package duration
-- ---------------------------------------------------------------------------
create or replace function public.seed_package_day_consumption(
  p_package_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg text;
  v_duration text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  v_pkg := nullif(btrim(p_package_id), '');
  if v_pkg is null then
    return;
  end if;

  select duration into v_duration
  from public.packages
  where id = v_pkg;

  delete from public.package_day_consumption where package_id = v_pkg;

  if v_duration = '3_day' then
    insert into public.package_day_consumption (package_id, day_slot, units_per_sale)
    values
      (v_pkg, 'friday', 1),
      (v_pkg, 'saturday', 1),
      (v_pkg, 'sunday', 1);
  elsif v_duration = '2_day' then
    insert into public.package_day_consumption (package_id, day_slot, units_per_sale)
    values
      (v_pkg, 'saturday', 1),
      (v_pkg, 'sunday', 1);
  elsif v_duration = 'thursday_only' then
    insert into public.package_day_consumption (package_id, day_slot, units_per_sale)
    values (v_pkg, 'thursday', 1);
  elsif v_duration = 'friday_only' then
    insert into public.package_day_consumption (package_id, day_slot, units_per_sale)
    values (v_pkg, 'friday', 1);
  elsif v_duration = 'saturday_only' then
    insert into public.package_day_consumption (package_id, day_slot, units_per_sale)
    values (v_pkg, 'saturday', 1);
  elsif v_duration = 'sunday_only' then
    insert into public.package_day_consumption (package_id, day_slot, units_per_sale)
    values (v_pkg, 'sunday', 1);
  end if;
end;
$$;

revoke all on function public.seed_package_day_consumption(text) from public;
grant execute on function public.seed_package_day_consumption(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Ensure pool for an inventory_group_id and link member packages
-- ---------------------------------------------------------------------------
create or replace function public.admin_ensure_inventory_pool_for_group(
  p_inventory_group_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group text;
  v_pool uuid;
  v_race text;
  v_name text;
  v_pkg record;
  v_owned int;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  v_group := nullif(btrim(p_inventory_group_id), '');
  if v_group is null then
    raise exception 'inventory_group_id_required';
  end if;

  select id into v_pool
  from public.inventory_pools
  where inventory_group_id = v_group
  limit 1;

  if v_pool is null then
    select p.race_id,
           coalesce(
             (
               select p2.name
               from public.packages p2
               where p2.inventory_group_id = v_group
                 and p2.duration = '3_day'
                 and p2.shell_parent_package_id is null
               order by p2.name
               limit 1
             ),
             v_group
           )
    into v_race, v_name
    from public.packages p
    where p.inventory_group_id = v_group
      and p.shell_parent_package_id is null
    limit 1;

    if v_race is null then
      raise exception 'inventory_group_not_found';
    end if;

    insert into public.inventory_pools (race_id, name, inventory_group_id)
    values (v_race, v_name, v_group)
    returning id into v_pool;
  end if;

  update public.packages
  set inventory_pool_id = v_pool
  where inventory_group_id = v_group
    and shell_parent_package_id is null
    and (inventory_pool_id is distinct from v_pool);

  for v_pkg in
    select id
    from public.packages
    where inventory_group_id = v_group
      and shell_parent_package_id is null
  loop
    perform public.seed_package_day_consumption(v_pkg.id);
  end loop;

  -- Seed day capacity from the 3-day parent's purchased cost layers when present,
  -- otherwise from its package_inventory sellable+held projection.
  select greatest(
    coalesce((
      select sum(pcl.quantity)::int
      from public.package_cost_layers pcl
      join public.packages p on p.id = pcl.package_id
      where p.inventory_group_id = v_group
        and p.duration = '3_day'
        and p.shell_parent_package_id is null
    ), 0),
    coalesce((
      select pi.qty_available
      from public.package_inventory pi
      join public.packages p on p.id = pi.package_id
      where p.inventory_group_id = v_group
        and p.duration = '3_day'
        and p.shell_parent_package_id is null
      limit 1
    ), 0)
  )
  into v_owned;

  insert into public.inventory_pool_day_capacity (pool_id, day_slot, owned_qty)
  values
    (v_pool, 'friday', coalesce(v_owned, 0)),
    (v_pool, 'saturday', coalesce(v_owned, 0)),
    (v_pool, 'sunday', coalesce(v_owned, 0))
  on conflict (pool_id, day_slot) do update
  set owned_qty = excluded.owned_qty,
      updated_at = timezone('utc', now());

  -- Thursday only for groups that actually sell Thursday products.
  if exists (
    select 1
    from public.packages
    where inventory_group_id = v_group
      and duration = 'thursday_only'
      and shell_parent_package_id is null
  ) then
    insert into public.inventory_pool_day_capacity (pool_id, day_slot, owned_qty)
    values (v_pool, 'thursday', coalesce(v_owned, 0))
    on conflict (pool_id, day_slot) do update
    set owned_qty = excluded.owned_qty,
        updated_at = timezone('utc', now());
  end if;

  return v_pool;
end;
$$;

revoke all on function public.admin_ensure_inventory_pool_for_group(text) from public;
grant execute on function public.admin_ensure_inventory_pool_for_group(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Native availability projection (compatibility view)
-- ---------------------------------------------------------------------------
create or replace view public.native_package_availability as
select
  p.id as package_id,
  p.race_id,
  p.name,
  p.duration,
  p.inventory_group_id,
  p.inventory_pool_id,
  p.shell_parent_package_id,
  (p.shell_parent_package_id is not null) as is_legacy_shell,
  coalesce(pi.qty_available, 0) as qty_available,
  coalesce(pi.qty_held, 0) as qty_held,
  greatest(coalesce(pi.qty_available, 0) - coalesce(pi.qty_held, 0), 0) as legacy_sellable,
  coalesce((
    select sum(pcl.quantity_remaining)::int
    from public.package_cost_layers pcl
    where pcl.package_id = p.id
  ), 0) as layer_units_remaining,
  coalesce((
    select sum(r.quantity)::int
    from public.inventory_reservations r
    where r.package_id = p.id
      and r.status = 'active'
      and (r.expires_at is null or r.expires_at > timezone('utc', now()))
  ), 0) as active_reservations,
  coalesce((
    select sum(s.quantity)::int
    from public.sourcing_shortages s
    where s.package_id = p.id
      and s.status in ('open', 'quoted', 'confirmed')
  ), 0) as open_shortage_qty
from public.packages p
left join public.package_inventory pi on pi.package_id = p.id;

comment on view public.native_package_availability is
  'Supabase-only inventory reconciliation projection for Phase 1B. Storefront still uses package_inventory.';

grant select on public.native_package_availability to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill suppliers from free-text PO / cost-layer source values
-- ---------------------------------------------------------------------------
insert into public.suppliers (name, created_at, updated_at)
select distinct on (lower(btrim(po.supplier)))
       btrim(po.supplier) as name,
       timezone('utc', now()),
       timezone('utc', now())
from public.purchase_orders po
where nullif(btrim(po.supplier), '') is not null
  and not exists (
    select 1 from public.suppliers s
    where lower(btrim(s.name)) = lower(btrim(po.supplier))
  )
order by lower(btrim(po.supplier));

insert into public.suppliers (name, created_at, updated_at)
select distinct on (lower(btrim(pcl.source)))
       btrim(pcl.source) as name,
       timezone('utc', now()),
       timezone('utc', now())
from public.package_cost_layers pcl
where nullif(btrim(pcl.source), '') is not null
  and not exists (
    select 1 from public.suppliers s
    where lower(btrim(s.name)) = lower(btrim(pcl.source))
  )
order by lower(btrim(pcl.source));

update public.purchase_orders po
set supplier_id = s.id
from public.suppliers s
where po.supplier_id is null
  and lower(btrim(po.supplier)) = lower(btrim(s.name));

update public.package_cost_layers pcl
set supplier_id = s.id
from public.suppliers s
where pcl.supplier_id is null
  and pcl.source is not null
  and lower(btrim(pcl.source)) = lower(btrim(s.name));

update public.package_cost_layers pcl
set supplier_id = po.supplier_id
from public.purchase_orders po
where pcl.supplier_id is null
  and pcl.purchase_order_id = po.id
  and po.supplier_id is not null;

-- ---------------------------------------------------------------------------
-- Backfill pools / day consumption for existing linked groups (non-shell).
-- Inline (not via admin RPC) so migration apply has no auth.uid() / is_admin().
-- ---------------------------------------------------------------------------
insert into public.inventory_pools (race_id, name, inventory_group_id)
select distinct on (p.inventory_group_id)
  p.race_id,
  coalesce(
    (
      select p2.name
      from public.packages p2
      where p2.inventory_group_id = p.inventory_group_id
        and p2.duration = '3_day'
        and p2.shell_parent_package_id is null
      order by p2.name
      limit 1
    ),
    p.inventory_group_id
  ) as name,
  p.inventory_group_id
from public.packages p
where p.inventory_group_id is not null
  and btrim(p.inventory_group_id) <> ''
  and p.shell_parent_package_id is null
  and not exists (
    select 1
    from public.inventory_pools ip
    where ip.inventory_group_id = p.inventory_group_id
  )
order by p.inventory_group_id, p.name;

update public.packages p
set inventory_pool_id = ip.id
from public.inventory_pools ip
where p.inventory_group_id = ip.inventory_group_id
  and p.shell_parent_package_id is null
  and (p.inventory_pool_id is distinct from ip.id);

insert into public.package_day_consumption (package_id, day_slot, units_per_sale)
select p.id, d.day_slot, 1
from public.packages p
cross join lateral (
  select unnest(
    case p.duration
      when '3_day' then array['friday', 'saturday', 'sunday']
      when '2_day' then array['saturday', 'sunday']
      when 'thursday_only' then array['thursday']
      when 'friday_only' then array['friday']
      when 'saturday_only' then array['saturday']
      when 'sunday_only' then array['sunday']
      else array[]::text[]
    end
  ) as day_slot
) d
where p.shell_parent_package_id is null
  and p.duration in (
    '3_day', '2_day', 'thursday_only', 'friday_only', 'saturday_only', 'sunday_only'
  )
on conflict (package_id, day_slot) do nothing;

insert into public.inventory_pool_day_capacity (pool_id, day_slot, owned_qty)
select
  ip.id,
  slot.day_slot,
  greatest(
    coalesce((
      select sum(pcl.quantity)::int
      from public.package_cost_layers pcl
      join public.packages p on p.id = pcl.package_id
      where p.inventory_pool_id = ip.id
        and p.duration = '3_day'
        and p.shell_parent_package_id is null
    ), 0),
    coalesce((
      select pi.qty_available
      from public.package_inventory pi
      join public.packages p on p.id = pi.package_id
      where p.inventory_pool_id = ip.id
        and p.duration = '3_day'
        and p.shell_parent_package_id is null
      limit 1
    ), 0)
  ) as owned_qty
from public.inventory_pools ip
cross join (
  select unnest(array['friday', 'saturday', 'sunday']) as day_slot
) slot
on conflict (pool_id, day_slot) do update
set owned_qty = excluded.owned_qty,
    updated_at = timezone('utc', now());

insert into public.inventory_pool_day_capacity (pool_id, day_slot, owned_qty)
select
  ip.id,
  'thursday',
  coalesce((
    select owned_qty
    from public.inventory_pool_day_capacity c
    where c.pool_id = ip.id and c.day_slot = 'friday'
    limit 1
  ), 0)
from public.inventory_pools ip
where exists (
  select 1
  from public.packages p
  where p.inventory_pool_id = ip.id
    and p.duration = 'thursday_only'
    and p.shell_parent_package_id is null
)
on conflict (pool_id, day_slot) do update
set owned_qty = excluded.owned_qty,
    updated_at = timezone('utc', now());
