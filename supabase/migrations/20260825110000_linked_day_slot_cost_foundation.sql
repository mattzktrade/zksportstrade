-- Linked day-slot capacity and frozen normalized purchase cost
-- ===========================================================
-- Additive only: package_cost_layers remains the physical purchase row and
-- inventory_allocations remains the allocation/audit row.  Component rows
-- describe which event days each physical unit can satisfy.

create table if not exists public.inventory_group_cost_policies (
  inventory_group_id text primary key,
  allocation_method text not null default 'normalized_trade_price',
  manual_weights jsonb not null default '{}'::jsonb,
  setup_required boolean not null default false,
  setup_reason text,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint inventory_group_cost_policy_method_check
    check (allocation_method in ('normalized_trade_price', 'manual')),
  constraint inventory_group_cost_policy_weights_object_check
    check (jsonb_typeof(manual_weights) = 'object')
);

alter table public.inventory_group_cost_policies enable row level security;
drop policy if exists "inventory_group_cost_policies_staff_select"
  on public.inventory_group_cost_policies;
create policy "inventory_group_cost_policies_staff_select"
  on public.inventory_group_cost_policies for select
  using (
    public.is_admin()
    or public.has_cms_permission('operations.view')
    or public.has_cms_permission('deals.manage')
  );

alter table public.package_cost_layers
  add column if not exists source_package_id text
    references public.packages(id) on delete restrict;
alter table public.package_cost_layers
  add column if not exists source_package_origin text not null default 'explicit';
alter table public.package_cost_layers
  add column if not exists cost_snapshot_frozen_at timestamptz;

alter table public.package_cost_layers
  drop constraint if exists package_cost_layers_source_package_origin_check;
alter table public.package_cost_layers
  add constraint package_cost_layers_source_package_origin_check
  check (source_package_origin in (
    'explicit', 'same_as_ledger', 'inferred_from_allocations',
    'ambiguous_shared_ledger', 'historical_fallback'
  ));

create index if not exists package_cost_layers_source_package_idx
  on public.package_cost_layers(source_package_id);

create table if not exists public.package_cost_layer_day_components (
  id uuid primary key default gen_random_uuid(),
  cost_layer_id uuid not null
    references public.package_cost_layers(id) on delete restrict,
  day_slot text not null,
  units_per_package int not null default 1,
  quantity_total int not null,
  quantity_remaining int not null,
  cost_weight numeric(18,12) not null,
  unit_cost_component numeric(18,6),
  currency text not null,
  weight_source text not null,
  source_trade_price numeric(18,6),
  frozen_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  constraint package_cost_layer_day_components_slot_check
    check (day_slot in ('thursday', 'friday', 'saturday', 'sunday')),
  constraint package_cost_layer_day_components_units_pos
    check (units_per_package > 0),
  constraint package_cost_layer_day_components_quantities_check
    check (
      quantity_total >= 0
      and quantity_remaining >= 0
      and quantity_remaining <= quantity_total
    ),
  constraint package_cost_layer_day_components_weight_check
    check (cost_weight >= 0 and cost_weight <= 1),
  constraint package_cost_layer_day_components_unique
    unique (cost_layer_id, day_slot)
);

create index if not exists package_cost_layer_day_components_capacity_idx
  on public.package_cost_layer_day_components(cost_layer_id, day_slot, quantity_remaining);

create table if not exists public.inventory_allocation_day_components (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null
    references public.inventory_allocations(id) on delete restrict,
  cost_layer_day_component_id uuid not null
    references public.package_cost_layer_day_components(id) on delete restrict,
  day_slot text not null,
  requested_units int not null,
  consumed_units int not null,
  unit_cost_component_snapshot numeric(18,6),
  cost_weight_snapshot numeric(18,12) not null,
  currency_snapshot text not null,
  snapshot_frozen_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint inventory_allocation_day_components_slot_check
    check (day_slot in ('thursday', 'friday', 'saturday', 'sunday')),
  constraint inventory_allocation_day_components_units_check
    check (requested_units > 0 and consumed_units >= 0
      and consumed_units <= requested_units),
  constraint inventory_allocation_day_components_weight_check
    check (cost_weight_snapshot >= 0 and cost_weight_snapshot <= 1),
  constraint inventory_allocation_day_components_unique
    unique (allocation_id, day_slot)
);

create index if not exists inventory_allocation_day_components_layer_idx
  on public.inventory_allocation_day_components(cost_layer_day_component_id, allocation_id);

alter table public.inventory_allocations
  add column if not exists effective_unit_cost_snapshot numeric(18,6);
alter table public.inventory_allocations
  add column if not exists cost_currency_snapshot text;
alter table public.inventory_allocations
  add column if not exists cost_snapshot_frozen_at timestamptz;

