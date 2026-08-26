-- Inventory Allocation Integrity
-- ==============================
--
-- This migration is deliberately additive.  Existing package_inventory,
-- inventory_reservations and order_cost_consumptions remain in service while
-- inventory_allocations becomes the quantity-level source of allocation truth.
-- order_cost_consumptions remains the compatibility COGS projection.
--
-- Design invariants:
--   * every owned allocation names the sold package and physical cost layer;
--   * reserved quantities reduce canonical availability without prematurely
--     changing package_cost_layers.quantity_remaining;
--   * committed quantities have already reduced quantity_remaining;
--   * all candidate cost layers are row-locked before capacity is checked;
--   * state/lock changes are recorded in an append-only event table;
--   * request keys make retries harmless;
--   * brokered demand and historical reconciliation gaps are shortages, never
--     negative owned inventory.

-- ---------------------------------------------------------------------------
-- Canonical allocations, shortages and append-only audit
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_allocation_control (
  singleton boolean primary key default true check (singleton),
  enforcement_enabled boolean not null default true,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references public.profiles(id) on delete set null
);
insert into public.inventory_allocation_control (singleton, enforcement_enabled)
values (true, true)
on conflict (singleton) do nothing;
alter table public.inventory_allocation_control enable row level security;
drop policy if exists "inventory_allocation_control_staff_select"
  on public.inventory_allocation_control;
create policy "inventory_allocation_control_staff_select"
  on public.inventory_allocation_control for select
  using (public.is_admin());

create or replace function public.inventory_allocation_enforcement_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select control.enforcement_enabled
    from public.inventory_allocation_control control
    where control.singleton
  ), true);
$$;