create table if not exists public.inventory_cost_restatement_events (
  id uuid primary key default gen_random_uuid(),
  order_cost_consumption_id uuid
    references public.order_cost_consumptions(id) on delete set null,
  allocation_id uuid
    references public.inventory_allocations(id) on delete restrict,
  cost_layer_id uuid not null
    references public.package_cost_layers(id) on delete restrict,
  old_unit_cost numeric(18,6),
  new_unit_cost numeric(18,6),
  old_currency text,
  new_currency text,
  reason text not null,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  occurred_at timestamptz not null default timezone('utc', now()),
  constraint inventory_cost_restatement_reason_nonempty
    check (btrim(reason) <> ''),
  constraint inventory_cost_restatement_idempotency_nonempty
    check (btrim(idempotency_key) <> '')
);

create unique index if not exists inventory_cost_restatement_events_idempotency_idx
  on public.inventory_cost_restatement_events(idempotency_key);
create index if not exists inventory_cost_restatement_events_occ_idx
  on public.inventory_cost_restatement_events(order_cost_consumption_id, occurred_at);

alter table public.package_cost_layer_day_components enable row level security;
alter table public.inventory_allocation_day_components enable row level security;
alter table public.inventory_cost_restatement_events enable row level security;

drop policy if exists "package_cost_layer_day_components_staff_select"
  on public.package_cost_layer_day_components;
create policy "package_cost_layer_day_components_staff_select"
  on public.package_cost_layer_day_components for select
  using (
    public.is_admin()
    or public.has_cms_permission('operations.view')
    or public.has_cms_permission('deals.manage')
  );
drop policy if exists "inventory_allocation_day_components_staff_select"
  on public.inventory_allocation_day_components;
create policy "inventory_allocation_day_components_staff_select"
  on public.inventory_allocation_day_components for select
  using (
    public.is_admin()
    or public.has_cms_permission('operations.view')
    or public.has_cms_permission('deals.manage')
  );
drop policy if exists "inventory_cost_restatement_events_staff_select"
  on public.inventory_cost_restatement_events;
create policy "inventory_cost_restatement_events_staff_select"
  on public.inventory_cost_restatement_events for select
  using (
    public.is_admin()
    or public.has_cms_permission('operations.view')
    or public.has_cms_permission('deals.manage')
  );

create or replace function public.prevent_inventory_component_audit_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'inventory_component_audit_rows_are_append_only';
end;
$$;

drop trigger if exists inventory_allocation_day_components_no_mutation_trg
  on public.inventory_allocation_day_components;
create trigger inventory_allocation_day_components_no_mutation_trg
before update or delete on public.inventory_allocation_day_components
for each row execute function public.prevent_inventory_component_audit_mutation();

drop trigger if exists inventory_cost_restatement_events_append_only_trg
  on public.inventory_cost_restatement_events;
create trigger inventory_cost_restatement_events_append_only_trg
before update or delete on public.inventory_cost_restatement_events
for each row execute function public.prevent_inventory_component_audit_mutation();

create or replace function public.guard_frozen_cost_layer_day_component()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('inventory.component_cost_restatement', true) = 'on' then
    return new;
  end if;
  if new.cost_layer_id is distinct from old.cost_layer_id
    or new.day_slot is distinct from old.day_slot
    or new.units_per_package is distinct from old.units_per_package
    or new.cost_weight is distinct from old.cost_weight
    or new.unit_cost_component is distinct from old.unit_cost_component
    or new.currency is distinct from old.currency
    or new.weight_source is distinct from old.weight_source
    or new.source_trade_price is distinct from old.source_trade_price
    or new.frozen_at is distinct from old.frozen_at
  then
    raise exception 'cost_layer_day_component_snapshot_is_frozen';
  end if;
  return new;
end;
$$;

drop trigger if exists package_cost_layer_day_components_frozen_trg
  on public.package_cost_layer_day_components;
create trigger package_cost_layer_day_components_frozen_trg
before update on public.package_cost_layer_day_components
for each row execute function public.guard_frozen_cost_layer_day_component();

-- Central slot resolver. Duration plus event day handles normal and
-- Thursday-start weekends; package_day_consumption covers custom legacy rows.
create or replace function public.inventory_package_day_slots(p_package_id text)
returns table(day_slot text, units_per_sale int)
language sql
stable
set search_path = public
as $$
  with standard as (
    select slot.day_slot, 1 as units_per_sale
    from public.packages package
    cross join lateral unnest(
      case package.duration
        when '3_day' then case
          -- Saturday race weekends (for example Las Vegas) occupy
          -- Thursday/Friday/Saturday, not Friday/Saturday/Sunday.
          when extract(isodow from package.event_date) = 6
            then array['thursday', 'friday', 'saturday']
          else array['friday', 'saturday', 'sunday']
        end
        when '2_day' then case
          when extract(isodow from package.event_date) = 6
            then array['friday', 'saturday']
          else array['saturday', 'sunday']
        end
        when 'thursday_only' then array['thursday']
        when 'friday_only' then array['friday']
        when 'saturday_only' then array['saturday']
        when 'sunday_only' then array['sunday']
        else array[]::text[]
      end
    ) slot(day_slot)
    where package.id = p_package_id
      and package.duration in (
        '3_day', '2_day', 'thursday_only', 'friday_only',
        'saturday_only', 'sunday_only'
      )
  ),
  configured as (
    select consumption.day_slot, consumption.units_per_sale
    from public.package_day_consumption consumption
    where consumption.package_id = p_package_id
      and not exists (select 1 from standard)
  ),
  event_fallback as (
    -- Non-linked legacy products still need one capacity component so the
    -- canonical allocator remains backwards compatible.
    select case extract(isodow from package.event_date)
      when 4 then 'thursday'
      when 5 then 'friday'
      when 6 then 'saturday'
      else 'sunday'
    end as day_slot, 1 as units_per_sale
    from public.packages package
    where package.id = p_package_id
      and not exists (select 1 from standard)
      and not exists (select 1 from configured)
  )
  select standard.day_slot, standard.units_per_sale from standard
  union all
  select configured.day_slot, configured.units_per_sale from configured
  union all
  select event_fallback.day_slot, event_fallback.units_per_sale
  from event_fallback
  order by 1;
$$;

create or replace function public.inventory_manual_day_weights_valid(
  p_inventory_group_id text,
  p_slots text[]
)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((
    select
      policy.allocation_method = 'manual'
      and not exists (
        select 1
        from unnest(p_slots) slot
        where coalesce((policy.manual_weights ->> slot)::numeric, 0) <= 0
      )
      and abs((
        select coalesce(sum((policy.manual_weights ->> slot)::numeric), 0)
        from unnest(p_slots) slot
      ) - 1) <= 0.000001
    from public.inventory_group_cost_policies policy
    where policy.inventory_group_id = p_inventory_group_id
  ), false);
$$;

-- Central normalized/manual weight resolver. Missing positive component-day
-- prices are deliberately reported as setup-required, never silently averaged.
create or replace function public.inventory_package_day_weights(
  p_source_package_id text,
  p_allow_historical_fallback boolean default false
)
returns table(
  day_slot text,
  units_per_package int,
  cost_weight numeric,
  weight_source text,
  source_trade_price numeric,
  setup_required boolean,
  setup_reason text
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_group text;
  v_slots text[];
  v_slot_count int;
  v_manual boolean;
  v_total_price numeric;
  v_missing boolean;
begin
  select nullif(btrim(package.inventory_group_id), '')
  into v_group
  from public.packages package
  where package.id = p_source_package_id;
  if not found then
    raise exception 'source_package_not_found:%', p_source_package_id;
  end if;

  select array_agg(slot.day_slot order by slot.day_slot), count(*)::int
  into v_slots, v_slot_count
  from public.inventory_package_day_slots(p_source_package_id) slot;
  if coalesce(v_slot_count, 0) = 0 then
    raise exception 'source_package_has_no_day_slots:%', p_source_package_id;
  end if;

  v_manual := v_group is not null
    and public.inventory_manual_day_weights_valid(v_group, v_slots);

  if v_slot_count = 1 then
    return query
    select slot.day_slot, slot.units_per_sale, 1::numeric, 'single_day'::text,
      package.trade_price::numeric, false, null::text
    from public.inventory_package_day_slots(p_source_package_id) slot
    join public.packages package on package.id = p_source_package_id;
    return;
  end if;

  if v_manual then
    return query
    select
      slot.day_slot,
      slot.units_per_sale,
      (policy.manual_weights ->> slot.day_slot)::numeric,
      'manual'::text,
      day_package.trade_price::numeric,
      false,
      null::text
    from public.inventory_package_day_slots(p_source_package_id) slot
    join public.inventory_group_cost_policies policy
      on policy.inventory_group_id = v_group
    left join lateral (
      select package.trade_price
      from public.packages package
      join public.inventory_package_day_slots(package.id) candidate
        on candidate.day_slot = slot.day_slot
      where package.inventory_group_id = v_group
        and package.shell_parent_package_id is null
        and not coalesce(package.inventory_is_standalone, false)
        and (select count(*) from public.inventory_package_day_slots(package.id)) = 1
      order by
        case when coalesce(package.trade_price, 0) > 0 then 0 else 1 end,
        package.id
      limit 1
    ) day_package on true;
    return;
  end if;

  select
    coalesce(sum(day_package.trade_price), 0),
    bool_or(day_package.trade_price is null or day_package.trade_price <= 0)
  into v_total_price, v_missing
  from public.inventory_package_day_slots(p_source_package_id) slot
  left join lateral (
    select package.trade_price::numeric as trade_price
    from public.packages package
    join public.inventory_package_day_slots(package.id) candidate
      on candidate.day_slot = slot.day_slot
    where package.inventory_group_id = v_group
      and package.shell_parent_package_id is null
      and not coalesce(package.inventory_is_standalone, false)
      and (select count(*) from public.inventory_package_day_slots(package.id)) = 1
    order by
      case when coalesce(package.trade_price, 0) > 0 then 0 else 1 end,
      package.id
    limit 1
  ) day_package on true;

  if v_group is null or coalesce(v_missing, true) or coalesce(v_total_price, 0) <= 0 then
    if not coalesce(p_allow_historical_fallback, false) then
      return query
      select slot.day_slot, slot.units_per_sale, 0::numeric,
        'setup_required'::text, null::numeric, true,
        'missing_positive_day_trade_prices_or_valid_manual_weights'::text
      from public.inventory_package_day_slots(p_source_package_id) slot;
      return;
    end if;
    return query
    select slot.day_slot, slot.units_per_sale,
      (1::numeric / v_slot_count::numeric), 'historical_equal_fallback'::text,
      null::numeric, true,
      'historical_origin_or_prices_ambiguous'::text
    from public.inventory_package_day_slots(p_source_package_id) slot;
    return;
  end if;

  return query
  select
    slot.day_slot,
    slot.units_per_sale,
    day_package.trade_price / v_total_price,
    'normalized_trade_price'::text,
    day_package.trade_price,
    false,
    null::text
  from public.inventory_package_day_slots(p_source_package_id) slot
  join lateral (
    select package.trade_price::numeric as trade_price
    from public.packages package
    join public.inventory_package_day_slots(package.id) candidate
      on candidate.day_slot = slot.day_slot
    where package.inventory_group_id = v_group
      and package.shell_parent_package_id is null
      and not coalesce(package.inventory_is_standalone, false)
      and (select count(*) from public.inventory_package_day_slots(package.id)) = 1
      and package.trade_price > 0
    order by package.id
    limit 1
  ) day_package on true;
end;
$$;

create or replace function public.inventory_freeze_cost_layer_day_components(
  p_cost_layer_id uuid,
  p_allow_historical_fallback boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer public.package_cost_layers%rowtype;
  v_weight record;
  v_existing int;
  v_frozen_at timestamptz := timezone('utc', now());
  v_allocated_cost numeric := 0;
  v_component_cost numeric;
begin
  select * into v_layer
  from public.package_cost_layers layer
  where layer.id = p_cost_layer_id
  for update;
  if not found then raise exception 'cost_layer_not_found'; end if;

  select count(*)::int into v_existing
  from public.package_cost_layer_day_components component
  where component.cost_layer_id = p_cost_layer_id;
  if v_existing > 0 then return; end if;

  if v_layer.source_package_id is null then
    raise exception 'cost_layer_source_package_required:%', p_cost_layer_id;
  end if;

  for v_weight in
    select
      weight.*,
      row_number() over (order by weight.day_slot) as component_number,
      count(*) over () as component_count
    from public.inventory_package_day_weights(
      v_layer.source_package_id,
      p_allow_historical_fallback
    ) weight
    order by day_slot
  loop
    if v_weight.setup_required and not coalesce(p_allow_historical_fallback, false) then
      raise exception 'inventory_cost_policy_setup_required:%:%',
        v_layer.source_package_id, v_weight.setup_reason;
    end if;
    v_component_cost := case
      when v_layer.unit_cost is null then null
      -- Assign the rounding remainder to the final component so frozen
      -- component costs always add back to the exact physical unit cost.
      when v_weight.component_number = v_weight.component_count
        then round(v_layer.unit_cost - v_allocated_cost, 6)
      else round(v_layer.unit_cost * v_weight.cost_weight, 6)
    end;

    insert into public.package_cost_layer_day_components (
      cost_layer_id, day_slot, units_per_package,
      quantity_total, quantity_remaining, cost_weight,
      unit_cost_component, currency, weight_source,
      source_trade_price, frozen_at, metadata
    ) values (
      v_layer.id,
      v_weight.day_slot,
      v_weight.units_per_package,
      v_layer.quantity * v_weight.units_per_package,
      -- Start from physical purchased capacity. Historical canonical
      -- allocations are replayed per slot below; using the aggregate legacy
      -- remainder here would charge those sales twice and would also discard
      -- untouched-day capacity.
      v_layer.quantity * v_weight.units_per_package,
      v_weight.cost_weight,
      v_component_cost,
      coalesce(nullif(btrim(v_layer.currency), ''), 'USD'),
      v_weight.weight_source,
      v_weight.source_trade_price,
      v_frozen_at,
      jsonb_build_object(
        'source_package_id', v_layer.source_package_id,
        'source_package_origin', v_layer.source_package_origin,
        'setup_required_at_freeze', v_weight.setup_required,
        'setup_reason', v_weight.setup_reason
      )
    );
    if v_component_cost is not null then
      v_allocated_cost := v_allocated_cost + v_component_cost;
    end if;
  end loop;

  update public.package_cost_layers
  set cost_snapshot_frozen_at = v_frozen_at
  where id = p_cost_layer_id;
end;
$$;

create or replace function public.inventory_layer_component_available_quantity(
  p_cost_layer_id uuid,
  p_sold_package_id text
)
returns int
language sql
stable
set search_path = public
as $$
  with required as (
    select slot.day_slot, slot.units_per_sale
    from public.inventory_package_day_slots(p_sold_package_id) slot
  ),
  capacity as (
    select
      required.day_slot,
      floor(greatest(
        component.quantity_remaining - coalesce((
          select sum(allocation_component.requested_units)
          from public.inventory_allocation_day_components allocation_component
          join public.inventory_allocations allocation
            on allocation.id = allocation_component.allocation_id
          where allocation_component.cost_layer_day_component_id = component.id
            and allocation.state = 'reserved'
        ), 0),
        0
      )::numeric / required.units_per_sale)::int as available
    from required
    left join public.package_cost_layer_day_components component
      on component.cost_layer_id = p_cost_layer_id
     and component.day_slot = required.day_slot
  )
  select case
    when not exists (select 1 from required) then 0
    when exists (select 1 from capacity where available is null) then 0
    else coalesce(min(available), 0)::int
  end
  from capacity;
$$;

create or replace function public.inventory_layer_effective_unit_cost(
  p_cost_layer_id uuid,
  p_sold_package_id text
)
returns numeric
language sql
stable
set search_path = public
as $$
  select case
    when count(*) <> (select count(*) from public.inventory_package_day_slots(p_sold_package_id))
      then null
    when bool_or(component.unit_cost_component is null) then null
    else round(sum(component.unit_cost_component * required.units_per_sale), 6)
  end
  from public.inventory_package_day_slots(p_sold_package_id) required
  join public.package_cost_layer_day_components component
    on component.cost_layer_id = p_cost_layer_id
   and component.day_slot = required.day_slot;
$$;

create or replace function public.inventory_recompute_layer_remaining(
  p_cost_layer_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining int;
begin
  select coalesce(min(floor(
    component.quantity_remaining::numeric / component.units_per_package
  )), 0)::int
  into v_remaining
  from public.package_cost_layer_day_components component
  where component.cost_layer_id = p_cost_layer_id;

  perform set_config('inventory.component_remaining_write', 'on', true);
  update public.package_cost_layers
  set quantity_remaining = greatest(v_remaining, 0),
      updated_at = timezone('utc', now())
  where id = p_cost_layer_id;
  perform set_config('inventory.component_remaining_write', 'off', true);
  return greatest(v_remaining, 0);
end;
$$;

create or replace function public.guard_cost_layer_remaining_from_components()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('inventory.component_remaining_write', true) = 'on'
    or not exists (
      select 1 from public.package_cost_layer_day_components component
      where component.cost_layer_id = new.id
    )
  then
    return new;
  end if;
  select coalesce(min(floor(
    component.quantity_remaining::numeric / component.units_per_package
  )), 0)::int
  into new.quantity_remaining
  from public.package_cost_layer_day_components component
  where component.cost_layer_id = new.id;
  return new;
end;
$$;

drop trigger if exists package_cost_layers_component_remaining_guard_trg
  on public.package_cost_layers;
create trigger package_cost_layers_component_remaining_guard_trg
before update of quantity_remaining on public.package_cost_layers
for each row execute function public.guard_cost_layer_remaining_from_components();

create or replace function public.default_cost_layer_source_package()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_package_id is null then
    new.source_package_id := new.package_id;
    new.source_package_origin := 'same_as_ledger';
  end if;
  return new;
end;
$$;

create or replace function public.freeze_new_cost_layer_day_components()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.inventory_freeze_cost_layer_day_components(new.id, false);
  return new;
end;
$$;

drop trigger if exists package_cost_layers_default_source_package_trg
  on public.package_cost_layers;
create trigger package_cost_layers_default_source_package_trg
before insert on public.package_cost_layers
for each row execute function public.default_cost_layer_source_package();

drop trigger if exists package_cost_layers_freeze_day_components_trg
  on public.package_cost_layers;
drop trigger if exists package_cost_layers_00_freeze_day_components_trg
  on public.package_cost_layers;
-- PostgreSQL runs same-event triggers by name. "00" intentionally freezes the
-- layer before the existing shortage-cover trigger tries to allocate it.
create trigger package_cost_layers_00_freeze_day_components_trg
after insert on public.package_cost_layers
for each row execute function public.freeze_new_cost_layer_day_components();

-- New stock may only be assigned a source package compatible with its physical
-- ledger. Standalone packages never borrow a linked parent's components.
create or replace function public.inventory_layer_is_candidate(
  p_cost_layer_id uuid,
  p_sold_package_id text
)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((
    select
      case
        when sold.inventory_is_standalone
          then layer.source_package_id = sold.id
        when nullif(btrim(sold.inventory_group_id), '') is null
          then layer.source_package_id = sold.id
        else source.inventory_group_id = sold.inventory_group_id
          and not coalesce(source.inventory_is_standalone, false)
      end
      and not exists (
        select 1
        from public.inventory_package_day_slots(sold.id) required
        where not exists (
          select 1
          from public.package_cost_layer_day_components component
          where component.cost_layer_id = layer.id
            and component.day_slot = required.day_slot
        )
      )
    from public.package_cost_layers layer
    join public.packages sold on sold.id = p_sold_package_id
    join public.packages source on source.id = layer.source_package_id
    where layer.id = p_cost_layer_id
  ), false);
$$;

-- Seed policy rows and identify the historical physical origin without deleting
-- or replacing any purchase row. A shared ledger with mixed sold products is
-- intentionally flagged ambiguous.
insert into public.inventory_group_cost_policies (inventory_group_id)
select distinct package.inventory_group_id
from public.packages package
where nullif(btrim(package.inventory_group_id), '') is not null
on conflict (inventory_group_id) do nothing;

with layer_evidence as (
  select
    layer.id,
    count(distinct allocation.package_id) filter (
      where allocation.state <> 'released'
    ) as sold_package_count,
    min(allocation.package_id) filter (
      where allocation.state <> 'released'
    ) as only_sold_package_id
  from public.package_cost_layers layer
  left join public.inventory_allocations allocation
    on allocation.cost_layer_id = layer.id
  group by layer.id
)
update public.package_cost_layers layer
set source_package_id = layer.package_id,
    source_package_origin = case
      -- A sold child identifies what was consumed, not what was purchased.
      -- Keep the physical row's package as the source and flag any shared use
      -- for review instead of inventing a more specific origin.
      when evidence.sold_package_count > 1
        or (
          evidence.sold_package_count = 1
          and evidence.only_sold_package_id is distinct from layer.package_id
        )
        then 'ambiguous_shared_ledger'
      else 'same_as_ledger'
    end
from layer_evidence evidence
where evidence.id = layer.id
  and layer.source_package_id is null;

do $$
declare
  v_layer record;
  v_setup_required boolean;
  v_reason text;
begin
  for v_layer in
    select layer.id, layer.source_package_id, package.inventory_group_id
    from public.package_cost_layers layer
    join public.packages package on package.id = layer.source_package_id
    where not exists (
      select 1 from public.package_cost_layer_day_components component
      where component.cost_layer_id = layer.id
    )
    order by layer.received_at, layer.id
  loop
    select bool_or(weight.setup_required), max(weight.setup_reason)
    into v_setup_required, v_reason
    from public.inventory_package_day_weights(v_layer.source_package_id, true) weight;

    perform public.inventory_freeze_cost_layer_day_components(v_layer.id, true);
    if coalesce(v_setup_required, false) and v_layer.inventory_group_id is not null then
      update public.inventory_group_cost_policies
      set setup_required = true,
          setup_reason = coalesce(v_reason, 'historical_origin_or_prices_ambiguous'),
          updated_at = timezone('utc', now())
      where inventory_group_id = v_layer.inventory_group_id;
    end if;
  end loop;
end;
$$;

-- Backfill immutable allocation component evidence. Capacity is assigned FIFO;
-- excess demand remains represented by its original allocation and is also
-- made explicit as a per-day historical shortage.
do $$
declare
  v_allocation record;
  v_required record;
  v_component record;
  v_requested int;
  v_consumed int;
  v_effective_cost numeric;
  v_currency text;
  v_shortage int;
  v_shortage_quantity int;
  v_shortage_details jsonb;
  v_reserved_units int;
begin
  for v_allocation in
    select allocation.*
    from public.inventory_allocations allocation
    order by allocation.created_at, allocation.id
  loop
    if exists (
      select 1 from public.inventory_allocation_day_components component
      where component.allocation_id = v_allocation.id
    ) then
      continue;
    end if;

    v_effective_cost := 0;
    v_currency := null;
    v_shortage_quantity := 0;
    v_shortage_details := '{}'::jsonb;
    for v_required in
      select * from public.inventory_package_day_slots(v_allocation.package_id)
      order by day_slot
    loop
      v_component := null;
      select * into v_component
      from public.package_cost_layer_day_components component
      where component.cost_layer_id = v_allocation.cost_layer_id
        and component.day_slot = v_required.day_slot
      for update;

      v_requested := v_allocation.quantity * v_required.units_per_sale;
      select coalesce(sum(allocation_component.requested_units), 0)::int
      into v_reserved_units
      from public.inventory_allocation_day_components allocation_component
      join public.inventory_allocations prior_allocation
        on prior_allocation.id = allocation_component.allocation_id
      where allocation_component.cost_layer_day_component_id = v_component.id
        and prior_allocation.state = 'reserved';
      v_consumed := case
        when v_allocation.state = 'released' then 0
        when v_component.id is null then 0
        else least(
          v_requested,
          greatest(v_component.quantity_remaining - v_reserved_units, 0)
        )
      end;

      if v_component.id is not null then
        insert into public.inventory_allocation_day_components (
          allocation_id, cost_layer_day_component_id, day_slot,
          requested_units, consumed_units, unit_cost_component_snapshot,
          cost_weight_snapshot, currency_snapshot, snapshot_frozen_at, metadata
        ) values (
          v_allocation.id, v_component.id, v_required.day_slot,
          v_requested, v_consumed, v_component.unit_cost_component,
          v_component.cost_weight, v_component.currency, v_component.frozen_at,
          jsonb_build_object(
            'backfill', true,
            'historical_origin', (
              select layer.source_package_origin
              from public.package_cost_layers layer
              where layer.id = v_allocation.cost_layer_id
            )
          )
        );

        if v_allocation.state = 'committed' then
          update public.package_cost_layer_day_components
          set quantity_remaining = quantity_remaining - v_consumed
          where id = v_component.id;
        end if;
        v_effective_cost := v_effective_cost
          + coalesce(v_component.unit_cost_component, 0)
            * v_required.units_per_sale;
        v_currency := coalesce(v_currency, v_component.currency);
      end if;

      v_shortage := v_requested - v_consumed;
      if v_allocation.state <> 'released' and v_shortage > 0 then
        -- One sold package can be short on several required days. Store one
        -- package-level shortage (the maximum uncovered sale quantity), with
        -- per-day detail in metadata, so net demand is never double counted.
        v_shortage_quantity := greatest(
          v_shortage_quantity,
          ceil(v_shortage::numeric / v_required.units_per_sale)::int
        );
        v_shortage_details := v_shortage_details || jsonb_build_object(
          v_required.day_slot,
          jsonb_build_object(
            'requested_units', v_requested,
            'covered_units', v_consumed
          )
        );
      end if;
    end loop;

    if v_shortage_quantity > 0 then
      insert into public.inventory_shortages (
        package_id, deal_id, deal_line_item_id, order_id, order_line_item_id,
        shortage_type, quantity, status, source, idempotency_key,
        note, metadata
      ) values (
        v_allocation.package_id, v_allocation.deal_id,
        v_allocation.deal_line_item_id, v_allocation.order_id,
        v_allocation.order_line_item_id, 'historical_reconciliation',
        v_shortage_quantity, 'open', 'day_component_backfill',
        'day-component-overcapacity:' || v_allocation.id::text,
        'Historical allocation exceeded physical day capacity',
        jsonb_build_object(
          'allocation_id', v_allocation.id,
          'cost_layer_id', v_allocation.cost_layer_id,
          'day_shortages', v_shortage_details,
          'ambiguous_origin', (
            select layer.source_package_origin = 'ambiguous_shared_ledger'
            from public.package_cost_layers layer
            where layer.id = v_allocation.cost_layer_id
          ),
          'backfill', true
        )
      ) on conflict (idempotency_key) do nothing;
    end if;

    update public.inventory_allocations
    set effective_unit_cost_snapshot = case
          when v_effective_cost = 0 then null else round(v_effective_cost, 6)
        end,
        cost_currency_snapshot = v_currency,
        cost_snapshot_frozen_at = coalesce(
          cost_snapshot_frozen_at,
          timezone('utc', now())
        ),
        metadata = metadata || jsonb_build_object(
          'day_component_backfill', true
        )
    where id = v_allocation.id;
  end loop;

  for v_component in
    select distinct component.cost_layer_id
    from public.package_cost_layer_day_components component
  loop
    perform public.inventory_recompute_layer_remaining(v_component.cost_layer_id);
  end loop;
end;
$$;

-- Preserve the fulfilment lock while allowing snapshot-only updates. The
-- previous guard returned OLD for allowed UPDATEs, which silently discarded a
-- legitimate unit-cost restatement.
create or replace function public.guard_locked_order_cost_consumption()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.inventory_allocation_enforcement_enabled()
    or current_setting('inventory.canonical_write', true) = 'on'
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE'
    and new.order_id is not distinct from old.order_id
    and new.cost_layer_id is not distinct from old.cost_layer_id
    and new.package_id is not distinct from old.package_id
    and new.quantity is not distinct from old.quantity
  then
    return new;
  end if;
  if exists (
    select 1
    from public.inventory_allocations allocation
    where (
        allocation.order_cost_consumption_id = old.id
        or allocation.idempotency_key = 'occ:' || old.id::text
      )
      and allocation.state <> 'released'
      and allocation.lock_state = 'fulfilment_locked'
  ) then
    raise exception 'allocation_fulfilment_locked';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Restate compatibility COGS to the frozen sold-slot cost and audit every
-- changed value. The physical OCC row and its allocation remain in place.
with restatable as (
  select
    consumption.id as occ_id,
    allocation.id as allocation_id,
    allocation.cost_layer_id,
    consumption.unit_cost as old_unit_cost,
    allocation.effective_unit_cost_snapshot as new_unit_cost,
    consumption.currency as old_currency,
    coalesce(allocation.cost_currency_snapshot, consumption.currency) as new_currency
  from public.order_cost_consumptions consumption
  join public.inventory_allocations allocation
    on allocation.order_cost_consumption_id = consumption.id
  where allocation.effective_unit_cost_snapshot is not null
    and (
      consumption.unit_cost is distinct from allocation.effective_unit_cost_snapshot
      or consumption.currency is distinct from
        coalesce(allocation.cost_currency_snapshot, consumption.currency)
    )
),
audited as (
  insert into public.inventory_cost_restatement_events (
    order_cost_consumption_id, allocation_id, cost_layer_id,
    old_unit_cost, new_unit_cost, old_currency, new_currency,
    reason, idempotency_key, metadata
  )
  select
    restatable.occ_id, restatable.allocation_id, restatable.cost_layer_id,
    restatable.old_unit_cost, restatable.new_unit_cost,
    restatable.old_currency, restatable.new_currency,
    'Historical OCC restated to frozen day-component cost',
    'day-component-backfill:occ:' || restatable.occ_id::text,
    jsonb_build_object('backfill', true)
  from restatable
  on conflict (idempotency_key) do nothing
  returning order_cost_consumption_id
)
update public.order_cost_consumptions consumption
set unit_cost = restatable.new_unit_cost,
    currency = restatable.new_currency
from restatable
where consumption.id = restatable.occ_id
  and (
    consumption.unit_cost is distinct from restatable.new_unit_cost
    or consumption.currency is distinct from restatable.new_currency
  );

create or replace function public.assert_inventory_layer_component_capacity(
  p_cost_layer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invalid record;
begin
  select component.* into v_invalid
  from public.package_cost_layer_day_components component
  where component.cost_layer_id = p_cost_layer_id
    and (
      component.quantity_remaining < 0
      or component.quantity_remaining > component.quantity_total
      or coalesce((
        select sum(allocation_component.requested_units)
        from public.inventory_allocation_day_components allocation_component
        join public.inventory_allocations allocation
          on allocation.id = allocation_component.allocation_id
        where allocation_component.cost_layer_day_component_id = component.id
          and allocation.state = 'reserved'
      ), 0) > component.quantity_remaining
    )
  order by component.day_slot
  limit 1;
  if found then
    raise exception 'inventory_day_component_capacity_exceeded:%:%',
      p_cost_layer_id, v_invalid.day_slot;
  end if;
end;
$$;

-- Replace the old aggregate assertion. Independent Friday/Saturday/Sunday
-- consumption can legitimately make committed allocation rows sum above the
-- number of full multi-day packages.
create or replace function public.assert_inventory_layer_capacity(
  p_cost_layer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.package_cost_layer_day_components component
    where component.cost_layer_id = p_cost_layer_id
  ) then
    perform public.assert_inventory_layer_component_capacity(p_cost_layer_id);
    return;
  end if;
  if exists (
    select 1 from public.package_cost_layers layer
    where layer.id = p_cost_layer_id
      and (layer.quantity_remaining < 0
        or layer.quantity_remaining > layer.quantity)
  ) then
    raise exception 'invalid_cost_layer_remaining:%', p_cost_layer_id;
  end if;
end;
$$;

grant select on public.inventory_group_cost_policies,
  public.package_cost_layer_day_components,
  public.inventory_allocation_day_components,
  public.inventory_cost_restatement_events
to authenticated, service_role;

revoke all on function public.inventory_package_day_slots(text) from public;
revoke all on function public.inventory_package_day_weights(text, boolean) from public;
revoke all on function public.inventory_freeze_cost_layer_day_components(uuid, boolean) from public;
revoke all on function public.inventory_layer_component_available_quantity(uuid, text) from public;
revoke all on function public.inventory_layer_effective_unit_cost(uuid, text) from public;
revoke all on function public.inventory_layer_is_candidate(uuid, text) from public;
revoke all on function public.inventory_recompute_layer_remaining(uuid) from public;
revoke all on function public.assert_inventory_layer_component_capacity(uuid) from public;

grant execute on function public.inventory_package_day_slots(text)
  to authenticated, service_role;
grant execute on function public.inventory_package_day_weights(text, boolean)
  to authenticated, service_role;
grant execute on function public.inventory_layer_component_available_quantity(uuid, text)
  to authenticated, service_role;
grant execute on function public.inventory_layer_effective_unit_cost(uuid, text)
  to authenticated, service_role;
grant execute on function public.inventory_layer_is_candidate(uuid, text)
  to authenticated, service_role;
grant execute on function public.inventory_freeze_cost_layer_day_components(uuid, boolean)
  to service_role;
grant execute on function public.inventory_recompute_layer_remaining(uuid)
  to service_role;
grant execute on function public.assert_inventory_layer_component_capacity(uuid)
  to service_role;

comment on table public.package_cost_layer_day_components is
  'Frozen per-day capacity and cost split beneath each physical purchase layer.';
comment on table public.inventory_allocation_day_components is
  'Immutable day-slot and cost snapshots consumed by one canonical allocation.';
comment on table public.inventory_cost_restatement_events is
  'Append-only audit for compatibility COGS changes caused by frozen day-cost normalization.';