create or replace function public.inventory_set_allocation_enforcement(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer record;
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if coalesce(p_enabled, true) then
    for v_layer in select id from public.package_cost_layers order by id loop
      perform public.assert_inventory_layer_capacity(v_layer.id);
    end loop;
  end if;
  update public.inventory_allocation_control
  set enforcement_enabled = coalesce(p_enabled, true),
      updated_at = timezone('utc', now()),
      updated_by = auth.uid()
  where singleton;
  return coalesce(p_enabled, true);
end;
$$;

create table if not exists public.inventory_allocations (
  id uuid primary key default gen_random_uuid(),
  cost_layer_id uuid not null
    references public.package_cost_layers(id) on delete restrict,
  package_id text not null
    references public.packages(id) on delete restrict,
  deal_id uuid references public.deals(id) on delete set null,
  deal_line_item_id uuid references public.deal_line_items(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  order_line_item_id uuid references public.order_line_items(id) on delete set null,
  reservation_id uuid references public.inventory_reservations(id) on delete set null,
  order_cost_consumption_id uuid
    references public.order_cost_consumptions(id) on delete set null,
  quantity int not null,
  state text not null default 'reserved',
  source text not null,
  request_key text not null,
  idempotency_key text not null,
  lock_state text not null default 'mutable',
  locked_at timestamptz,
  locked_reason text,
  reserved_at timestamptz,
  committed_at timestamptz,
  released_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_allocations_quantity_pos check (quantity > 0),
  constraint inventory_allocations_state_check
    check (state in ('reserved', 'committed', 'released')),
  constraint inventory_allocations_source_nonempty check (btrim(source) <> ''),
  constraint inventory_allocations_request_key_nonempty check (btrim(request_key) <> ''),
  constraint inventory_allocations_idempotency_key_nonempty check (btrim(idempotency_key) <> ''),
  constraint inventory_allocations_lock_state_check
    check (lock_state in ('mutable', 'fulfilment_locked')),
  constraint inventory_allocations_state_timestamp_check check (
    (state <> 'reserved' or reserved_at is not null)
    and (state <> 'committed' or committed_at is not null)
    and (state <> 'released' or released_at is not null)
  )
);

create unique index if not exists inventory_allocations_idempotency_unique_idx
  on public.inventory_allocations(idempotency_key);
create unique index if not exists inventory_allocations_occ_unique_idx
  on public.inventory_allocations(order_cost_consumption_id)
  where order_cost_consumption_id is not null;
create index if not exists inventory_allocations_layer_state_idx
  on public.inventory_allocations(cost_layer_id, state);
create index if not exists inventory_allocations_package_state_idx
  on public.inventory_allocations(package_id, state);
create index if not exists inventory_allocations_request_idx
  on public.inventory_allocations(request_key, state);
create index if not exists inventory_allocations_deal_line_idx
  on public.inventory_allocations(deal_line_item_id, state)
  where deal_line_item_id is not null;
create index if not exists inventory_allocations_order_line_idx
  on public.inventory_allocations(order_line_item_id, state)
  where order_line_item_id is not null;
create index if not exists inventory_allocations_reservation_idx
  on public.inventory_allocations(reservation_id, state)
  where reservation_id is not null;

comment on table public.inventory_allocations is
  'Canonical quantity-level owned-stock allocation. Reserved rows consume canonical availability; committed rows are mirrored to order_cost_consumptions where an order exists.';
comment on column public.inventory_allocations.package_id is
  'The sold package. cost_layer_id may belong to its linked/shared physical ledger package.';
comment on column public.inventory_allocations.request_key is
  'Stable logical operation key shared by every layer chunk in one allocation request.';
comment on column public.inventory_allocations.idempotency_key is
  'Unique layer-chunk key. Retries with the same key never allocate twice.';
comment on column public.inventory_allocations.lock_state is
  'fulfilment_locked prevents release/reassignment after operations fulfilment has started.';

create table if not exists public.inventory_shortages (
  id uuid primary key default gen_random_uuid(),
  package_id text not null references public.packages(id) on delete restrict,
  deal_id uuid references public.deals(id) on delete set null,
  deal_line_item_id uuid references public.deal_line_items(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  order_line_item_id uuid references public.order_line_items(id) on delete set null,
  sourcing_shortage_id uuid references public.sourcing_shortages(id) on delete set null,
  shortage_type text not null,
  quantity int not null,
  status text not null default 'open',
  source text not null,
  idempotency_key text not null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_shortages_type_check
    check (shortage_type in ('historical_reconciliation', 'brokered')),
  constraint inventory_shortages_quantity_pos check (quantity > 0),
  constraint inventory_shortages_status_check
    check (status in ('open', 'resolved', 'cancelled')),
  constraint inventory_shortages_source_nonempty check (btrim(source) <> ''),
  constraint inventory_shortages_idempotency_nonempty check (btrim(idempotency_key) <> '')
);

create unique index if not exists inventory_shortages_idempotency_unique_idx
  on public.inventory_shortages(idempotency_key);
create index if not exists inventory_shortages_work_queue_idx
  on public.inventory_shortages(shortage_type, status, created_at);
create index if not exists inventory_shortages_package_idx
  on public.inventory_shortages(package_id, status);
create index if not exists inventory_shortages_deal_line_idx
  on public.inventory_shortages(deal_line_item_id, status)
  where deal_line_item_id is not null;

comment on table public.inventory_shortages is
  'Demand not backed by owned stock. historical_reconciliation is legacy won-sale evidence; brokered is intentionally supplier-sourced demand.';

create table if not exists public.inventory_allocation_events (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null
    references public.inventory_allocations(id) on delete restrict,
  event_type text not null,
  from_state text,
  to_state text,
  from_lock_state text,
  to_lock_state text,
  quantity int not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default timezone('utc', now()),
  constraint inventory_allocation_events_type_nonempty check (btrim(event_type) <> ''),
  constraint inventory_allocation_events_quantity_pos check (quantity > 0)
);

create index if not exists inventory_allocation_events_allocation_idx
  on public.inventory_allocation_events(allocation_id, occurred_at, id);
create index if not exists inventory_allocation_events_occurred_idx
  on public.inventory_allocation_events(occurred_at desc);

comment on table public.inventory_allocation_events is
  'Append-only audit of every allocation creation, state transition and fulfilment lock transition.';

alter table public.inventory_allocations enable row level security;
alter table public.inventory_shortages enable row level security;
alter table public.inventory_allocation_events enable row level security;

drop policy if exists "inventory_allocations_staff_select" on public.inventory_allocations;
create policy "inventory_allocations_staff_select"
  on public.inventory_allocations for select
  using (
    public.is_admin()
    or public.has_cms_permission('operations.view')
    or public.has_cms_permission('deals.manage')
  );

drop policy if exists "inventory_shortages_staff_select" on public.inventory_shortages;
create policy "inventory_shortages_staff_select"
  on public.inventory_shortages for select
  using (
    public.is_admin()
    or public.has_cms_permission('operations.view')
    or public.has_cms_permission('deals.manage')
  );

drop policy if exists "inventory_allocation_events_staff_select" on public.inventory_allocation_events;
create policy "inventory_allocation_events_staff_select"
  on public.inventory_allocation_events for select
  using (
    public.is_admin()
    or public.has_cms_permission('operations.view')
    or public.has_cms_permission('deals.manage')
  );

-- No INSERT/UPDATE/DELETE policies are intentional. Mutations go through
-- SECURITY DEFINER functions and triggers, keeping audit and locking invariant.

-- ---------------------------------------------------------------------------
-- Audit and append-only guards
-- ---------------------------------------------------------------------------

create or replace function public.audit_inventory_allocation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.inventory_allocation_events (
      allocation_id, event_type, to_state, to_lock_state, quantity,
      actor_profile_id, reason, metadata
    ) values (
      new.id, 'allocated', new.state, new.lock_state, new.quantity,
      auth.uid(), nullif(new.metadata->>'reason', ''), new.metadata
    );
  elsif new.state is distinct from old.state
     or new.lock_state is distinct from old.lock_state then
    insert into public.inventory_allocation_events (
      allocation_id, event_type, from_state, to_state,
      from_lock_state, to_lock_state, quantity, actor_profile_id,
      reason, metadata
    ) values (
      new.id,
      case
        when new.state is distinct from old.state then 'state_changed'
        else 'lock_changed'
      end,
      old.state, new.state, old.lock_state, new.lock_state, new.quantity,
      auth.uid(), nullif(new.metadata->>'reason', ''),
      jsonb_build_object('request_key', new.request_key, 'source', new.source)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_allocations_audit_trg on public.inventory_allocations;
create trigger inventory_allocations_audit_trg
after insert or update of state, lock_state on public.inventory_allocations
for each row execute function public.audit_inventory_allocation_change();

create or replace function public.prevent_inventory_allocation_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'inventory_allocations_are_stateful_use_release';
end;
$$;

drop trigger if exists inventory_allocations_no_delete_trg
  on public.inventory_allocations;
create trigger inventory_allocations_no_delete_trg
before delete on public.inventory_allocations
for each row execute function public.prevent_inventory_allocation_delete();

create or replace function public.prevent_inventory_allocation_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'inventory_allocation_events_are_append_only';
end;
$$;

drop trigger if exists inventory_allocation_events_append_only_trg
  on public.inventory_allocation_events;
create trigger inventory_allocation_events_append_only_trg
before update or delete on public.inventory_allocation_events
for each row execute function public.prevent_inventory_allocation_event_mutation();

-- ---------------------------------------------------------------------------
-- Capacity helpers and canonical availability
-- ---------------------------------------------------------------------------

create or replace function public.inventory_layer_reserved_quantity(p_cost_layer_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce(sum(a.quantity), 0)::int
  from public.inventory_allocations a
  where a.cost_layer_id = p_cost_layer_id
    and a.state = 'reserved';
$$;

create or replace function public.inventory_package_manual_hold_quantity(p_package_id text)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce(sum(hold.quantity), 0)::int
  from public.inventory_holds hold
  where hold.package_id = p_package_id
    and hold.released_at is null
    and (hold.expires_at is null or hold.expires_at > timezone('utc', now()));
$$;

create or replace function public.inventory_package_allocatable_quantity(p_package_id text)
returns int
language plpgsql
stable
set search_path = public
as $$
declare
  v_ledger_package_id text;
  v_quantity int;
begin
  v_ledger_package_id := public.resolve_cost_ledger_package_id(p_package_id);
  select coalesce(sum(
    greatest(
      layer.quantity_remaining
      - public.inventory_layer_reserved_quantity(layer.id),
      0
    )
  ), 0)::int
  into v_quantity
  from public.package_cost_layers layer
  where layer.package_id = v_ledger_package_id;
  return greatest(
    coalesce(v_quantity, 0)
      - public.inventory_package_manual_hold_quantity(p_package_id),
    0
  );
end;
$$;

create or replace function public.assert_inventory_layer_capacity(p_cost_layer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer public.package_cost_layers%rowtype;
  v_reserved int;
  v_committed int;
begin
  select * into v_layer
  from public.package_cost_layers
  where id = p_cost_layer_id;
  if not found then return; end if;

  select
    coalesce(sum(allocation.quantity) filter (where allocation.state = 'reserved'), 0)::int,
    coalesce(sum(allocation.quantity) filter (where allocation.state = 'committed'), 0)::int
  into v_reserved, v_committed
  from public.inventory_allocations allocation
  where allocation.cost_layer_id = p_cost_layer_id;

  if v_layer.quantity_remaining < 0
    or v_layer.quantity_remaining > v_layer.quantity
  then
    raise exception 'invalid_cost_layer_remaining:%:%:%',
      p_cost_layer_id, v_layer.quantity_remaining, v_layer.quantity;
  end if;
  if v_reserved > v_layer.quantity_remaining then
    raise exception 'reserved_inventory_exceeds_layer:%:%:%',
      p_cost_layer_id, v_reserved, v_layer.quantity_remaining;
  end if;
  if v_committed + v_layer.quantity_remaining > v_layer.quantity then
    raise exception 'committed_inventory_exceeds_layer:%:%:%:%',
      p_cost_layer_id, v_committed, v_layer.quantity_remaining, v_layer.quantity;
  end if;
end;
$$;

create or replace function public.check_inventory_allocation_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.inventory_allocation_enforcement_enabled() then return new; end if;
  perform public.assert_inventory_layer_capacity(new.cost_layer_id);
  if tg_op = 'UPDATE' and old.cost_layer_id is distinct from new.cost_layer_id then
    perform public.assert_inventory_layer_capacity(old.cost_layer_id);
  end if;
  return new;
end;
$$;

create or replace function public.check_cost_layer_allocation_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.inventory_allocation_enforcement_enabled() then return new; end if;
  perform public.assert_inventory_layer_capacity(new.id);
  return new;
end;
$$;

drop trigger if exists inventory_allocations_capacity_constraint_trg
  on public.inventory_allocations;
create constraint trigger inventory_allocations_capacity_constraint_trg
after insert or update on public.inventory_allocations
deferrable initially deferred
for each row execute function public.check_inventory_allocation_capacity();

drop trigger if exists package_cost_layers_allocation_capacity_constraint_trg
  on public.package_cost_layers;
create constraint trigger package_cost_layers_allocation_capacity_constraint_trg
after insert or update on public.package_cost_layers
deferrable initially deferred
for each row execute function public.check_cost_layer_allocation_capacity();

create or replace view public.inventory_availability as
select
  package.id as package_id,
  package.race_id,
  package.name,
  package.duration,
  package.inventory_group_id,
  package.inventory_pool_id,
  package.shell_parent_package_id,
  package.shell_parent_package_id is not null as is_legacy_shell,
  ledger.ledger_package_id,
  coalesce(layer_totals.original_quantity, 0) as layer_original_quantity,
  coalesce(layer_totals.quantity_remaining, 0) as layer_quantity_remaining,
  coalesce(allocation_totals.reserved_quantity, 0) as reserved_quantity,
  public.inventory_package_manual_hold_quantity(package.id) as manual_hold_quantity,
  coalesce(allocation_totals.committed_quantity, 0) as committed_quantity,
  greatest(
    coalesce(layer_totals.quantity_remaining, 0)
    - coalesce(allocation_totals.reserved_quantity, 0),
    0
  ) - least(
    greatest(
      coalesce(layer_totals.quantity_remaining, 0)
      - coalesce(allocation_totals.reserved_quantity, 0),
      0
    ),
    public.inventory_package_manual_hold_quantity(package.id)
  ) as available_quantity,
  coalesce(shortage_totals.historical_shortage_quantity, 0)
    as historical_shortage_quantity,
  coalesce(shortage_totals.brokered_shortage_quantity, 0)
    as brokered_shortage_quantity,
  coalesce(inventory.qty_available, 0) as legacy_qty_available,
  coalesce(inventory.qty_held, 0) as legacy_qty_held
from public.packages package
cross join lateral (
  select public.resolve_cost_ledger_package_id(package.id) as ledger_package_id
) ledger
left join lateral (
  select
    coalesce(sum(layer.quantity), 0)::int as original_quantity,
    coalesce(sum(layer.quantity_remaining), 0)::int as quantity_remaining
  from public.package_cost_layers layer
  where layer.package_id = ledger.ledger_package_id
) layer_totals on true
left join lateral (
  select
    coalesce((
      select sum(a.quantity)::int
      from public.inventory_allocations a
      join public.package_cost_layers allocation_layer
        on allocation_layer.id = a.cost_layer_id
      where allocation_layer.package_id = ledger.ledger_package_id
        and a.state = 'reserved'
    ), 0) as reserved_quantity,
    coalesce((
      select sum(a.quantity)::int
      from public.inventory_allocations a
      where a.package_id = package.id
        and a.state = 'committed'
    ), 0) as committed_quantity
) allocation_totals on true
left join lateral (
  select
    coalesce(sum(s.quantity) filter (
      where s.status = 'open'
        and s.shortage_type = 'historical_reconciliation'
    ), 0)::int as historical_shortage_quantity,
    coalesce(sum(s.quantity) filter (
      where s.status = 'open' and s.shortage_type = 'brokered'
    ), 0)::int as brokered_shortage_quantity
  from public.inventory_shortages s
  where s.package_id = package.id
) shortage_totals on true
left join public.package_inventory inventory on inventory.package_id = package.id;

comment on view public.inventory_availability is
  'Canonical availability: linked cost-layer quantity_remaining minus active reserved allocations. Committed allocations are already reflected in layer remaining.';

grant select on public.inventory_availability to authenticated, service_role;

-- Keep the mature linked day/2-day/3-day calculation, but cap every checkout,
-- Wix order and deal reservation by real unallocated purchase-layer capacity.
-- The caller's own manual hold is added back because place_order is allowed to
-- convert that hold into the caller's order.
do $$
begin
  if to_regprocedure('public.linked_inventory_sellable_legacy(text,uuid)') is null then
    alter function public.linked_inventory_sellable(text, uuid)
      rename to linked_inventory_sellable_legacy;
  end if;
end;
$$;

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
  v_legacy int;
  v_canonical int;
  v_own_hold int;
begin
  v_legacy := greatest(
    coalesce(public.linked_inventory_sellable_legacy(p_package_id, p_agent_profile_id), 0),
    0
  );
  if not public.inventory_allocation_enforcement_enabled() then
    return v_legacy;
  end if;
  v_canonical := public.inventory_package_allocatable_quantity(p_package_id);
  select coalesce(sum(hold.quantity), 0)::int
  into v_own_hold
  from public.inventory_holds hold
  where hold.package_id = p_package_id
    and hold.agent_profile_id = p_agent_profile_id
    and hold.released_at is null
    and (hold.expires_at is null or hold.expires_at > timezone('utc', now()));
  return greatest(least(v_legacy, v_canonical + coalesce(v_own_hold, 0)), 0);
end;
$$;

revoke all on function public.linked_inventory_sellable(text, uuid) from public;
grant execute on function public.linked_inventory_sellable(text, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared allocation / release / conversion primitives
-- ---------------------------------------------------------------------------

create or replace function public.inventory_allocate_quantity(
  p_package_id text,
  p_quantity int,
  p_state text,
  p_source text,
  p_request_key text,
  p_deal_id uuid default null,
  p_deal_line_item_id uuid default null,
  p_order_id uuid default null,
  p_order_line_item_id uuid default null,
  p_reservation_id uuid default null,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ledger_package_id text;
  v_remaining int;
  v_available int;
  v_take int;
  v_layer record;
  v_existing int;
  v_now timestamptz := timezone('utc', now());
  v_occ_id uuid;
  v_order_currency text;
  v_preferred_block uuid;
  v_preferred_po uuid;
  v_preferred_supplier uuid;
  v_preferred_source text;
begin
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('operations.manage')
    and not public.has_cms_permission('deals.manage')
  then
    raise exception 'forbidden';
  end if;
  if coalesce(p_quantity, 0) <= 0 then raise exception 'invalid_quantity'; end if;
  if p_state not in ('reserved', 'committed') then raise exception 'invalid_allocation_state'; end if;
  if nullif(btrim(p_source), '') is null then raise exception 'source_required'; end if;
  if nullif(btrim(p_request_key), '') is null then raise exception 'request_key_required'; end if;
  if not exists (select 1 from public.packages where id = p_package_id) then
    raise exception 'package_not_found:%', p_package_id;
  end if;

  select coalesce(sum(quantity), 0)::int
  into v_existing
  from public.inventory_allocations
  where request_key = btrim(p_request_key);
  if v_existing > 0 then
    if v_existing <> p_quantity then raise exception 'idempotency_quantity_mismatch'; end if;
    -- Request keys are permanent. A retry after release reports the original
    -- quantity but never resurrects or duplicates that allocation.
    return v_existing;
  end if;

  v_ledger_package_id := public.resolve_cost_ledger_package_id(p_package_id);

  -- Serialize with legacy/manual hold RPCs, which lock package_inventory.
  perform 1
  from public.package_inventory inventory
  where inventory.package_id in (p_package_id, v_ledger_package_id)
  order by inventory.package_id
  for update;

  -- Lock every candidate in deterministic order before reading availability.
  perform 1
  from public.package_cost_layers layer
  where layer.package_id = v_ledger_package_id
  order by layer.received_at, layer.id
  for update;

  -- A concurrent retry can only reach this point after waiting for the same
  -- cost-layer locks. Recheck the logical request before changing capacity.
  select coalesce(sum(quantity), 0)::int
  into v_existing
  from public.inventory_allocations
  where request_key = btrim(p_request_key);
  if v_existing > 0 then
    if v_existing <> p_quantity then raise exception 'idempotency_quantity_mismatch'; end if;
    return v_existing;
  end if;

  select coalesce(sum(greatest(
    layer.quantity_remaining
      - public.inventory_layer_reserved_quantity(layer.id),
    0
  )), 0)::int
  into v_available
  from public.package_cost_layers layer
  where layer.package_id = v_ledger_package_id;

  if v_available < p_quantity then
    raise exception 'insufficient_purchased_stock:%:%:%',
      p_package_id, p_quantity, v_available;
  end if;

  v_available := greatest(
    v_available - public.inventory_package_manual_hold_quantity(p_package_id),
    0
  );
  if v_available < p_quantity then
    raise exception 'insufficient_purchased_stock:%:%:%',
      p_package_id, p_quantity, v_available;
  end if;

  -- Keep one party together whenever one fulfilment block, PO, structured
  -- supplier, or legacy source can cover it. FIFO remains deterministic inside
  -- the selected source and is the final split fallback.
  select layer.fulfilment_block_id
  into v_preferred_block
  from public.package_cost_layers layer
  where layer.package_id = v_ledger_package_id
    and layer.fulfilment_block_id is not null
  group by layer.fulfilment_block_id
  having sum(greatest(
    layer.quantity_remaining - public.inventory_layer_reserved_quantity(layer.id),
    0
  )) >= p_quantity
  order by sum(greatest(
    layer.quantity_remaining - public.inventory_layer_reserved_quantity(layer.id),
    0
  )), min(layer.received_at), layer.fulfilment_block_id
  limit 1;

  if v_preferred_block is null then
    select layer.purchase_order_id
    into v_preferred_po
    from public.package_cost_layers layer
    where layer.package_id = v_ledger_package_id
      and layer.purchase_order_id is not null
    group by layer.purchase_order_id
    having sum(greatest(
      layer.quantity_remaining - public.inventory_layer_reserved_quantity(layer.id),
      0
    )) >= p_quantity
    order by sum(greatest(
      layer.quantity_remaining - public.inventory_layer_reserved_quantity(layer.id),
      0
    )), min(layer.received_at), layer.purchase_order_id
    limit 1;
  end if;

  if v_preferred_block is null and v_preferred_po is null then
    select coalesce(layer.supplier_id, po.supplier_id)
    into v_preferred_supplier
    from public.package_cost_layers layer
    left join public.purchase_orders po on po.id = layer.purchase_order_id
    where layer.package_id = v_ledger_package_id
      and coalesce(layer.supplier_id, po.supplier_id) is not null
    group by coalesce(layer.supplier_id, po.supplier_id)
    having sum(greatest(
      layer.quantity_remaining - public.inventory_layer_reserved_quantity(layer.id),
      0
    )) >= p_quantity
    order by sum(greatest(
      layer.quantity_remaining - public.inventory_layer_reserved_quantity(layer.id),
      0
    )), min(layer.received_at), coalesce(layer.supplier_id, po.supplier_id)
    limit 1;
  end if;

  if v_preferred_block is null and v_preferred_po is null
     and v_preferred_supplier is null then
    select lower(btrim(layer.source))
    into v_preferred_source
    from public.package_cost_layers layer
    where layer.package_id = v_ledger_package_id
      and nullif(btrim(layer.source), '') is not null
    group by lower(btrim(layer.source))
    having sum(greatest(
      layer.quantity_remaining - public.inventory_layer_reserved_quantity(layer.id),
      0
    )) >= p_quantity
    order by sum(greatest(
      layer.quantity_remaining - public.inventory_layer_reserved_quantity(layer.id),
      0
    )), min(layer.received_at), lower(btrim(layer.source))
    limit 1;
  end if;

  v_remaining := p_quantity;
  for v_layer in
    select
      layer.*,
      greatest(
        layer.quantity_remaining
          - public.inventory_layer_reserved_quantity(layer.id),
        0
      )::int as allocatable
    from public.package_cost_layers layer
    left join public.purchase_orders po on po.id = layer.purchase_order_id
    where layer.package_id = v_ledger_package_id
    order by
      case
        when v_preferred_block is not null
          then case when layer.fulfilment_block_id = v_preferred_block then 0 else 1 end
        when v_preferred_po is not null
          then case when layer.purchase_order_id = v_preferred_po then 0 else 1 end
        when v_preferred_supplier is not null
          then case when coalesce(layer.supplier_id, po.supplier_id) = v_preferred_supplier then 0 else 1 end
        when v_preferred_source is not null
          then case when lower(btrim(layer.source)) = v_preferred_source then 0 else 1 end
        else 0
      end,
      layer.received_at,
      layer.id
  loop
    exit when v_remaining = 0;
    v_take := least(v_layer.allocatable, v_remaining);
    if v_take <= 0 then continue; end if;

    v_occ_id := null;
    if p_state = 'committed' and p_order_id is not null then
      select coalesce(nullif(btrim(o.currency), ''), v_layer.currency, 'USD')
      into v_order_currency
      from public.orders o where o.id = p_order_id;

      -- Suppress the compatibility trigger because this canonical write creates
      -- the allocation itself immediately below.
      perform set_config('inventory.canonical_write', 'on', true);
      insert into public.order_cost_consumptions (
        order_id, cost_layer_id, package_id, quantity, unit_cost, currency,
        supplier_source_snapshot, fulfilment_block_snapshot
      )
      select
        p_order_id, v_layer.id, p_package_id, v_take, v_layer.unit_cost,
        coalesce(v_order_currency, v_layer.currency, 'USD'),
        v_layer.source, block.name
      from public.package_cost_layers layer
      left join public.fulfilment_blocks block on block.id = layer.fulfilment_block_id
      where layer.id = v_layer.id
      returning id into v_occ_id;
      perform set_config('inventory.canonical_write', 'off', true);
    end if;

    insert into public.inventory_allocations (
      cost_layer_id, package_id, deal_id, deal_line_item_id,
      order_id, order_line_item_id, reservation_id,
      order_cost_consumption_id, quantity, state, source,
      request_key, idempotency_key, reserved_at, committed_at,
      created_by, metadata
    ) values (
      v_layer.id, p_package_id, p_deal_id, p_deal_line_item_id,
      p_order_id, p_order_line_item_id, p_reservation_id,
      v_occ_id, v_take, p_state, btrim(p_source),
      btrim(p_request_key), btrim(p_request_key) || ':layer:' || v_layer.id::text,
      case when p_state = 'reserved' then v_now else null end,
      case when p_state = 'committed' then v_now else null end,
      auth.uid(),
      coalesce(p_metadata, '{}'::jsonb)
        || jsonb_build_object('reason', nullif(btrim(p_reason), ''))
    )
    on conflict (idempotency_key) do nothing;

    if p_state = 'committed' then
      update public.package_cost_layers
      set quantity_remaining = quantity_remaining - v_take
      where id = v_layer.id
        and quantity_remaining >= v_take;
      if not found then raise exception 'concurrent_inventory_change'; end if;
    end if;
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining <> 0 then raise exception 'allocation_incomplete'; end if;
  return p_quantity;
end;
$$;

create or replace function public.inventory_release_allocations(
  p_request_key text,
  p_reason text,
  p_allow_committed boolean default false
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allocation record;
  v_released int := 0;
begin
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('operations.manage')
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;
  if nullif(btrim(p_request_key), '') is null then raise exception 'request_key_required'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;

  for v_allocation in
    select *
    from public.inventory_allocations
    where request_key = btrim(p_request_key)
      and state <> 'released'
    order by cost_layer_id, id
    for update
  loop
    if v_allocation.lock_state = 'fulfilment_locked' then
      raise exception 'allocation_fulfilment_locked:%', v_allocation.id;
    end if;
    if v_allocation.state = 'committed' and not coalesce(p_allow_committed, false) then
      raise exception 'committed_release_requires_explicit_override';
    end if;

    perform 1 from public.package_cost_layers
    where id = v_allocation.cost_layer_id for update;

    if v_allocation.state = 'committed' then
      update public.package_cost_layers
      set quantity_remaining = quantity_remaining + v_allocation.quantity
      where id = v_allocation.cost_layer_id
        and quantity_remaining + v_allocation.quantity <= quantity;
      if not found then raise exception 'cost_layer_release_exceeds_original_quantity'; end if;

      if v_allocation.order_cost_consumption_id is not null then
        perform set_config('inventory.canonical_write', 'on', true);
        delete from public.order_cost_consumptions
        where id = v_allocation.order_cost_consumption_id;
        perform set_config('inventory.canonical_write', 'off', true);
      end if;
    end if;

    update public.inventory_allocations
    set state = 'released',
        released_at = timezone('utc', now()),
        updated_at = timezone('utc', now()),
        metadata = metadata || jsonb_build_object('reason', btrim(p_reason))
    where id = v_allocation.id;
    v_released := v_released + v_allocation.quantity;
  end loop;
  return v_released;
end;
$$;

create or replace function public.inventory_convert_reservation_allocations(
  p_reservation_id uuid,
  p_order_line_item_id uuid,
  p_request_key text,
  p_reason text default 'Reserved inventory committed to order'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allocation record;
  v_order_id uuid;
  v_package_id text;
  v_occ_id uuid;
  v_converted int := 0;
begin
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('operations.manage')
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;
  if nullif(btrim(p_request_key), '') is null then raise exception 'request_key_required'; end if;

  select line.order_id, line.package_id
  into v_order_id, v_package_id
  from public.order_line_items line
  where line.id = p_order_line_item_id;
  if not found then raise exception 'order_line_not_found'; end if;

  for v_allocation in
    select *
    from public.inventory_allocations
    where reservation_id = p_reservation_id and state = 'reserved'
    order by cost_layer_id, id
    for update
  loop
    if v_allocation.lock_state = 'fulfilment_locked' then
      raise exception 'allocation_fulfilment_locked:%', v_allocation.id;
    end if;
    perform 1 from public.package_cost_layers
    where id = v_allocation.cost_layer_id for update;

    update public.package_cost_layers
    set quantity_remaining = quantity_remaining - v_allocation.quantity
    where id = v_allocation.cost_layer_id
      and quantity_remaining >= v_allocation.quantity;
    if not found then raise exception 'concurrent_inventory_change'; end if;

    perform set_config('inventory.canonical_write', 'on', true);
    insert into public.order_cost_consumptions (
      order_id, cost_layer_id, package_id, quantity, unit_cost, currency,
      supplier_source_snapshot, fulfilment_block_snapshot
    )
    select
      v_order_id, layer.id, v_package_id, v_allocation.quantity,
      layer.unit_cost, layer.currency, layer.source, block.name
    from public.package_cost_layers layer
    left join public.fulfilment_blocks block on block.id = layer.fulfilment_block_id
    where layer.id = v_allocation.cost_layer_id
    returning id into v_occ_id;
    perform set_config('inventory.canonical_write', 'off', true);

    update public.inventory_allocations
    set state = 'committed',
        order_id = v_order_id,
        order_line_item_id = p_order_line_item_id,
        order_cost_consumption_id = v_occ_id,
        request_key = btrim(p_request_key),
        committed_at = timezone('utc', now()),
        updated_at = timezone('utc', now()),
        metadata = metadata || jsonb_build_object('reason', btrim(p_reason))
    where id = v_allocation.id;
    v_converted := v_converted + v_allocation.quantity;
  end loop;

  if v_converted = 0 then
    select coalesce(sum(quantity), 0)::int into v_converted
    from public.inventory_allocations
    where reservation_id = p_reservation_id
      and order_line_item_id = p_order_line_item_id
      and state = 'committed';
  end if;
  return v_converted;
end;
$$;

-- ---------------------------------------------------------------------------
-- Compatibility projection from legacy/native paths
-- ---------------------------------------------------------------------------

create or replace function public.project_order_cost_consumption_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_line_id uuid;
  v_deal_id uuid;
  v_deal_line_id uuid;
  v_locked boolean;
  v_available int;
  v_projected_quantity int;
begin
  if not public.inventory_allocation_enforcement_enabled() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if current_setting('inventory.canonical_write', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op in ('DELETE', 'UPDATE') then
    select coalesce(sum(a.quantity), 0)::int
    into v_projected_quantity
    from public.inventory_allocations a
    where (
        a.order_cost_consumption_id = old.id
        or a.idempotency_key = 'occ:' || old.id::text
      )
      and a.state <> 'released';

    select exists (
      select 1 from public.inventory_allocations a
      where (
          a.order_cost_consumption_id = old.id
          or a.idempotency_key = 'occ:' || old.id::text
        )
        and a.state <> 'released'
        and a.lock_state = 'fulfilment_locked'
    ) into v_locked;
    if v_locked then raise exception 'allocation_fulfilment_locked'; end if;

    update public.inventory_allocations
    set state = 'released',
        released_at = timezone('utc', now()),
        updated_at = timezone('utc', now()),
        metadata = metadata || jsonb_build_object(
          'reason', 'order_cost_consumptions compatibility row removed'
        )
    where (
        order_cost_consumption_id = old.id
        or idempotency_key = 'occ:' || old.id::text
      )
      and state <> 'released';

    -- Legacy cancellation/reassignment routines restore the full COGS row
    -- before deleting it. If historical COGS overflowed real purchased stock,
    -- remove that invented portion again so only covered owned stock returns.
    if old.cost_layer_id is not null
      and old.quantity > coalesce(v_projected_quantity, 0)
    then
      update public.package_cost_layers
      set quantity_remaining = greatest(
        quantity_remaining - (old.quantity - coalesce(v_projected_quantity, 0)),
        0
      )
      where id = old.cost_layer_id;
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.cost_layer_id is null then
      raise exception 'insufficient_purchased_stock:%:%',
        new.package_id, new.quantity;
    end if;

    perform 1
    from public.package_cost_layers layer
    where layer.id = new.cost_layer_id
    for update;
    select greatest(
      layer.quantity_remaining
        - public.inventory_layer_reserved_quantity(layer.id),
      0
    )::int
    into v_available
    from public.package_cost_layers layer
    where layer.id = new.cost_layer_id;
    if not found then raise exception 'cost_layer_not_found'; end if;
    if new.quantity > v_available then
      raise exception 'insufficient_canonical_inventory_for_cogs:%:%',
        new.quantity, v_available;
    end if;

    select line.id, line.deal_line_item_id
    into v_order_line_id, v_deal_line_id
    from public.order_line_items line
    where line.order_id = new.order_id and line.package_id = new.package_id
    order by
      case when line.quantity = new.quantity then 0 else 1 end,
      line.sort_order, line.id
    limit 1;
    select deal.id into v_deal_id
    from public.deals deal where deal.order_id = new.order_id limit 1;

    insert into public.inventory_allocations (
      cost_layer_id, package_id, deal_id, deal_line_item_id,
      order_id, order_line_item_id, order_cost_consumption_id,
      quantity, state, source, request_key, idempotency_key,
      committed_at, created_by, metadata
    ) values (
      new.cost_layer_id, new.package_id, v_deal_id, v_deal_line_id,
      new.order_id, v_order_line_id, new.id,
      new.quantity, 'committed', 'order_cost_consumptions',
      'occ:' || new.id::text, 'occ:' || new.id::text,
      coalesce(new.created_at, timezone('utc', now())), auth.uid(),
      jsonb_build_object('compatibility_projection', true)
    )
    on conflict (idempotency_key) do update
    set quantity = excluded.quantity,
        cost_layer_id = excluded.cost_layer_id,
        package_id = excluded.package_id,
        order_line_item_id = coalesce(excluded.order_line_item_id, public.inventory_allocations.order_line_item_id),
        deal_line_item_id = coalesce(excluded.deal_line_item_id, public.inventory_allocations.deal_line_item_id),
        state = 'committed',
        committed_at = coalesce(public.inventory_allocations.committed_at, excluded.committed_at),
        released_at = null,
        updated_at = timezone('utc', now());
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists order_cost_consumptions_inventory_projection_trg
  on public.order_cost_consumptions;
create trigger order_cost_consumptions_inventory_projection_trg
after insert or delete on public.order_cost_consumptions
for each row execute function public.project_order_cost_consumption_allocation();

create or replace function public.sync_inventory_reservation_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line_id uuid;
  v_request_key text;
begin
  if not public.inventory_allocation_enforcement_enabled() then return new; end if;
  v_request_key := 'reservation:' || new.id::text;

  if tg_op = 'INSERT' and new.status = 'active' then
    select line.id into v_line_id
    from public.deal_line_items line
    where line.reservation_id = new.id
    limit 1;

    if new.kind = 'deal_reservation' then
      perform public.inventory_allocate_quantity(
        new.package_id, new.quantity, 'reserved', 'inventory_reservations',
        v_request_key, new.deal_id, v_line_id, null, null, new.id,
        'Projected active deal reservation',
        jsonb_build_object('compatibility_projection', true)
      );
    elsif new.kind = 'sourcing' then
      insert into public.inventory_shortages (
        package_id, deal_id, deal_line_item_id, shortage_type, quantity,
        status, source, idempotency_key, note, created_by, metadata
      ) values (
        new.package_id, new.deal_id, v_line_id, 'brokered', new.quantity,
        'open', 'inventory_reservations', 'brokered-reservation:' || new.id::text,
        'Brokered reservation intentionally does not consume owned inventory',
        auth.uid(), jsonb_build_object('reservation_id', new.id)
      ) on conflict (idempotency_key) do nothing;
    end if;
  elsif tg_op = 'UPDATE'
    and old.status = 'active'
    and new.status in ('released', 'converted', 'expired', 'cancelled')
  then
    if old.kind = 'deal_reservation' then
      perform public.inventory_release_allocations(
        v_request_key,
        'Reservation moved to ' || new.status,
        false
      );
      update public.inventory_shortages
      set status = 'cancelled',
          resolved_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
      where idempotency_key = 'reservation-shortage:' || new.id::text
        and status = 'open';
    else
      update public.inventory_shortages
      set status = case when new.status = 'converted' then 'open' else 'cancelled' end,
          resolved_at = case when new.status = 'converted' then null else timezone('utc', now()) end,
          updated_at = timezone('utc', now())
      where idempotency_key = 'brokered-reservation:' || new.id::text;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_reservations_allocation_projection_trg
  on public.inventory_reservations;
create trigger inventory_reservations_allocation_projection_trg
after insert or update of status on public.inventory_reservations
for each row execute function public.sync_inventory_reservation_allocation();

create or replace function public.attach_inventory_allocation_line_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reservation_id is not null then
    update public.inventory_allocations
    set deal_id = new.deal_id,
        deal_line_item_id = new.id,
        updated_at = timezone('utc', now())
    where reservation_id = new.reservation_id
      and deal_line_item_id is null;

    update public.inventory_shortages
    set deal_id = new.deal_id,
        deal_line_item_id = new.id,
        sourcing_shortage_id = new.sourcing_shortage_id,
        updated_at = timezone('utc', now())
    where idempotency_key = 'brokered-reservation:' || new.reservation_id::text;
  end if;
  return new;
end;
$$;

drop trigger if exists deal_line_items_inventory_link_projection_trg
  on public.deal_line_items;
create trigger deal_line_items_inventory_link_projection_trg
after insert or update of reservation_id, sourcing_shortage_id
on public.deal_line_items
for each row execute function public.attach_inventory_allocation_line_links();

-- ---------------------------------------------------------------------------
-- Operations fulfilment lock synchronization
-- ---------------------------------------------------------------------------

create or replace function public.sync_order_allocation_fulfilment_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked boolean;
begin
  v_locked :=
    new.fulfilment_status in ('in_progress', 'ready', 'delivered', 'issue')
    or new.supplier_status in ('confirmed', 'tickets_received')
    or new.delivery_status = 'delivered'
    or exists (
      select 1
      from public.order_supplier_fulfilments fulfilment
      where fulfilment.order_id = new.order_id
        and fulfilment.status in ('confirmed', 'tickets_received')
    );
  update public.inventory_allocations allocation
  set lock_state = case when v_locked then 'fulfilment_locked' else 'mutable' end,
      locked_at = case when v_locked
        then coalesce(allocation.locked_at, timezone('utc', now()))
        else null end,
      locked_reason = case when v_locked
        then case
          when new.supplier_status in ('confirmed', 'tickets_received')
            then 'order_operations:supplier_' || new.supplier_status
          when new.delivery_status = 'delivered' then 'order_operations:delivered'
          else 'order_operations:' || new.fulfilment_status
        end
        else null end,
      updated_at = timezone('utc', now()),
      metadata = allocation.metadata || jsonb_build_object(
        'reason', 'Order fulfilment status synchronized to ' || new.fulfilment_status
      )
  where allocation.order_id = new.order_id
    and allocation.state <> 'released'
    and allocation.lock_state is distinct from
      case when v_locked then 'fulfilment_locked' else 'mutable' end;
  return new;
end;
$$;

drop trigger if exists order_operations_allocation_lock_trg on public.order_operations;
create trigger order_operations_allocation_lock_trg
after insert or update of fulfilment_status, supplier_status, delivery_status on public.order_operations
for each row execute function public.sync_order_allocation_fulfilment_lock();

create or replace function public.sync_deal_allocation_fulfilment_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked boolean;
begin
  v_locked :=
    new.fulfilment_status in ('in_progress', 'ready', 'delivered', 'issue')
    or new.supplier_status in ('confirmed', 'tickets_received')
    or new.delivery_status = 'delivered';
  update public.inventory_allocations allocation
  set lock_state = case when v_locked then 'fulfilment_locked' else 'mutable' end,
      locked_at = case when v_locked
        then coalesce(allocation.locked_at, timezone('utc', now()))
        else null end,
      locked_reason = case when v_locked
        then case
          when new.supplier_status in ('confirmed', 'tickets_received')
            then 'deal_operations:supplier_' || new.supplier_status
          when new.delivery_status = 'delivered' then 'deal_operations:delivered'
          else 'deal_operations:' || new.fulfilment_status
        end
        else null end,
      updated_at = timezone('utc', now()),
      metadata = allocation.metadata || jsonb_build_object(
        'reason', 'Deal fulfilment status synchronized to ' || new.fulfilment_status
      )
  where allocation.deal_id = new.deal_id
    and allocation.state <> 'released'
    and allocation.lock_state is distinct from
      case when v_locked then 'fulfilment_locked' else 'mutable' end;
  return new;
end;
$$;

drop trigger if exists deal_operations_allocation_lock_trg on public.deal_operations;
create trigger deal_operations_allocation_lock_trg
after insert or update of fulfilment_status, supplier_status, delivery_status on public.deal_operations
for each row execute function public.sync_deal_allocation_fulfilment_lock();

create or replace function public.sync_supplier_fulfilment_allocation_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  v_locked boolean;
begin
  select
    coalesce(operation.fulfilment_status in ('in_progress', 'ready', 'delivered', 'issue'), false)
    or coalesce(operation.supplier_status in ('confirmed', 'tickets_received'), false)
    or coalesce(operation.delivery_status = 'delivered', false)
    or exists (
      select 1 from public.order_supplier_fulfilments fulfilment
      where fulfilment.order_id = v_order_id
        and fulfilment.status in ('confirmed', 'tickets_received')
    )
  into v_locked
  from (select 1) seed
  left join public.order_operations operation on operation.order_id = v_order_id;

  update public.inventory_allocations allocation
  set lock_state = case when coalesce(v_locked, false) then 'fulfilment_locked' else 'mutable' end,
      locked_at = case when coalesce(v_locked, false)
        then coalesce(allocation.locked_at, timezone('utc', now()))
        else null end,
      locked_reason = case when coalesce(v_locked, false)
        then 'supplier_fulfilment_confirmed'
        else null end,
      updated_at = timezone('utc', now()),
      metadata = allocation.metadata || jsonb_build_object(
        'reason', 'Supplier fulfilment lock synchronized'
      )
  where allocation.order_id = v_order_id
    and allocation.state <> 'released'
    and allocation.lock_state is distinct from
      case when coalesce(v_locked, false) then 'fulfilment_locked' else 'mutable' end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists supplier_fulfilment_allocation_lock_trg
  on public.order_supplier_fulfilments;
create trigger supplier_fulfilment_allocation_lock_trg
after insert or update of status or delete on public.order_supplier_fulfilments
for each row execute function public.sync_supplier_fulfilment_allocation_lock();

-- Block legacy operations reassignment from deleting/changing a locked COGS
-- row. This makes the existing reassign RPC honour the canonical fulfilment lock
-- without replacing that RPC.
create or replace function public.guard_locked_order_cost_consumption()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.inventory_allocation_enforcement_enabled() then
    return old;
  end if;
  if current_setting('inventory.canonical_write', true) = 'on' then
    return old;
  end if;
  if tg_op = 'UPDATE'
    and new.order_id is not distinct from old.order_id
    and new.cost_layer_id is not distinct from old.cost_layer_id
    and new.package_id is not distinct from old.package_id
    and new.quantity is not distinct from old.quantity
  then
    return old;
  end if;
  if exists (
    select 1 from public.inventory_allocations allocation
    where (
        allocation.order_cost_consumption_id = old.id
        or allocation.idempotency_key = 'occ:' || old.id::text
      )
      and allocation.state <> 'released'
      and allocation.lock_state = 'fulfilment_locked'
  ) then
    raise exception 'allocation_fulfilment_locked';
  end if;
  return old;
end;
$$;

drop trigger if exists order_cost_consumptions_lock_guard_trg
  on public.order_cost_consumptions;
create trigger order_cost_consumptions_lock_guard_trg
before update or delete on public.order_cost_consumptions
for each row execute function public.guard_locked_order_cost_consumption();

-- ---------------------------------------------------------------------------
-- Historical imported-won reconciliation: explicit dry-run/apply
-- ---------------------------------------------------------------------------

create or replace function public.inventory_reconcile_historical_won(
  p_deal_id uuid,
  p_apply boolean default false,
  p_idempotency_key text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.deals%rowtype;
  v_line record;
  v_available int;
  v_allocate int;
  v_shortage int;
  v_allocated_total int := 0;
  v_shortage_total int := 0;
  v_result jsonb := '[]'::jsonb;
  v_request_base text;
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if coalesce(p_apply, false) and nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'idempotency_key_required_for_apply';
  end if;

  select * into v_deal
  from public.deals
  where id = p_deal_id
  for update;
  if not found then raise exception 'deal_not_found'; end if;
  if v_deal.salesforce_opportunity_id is null then
    raise exception 'imported_salesforce_deal_required';
  end if;
  if v_deal.stage not in ('paid_confirmed', 'in_fulfilment', 'fulfilled') then
    raise exception 'historical_won_deal_required';
  end if;
  if v_deal.stock_reconciliation_status = 'reconciled' and coalesce(p_apply, false) then
    return jsonb_build_object(
      'deal_id', p_deal_id, 'apply', true, 'already_reconciled', true,
      'lines', '[]'::jsonb
    );
  end if;

  for v_line in
    select line.*
    from public.deal_line_items line
    where line.deal_id = p_deal_id
    order by line.sort_order, line.id
  loop
    v_request_base := coalesce(nullif(btrim(p_idempotency_key), ''), 'dry-run')
      || ':deal-line:' || v_line.id::text;

    if coalesce(v_line.sourcing_mode, 'owned') = 'brokered' then
      v_allocate := 0;
      v_shortage := v_line.quantity;
      if coalesce(p_apply, false) then
        insert into public.inventory_shortages (
          package_id, deal_id, deal_line_item_id, sourcing_shortage_id,
          shortage_type, quantity, status, source, idempotency_key,
          note, created_by, metadata
        ) values (
          v_line.package_id, p_deal_id, v_line.id, v_line.sourcing_shortage_id,
          'brokered', v_line.quantity, 'open', 'historical_won_reconciliation',
          v_request_base || ':brokered',
          coalesce(nullif(btrim(p_note), ''), 'Historical won brokered line'),
          auth.uid(), jsonb_build_object('salesforce_line_item_id', v_line.salesforce_line_item_id)
        ) on conflict (idempotency_key) do nothing;
      end if;
    else
      v_available := public.inventory_package_allocatable_quantity(v_line.package_id);
      v_allocate := least(v_line.quantity, v_available);
      v_shortage := v_line.quantity - v_allocate;

      if coalesce(p_apply, false) and v_allocate > 0 then
        perform public.inventory_allocate_quantity(
          v_line.package_id, v_allocate, 'committed',
          'historical_won_reconciliation', v_request_base || ':owned',
          p_deal_id, v_line.id, null, null, null,
          coalesce(nullif(btrim(p_note), ''), 'Applied historical won reconciliation'),
          jsonb_build_object(
            'salesforce_opportunity_id', v_deal.salesforce_opportunity_id,
            'salesforce_line_item_id', v_line.salesforce_line_item_id
          )
        );
      end if;
      if coalesce(p_apply, false) and v_shortage > 0 then
        insert into public.inventory_shortages (
          package_id, deal_id, deal_line_item_id, shortage_type, quantity,
          status, source, idempotency_key, note, created_by, metadata
        ) values (
          v_line.package_id, p_deal_id, v_line.id,
          'historical_reconciliation', v_shortage, 'open',
          'historical_won_reconciliation',
          v_request_base || ':shortage',
          coalesce(nullif(btrim(p_note), ''), 'Historical won quantity exceeds owned inventory'),
          auth.uid(), jsonb_build_object(
            'salesforce_opportunity_id', v_deal.salesforce_opportunity_id,
            'salesforce_line_item_id', v_line.salesforce_line_item_id
          )
        ) on conflict (idempotency_key) do nothing;
      end if;
    end if;

    v_allocated_total := v_allocated_total + v_allocate;
    v_shortage_total := v_shortage_total + v_shortage;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'deal_line_item_id', v_line.id,
      'package_id', v_line.package_id,
      'sourcing_mode', coalesce(v_line.sourcing_mode, 'owned'),
      'requested_quantity', v_line.quantity,
      'allocatable_quantity', v_allocate,
      'shortage_quantity', v_shortage
    ));
  end loop;

  if coalesce(p_apply, false) then
    update public.deals
    set stock_reconciliation_status = 'reconciled',
        updated_at = timezone('utc', now())
    where id = p_deal_id;

    insert into public.deal_activities (
      deal_id, actor_profile_id, action, summary, metadata
    ) values (
      p_deal_id, auth.uid(), 'inventory_reconciled',
      'Applied canonical historical won inventory reconciliation',
      jsonb_build_object(
        'idempotency_key', btrim(p_idempotency_key),
        'allocated_quantity', v_allocated_total,
        'shortage_quantity', v_shortage_total,
        'note', nullif(btrim(p_note), '')
      )
    );
  end if;

  return jsonb_build_object(
    'deal_id', p_deal_id,
    'apply', coalesce(p_apply, false),
    'allocated_quantity', v_allocated_total,
    'shortage_quantity', v_shortage_total,
    'lines', v_result
  );
end;
$$;

comment on function public.inventory_reconcile_historical_won(uuid, boolean, text, text) is
  'Dry-run by default. Apply requires an idempotency key, commits only available owned units under cost-layer locks, records the remainder as historical/brokered shortages, and marks the imported won deal reconciled.';

create or replace function public.inventory_reconcile_historical_inventory(
  p_apply boolean default false,
  p_idempotency_key text default null,
  p_limit int default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal record;
  v_result jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_allocated int := 0;
  v_shortage int := 0;
  v_count int := 0;
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if coalesce(p_apply, false) and nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'idempotency_key_required_for_apply';
  end if;

  for v_deal in
    select deal.id
    from public.deals deal
    where deal.salesforce_opportunity_id is not null
      and deal.order_id is null
      and deal.stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
      and (
        not coalesce(p_apply, false)
        or coalesce(deal.stock_reconciliation_status, 'pending') <> 'reconciled'
      )
    order by deal.closed_at nulls last, deal.created_at, deal.id
    limit greatest(1, least(coalesce(p_limit, 500), 2000))
  loop
    v_result := public.inventory_reconcile_historical_won(
      v_deal.id,
      coalesce(p_apply, false),
      case
        when coalesce(p_apply, false)
          then btrim(p_idempotency_key) || ':deal:' || v_deal.id::text
        else null
      end,
      'Historical inventory batch reconciliation'
    );
    v_rows := v_rows || jsonb_build_array(v_result);
    v_allocated := v_allocated + coalesce((v_result->>'allocated_quantity')::int, 0);
    v_shortage := v_shortage + coalesce((v_result->>'shortage_quantity')::int, 0);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'apply', coalesce(p_apply, false),
    'deal_count', v_count,
    'allocated_quantity', v_allocated,
    'shortage_quantity', v_shortage,
    'deals', v_rows
  );
end;
$$;

create or replace function public.inventory_cover_historical_shortages(
  p_package_id text,
  p_source_key text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shortage record;
  v_available int;
  v_take int;
  v_covered int := 0;
begin
  if nullif(btrim(p_package_id), '') is null then raise exception 'package_required'; end if;
  if nullif(btrim(p_source_key), '') is null then raise exception 'source_key_required'; end if;

  for v_shortage in
    select shortage.*
    from public.inventory_shortages shortage
    where shortage.package_id = p_package_id
      and shortage.shortage_type = 'historical_reconciliation'
      and shortage.status = 'open'
    order by shortage.created_at, shortage.id
    for update
  loop
    v_available := public.inventory_package_allocatable_quantity(p_package_id);
    exit when v_available <= 0;
    v_take := least(v_shortage.quantity, v_available);

    perform public.inventory_allocate_quantity(
      p_package_id,
      v_take,
      'committed',
      'historical_shortage_cover',
      'shortage:' || v_shortage.id::text || ':cover:' || btrim(p_source_key),
      v_shortage.deal_id,
      v_shortage.deal_line_item_id,
      v_shortage.order_id,
      v_shortage.order_line_item_id,
      null,
      'New purchase stock covered historical shortage',
      jsonb_build_object('shortage_id', v_shortage.id, 'source_key', btrim(p_source_key))
    );

    update public.inventory_shortages
    set quantity = quantity - v_take,
        status = case when quantity = v_take then 'resolved' else 'open' end,
        resolved_at = case when quantity = v_take then timezone('utc', now()) else null end,
        updated_at = timezone('utc', now()),
        metadata = metadata || jsonb_build_object(
          'last_cover_source_key', btrim(p_source_key),
          'last_covered_quantity', v_take
        )
    where id = v_shortage.id;
    v_covered := v_covered + v_take;
  end loop;
  return v_covered;
end;
$$;

create or replace function public.cover_historical_shortages_after_purchase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.inventory_cover_historical_shortages(
    new.package_id,
    'cost-layer:' || new.id::text || ':quantity:' || new.quantity::text
  );
  return new;
end;
$$;

drop trigger if exists package_cost_layers_cover_shortages_trg
  on public.package_cost_layers;
create trigger package_cost_layers_cover_shortages_trg
after insert on public.package_cost_layers
for each row execute function public.cover_historical_shortages_after_purchase();

-- ---------------------------------------------------------------------------
-- Safe backfill: project existing COGS and active reservations.
-- No historical package/cost row is modified by this backfill.
-- ---------------------------------------------------------------------------

with ranked_consumptions as (
  select
    consumption.*,
    greatest(layer.quantity - layer.quantity_remaining, 0)::int as consumed_capacity,
    coalesce(sum(consumption.quantity) over (
      partition by consumption.cost_layer_id
      order by consumption.created_at, consumption.id
      rows between unbounded preceding and 1 preceding
    ), 0)::int as prior_quantity
  from public.order_cost_consumptions consumption
  join public.package_cost_layers layer on layer.id = consumption.cost_layer_id
  where consumption.cost_layer_id is not null
),
covered_consumptions as (
  select
    consumption.*,
    least(
      consumption.quantity,
      greatest(consumption.consumed_capacity - consumption.prior_quantity, 0)
    )::int as covered_quantity
  from ranked_consumptions consumption
)
insert into public.inventory_allocations (
  cost_layer_id, package_id, deal_id, deal_line_item_id,
  order_id, order_line_item_id, order_cost_consumption_id,
  quantity, state, source, request_key, idempotency_key,
  committed_at, metadata
)
select
  consumption.cost_layer_id,
  consumption.package_id,
  deal.id,
  order_line.deal_line_item_id,
  consumption.order_id,
  order_line.id,
  consumption.id,
  consumption.covered_quantity,
  'committed',
  'order_cost_consumptions_backfill',
  'occ:' || consumption.id::text,
  'occ:' || consumption.id::text,
  consumption.created_at,
  jsonb_build_object('backfill', true)
from covered_consumptions consumption
left join public.deals deal on deal.order_id = consumption.order_id
left join lateral (
  select line.id, line.deal_line_item_id
  from public.order_line_items line
  where line.order_id = consumption.order_id
    and line.package_id = consumption.package_id
  order by
    case when line.quantity = consumption.quantity then 0 else 1 end,
    line.sort_order, line.id
  limit 1
) order_line on true
where consumption.covered_quantity > 0
on conflict (idempotency_key) do nothing;

insert into public.inventory_shortages (
  package_id, order_id, order_line_item_id, shortage_type, quantity,
  status, source, idempotency_key, note, metadata
)
select
  consumption.package_id,
  consumption.order_id,
  order_line.id,
  'historical_reconciliation',
  consumption.quantity,
  'open',
  'order_cost_consumptions_backfill',
  'occ-uncosted:' || consumption.id::text,
  'Historical order COGS row has no cost layer',
  jsonb_build_object('order_cost_consumption_id', consumption.id, 'backfill', true)
from public.order_cost_consumptions consumption
left join lateral (
  select line.id
  from public.order_line_items line
  where line.order_id = consumption.order_id
    and line.package_id = consumption.package_id
  order by line.sort_order, line.id
  limit 1
) order_line on true
where consumption.cost_layer_id is null
on conflict (idempotency_key) do nothing;

with ranked_consumptions as (
  select
    consumption.*,
    greatest(layer.quantity - layer.quantity_remaining, 0)::int as consumed_capacity,
    coalesce(sum(consumption.quantity) over (
      partition by consumption.cost_layer_id
      order by consumption.created_at, consumption.id
      rows between unbounded preceding and 1 preceding
    ), 0)::int as prior_quantity
  from public.order_cost_consumptions consumption
  join public.package_cost_layers layer on layer.id = consumption.cost_layer_id
),
overflow_consumptions as (
  select
    consumption.*,
    consumption.quantity - least(
      consumption.quantity,
      greatest(consumption.consumed_capacity - consumption.prior_quantity, 0)
    )::int as overflow_quantity
  from ranked_consumptions consumption
)
insert into public.inventory_shortages (
  package_id, order_id, order_line_item_id, shortage_type, quantity,
  status, source, idempotency_key, note, metadata
)
select
  consumption.package_id,
  consumption.order_id,
  order_line.id,
  'historical_reconciliation',
  consumption.overflow_quantity,
  'open',
  'order_cost_consumptions_backfill',
  'occ-overflow:' || consumption.id::text,
  'Historical order allocation exceeded its recorded purchase layer',
  jsonb_build_object(
    'order_cost_consumption_id', consumption.id,
    'cost_layer_id', consumption.cost_layer_id,
    'backfill', true
  )
from overflow_consumptions consumption
left join lateral (
  select line.id
  from public.order_line_items line
  where line.order_id = consumption.order_id
    and line.package_id = consumption.package_id
  order by line.sort_order, line.id
  limit 1
) order_line on true
where consumption.overflow_quantity > 0
on conflict (idempotency_key) do nothing;

-- Existing reservations are allocated one-by-one in deterministic order.
-- If legacy held quantity exceeds cost-layer availability, the migration records
-- a reconciliation shortage instead of failing deployment or over-allocating.
do $$
declare
  v_reservation record;
  v_line_id uuid;
  v_available int;
  v_allocate int;
begin
  for v_reservation in
    select reservation.*
    from public.inventory_reservations reservation
    where reservation.status = 'active'
    order by reservation.created_at, reservation.id
  loop
    select line.id into v_line_id
    from public.deal_line_items line
    where line.reservation_id = v_reservation.id
    limit 1;

    -- A rerun must preserve the first reconciliation decision, including a
    -- deliberately partial allocation plus shortage.
    if exists (
      select 1 from public.inventory_allocations allocation
      where allocation.reservation_id = v_reservation.id
    ) or exists (
      select 1 from public.inventory_shortages shortage
      where shortage.idempotency_key in (
        'reservation-shortage:' || v_reservation.id::text,
        'brokered-reservation:' || v_reservation.id::text
      )
    ) then
      continue;
    end if;

    if v_reservation.kind = 'deal_reservation' then
      v_available := public.inventory_package_allocatable_quantity(v_reservation.package_id);
      v_allocate := least(v_reservation.quantity, v_available);
      if v_allocate > 0 then
        perform public.inventory_allocate_quantity(
          v_reservation.package_id, v_allocate, 'reserved',
          'inventory_reservations_backfill',
          'reservation:' || v_reservation.id::text,
          v_reservation.deal_id, v_line_id, null, null, v_reservation.id,
          'Backfilled active legacy deal reservation',
          jsonb_build_object('backfill', true)
        );
      end if;
      if v_allocate < v_reservation.quantity then
        insert into public.inventory_shortages (
          package_id, deal_id, deal_line_item_id, shortage_type, quantity,
          status, source, idempotency_key, note, metadata
        ) values (
          v_reservation.package_id, v_reservation.deal_id, v_line_id,
          'historical_reconciliation', v_reservation.quantity - v_allocate,
          'open', 'inventory_reservations_backfill',
          'reservation-shortage:' || v_reservation.id::text,
          'Legacy active reservation exceeded cost-layer availability at canonical backfill',
          jsonb_build_object('reservation_id', v_reservation.id, 'backfill', true)
        ) on conflict (idempotency_key) do nothing;
      end if;
    elsif v_reservation.kind = 'sourcing' then
      insert into public.inventory_shortages (
        package_id, deal_id, deal_line_item_id, shortage_type, quantity,
        status, source, idempotency_key, note, metadata
      ) values (
        v_reservation.package_id, v_reservation.deal_id, v_line_id,
        'brokered', v_reservation.quantity, 'open',
        'inventory_reservations_backfill',
        'brokered-reservation:' || v_reservation.id::text,
        'Backfilled brokered/sourcing reservation',
        jsonb_build_object('reservation_id', v_reservation.id, 'backfill', true)
      ) on conflict (idempotency_key) do nothing;
    end if;
  end loop;
end;
$$;

-- Apply current operations locks to rows created by the backfill.
update public.inventory_allocations allocation
set lock_state = 'fulfilment_locked',
    locked_at = timezone('utc', now()),
    locked_reason = 'operations backfill',
    updated_at = timezone('utc', now()),
    metadata = allocation.metadata || jsonb_build_object(
      'reason', 'Existing fulfilment status locked allocation during backfill'
    )
where allocation.state <> 'released'
  and (
    exists (
      select 1 from public.order_operations operation
      where operation.order_id = allocation.order_id
        and (
          operation.fulfilment_status in ('in_progress', 'ready', 'delivered', 'issue')
          or operation.supplier_status in ('confirmed', 'tickets_received')
          or operation.delivery_status = 'delivered'
        )
    )
    or exists (
      select 1 from public.order_supplier_fulfilments fulfilment
      where fulfilment.order_id = allocation.order_id
        and fulfilment.status in ('confirmed', 'tickets_received')
    )
    or exists (
      select 1 from public.deal_operations operation
      where operation.deal_id = allocation.deal_id
        and (
          operation.fulfilment_status in ('in_progress', 'ready', 'delivered', 'issue')
          or operation.supplier_status in ('confirmed', 'tickets_received')
          or operation.delivery_status = 'delivered'
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.inventory_layer_reserved_quantity(uuid) from public;
revoke all on function public.inventory_allocation_enforcement_enabled() from public;
revoke all on function public.inventory_set_allocation_enforcement(boolean) from public;
revoke all on function public.inventory_package_manual_hold_quantity(text) from public;
revoke all on function public.inventory_package_allocatable_quantity(text) from public;
revoke all on function public.inventory_allocate_quantity(
  text, int, text, text, text, uuid, uuid, uuid, uuid, uuid, text, jsonb
) from public;
revoke all on function public.inventory_release_allocations(text, text, boolean) from public;
revoke all on function public.inventory_convert_reservation_allocations(
  uuid, uuid, text, text
) from public;
revoke all on function public.inventory_reconcile_historical_won(
  uuid, boolean, text, text
) from public;
revoke all on function public.inventory_reconcile_historical_inventory(
  boolean, text, int
) from public;
revoke all on function public.inventory_cover_historical_shortages(text, text)
  from public;

grant execute on function public.inventory_layer_reserved_quantity(uuid)
  to authenticated, service_role;
grant execute on function public.inventory_allocation_enforcement_enabled()
  to authenticated, service_role;
grant execute on function public.inventory_set_allocation_enforcement(boolean)
  to authenticated, service_role;
grant execute on function public.inventory_package_manual_hold_quantity(text)
  to authenticated, service_role;
grant execute on function public.inventory_package_allocatable_quantity(text)
  to authenticated, service_role;
grant execute on function public.inventory_allocate_quantity(
  text, int, text, text, text, uuid, uuid, uuid, uuid, uuid, text, jsonb
) to authenticated, service_role;
grant execute on function public.inventory_release_allocations(text, text, boolean)
  to authenticated, service_role;
grant execute on function public.inventory_convert_reservation_allocations(
  uuid, uuid, text, text
) to authenticated, service_role;
grant execute on function public.inventory_reconcile_historical_won(
  uuid, boolean, text, text
) to authenticated, service_role;
grant execute on function public.inventory_reconcile_historical_inventory(
  boolean, text, int
) to authenticated, service_role;
grant execute on function public.inventory_cover_historical_shortages(text, text)
  to service_role;

comment on function public.inventory_allocate_quantity(
  text, int, text, text, text, uuid, uuid, uuid, uuid, uuid, text, jsonb
) is
  'Canonical idempotent FIFO allocator. Locks the linked cost ledger, subtracts active reservations, and refuses over-allocation.';
comment on function public.inventory_release_allocations(text, text, boolean) is
  'Releases a logical allocation request. Committed reversal is explicit and blocked after fulfilment lock.';
comment on function public.inventory_convert_reservation_allocations(uuid, uuid, text, text) is
  'Atomically converts reserved layer chunks to committed COGS for an order line.';
comment on function public.inventory_cover_historical_shortages(text, text) is
  'Idempotently applies newly purchased stock to the oldest open historical shortages for one product.';
comment on function public.inventory_reconcile_historical_inventory(boolean, text, int) is
  'Admin dry-run/apply batch for imported won deals without native orders, processed chronologically.';
