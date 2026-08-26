-- Close remaining mutable stock/COGS paths over day components.

-- Released allocation evidence must survive deletion of an unused physical
-- layer. Keep its frozen component row and detach that row from the layer.
do $$
declare
  v_constraint text;
begin
  select constraint_name into v_constraint
  from information_schema.key_column_usage
  where table_schema = 'public'
    and table_name = 'package_cost_layer_day_components'
    and column_name = 'cost_layer_id'
    and position_in_unique_constraint is not null
  limit 1;
  if v_constraint is not null then
    execute format(
      'alter table public.package_cost_layer_day_components drop constraint %I',
      v_constraint
    );
  end if;
end;
$$;

alter table public.package_cost_layer_day_components
  alter column cost_layer_id drop not null;
alter table public.package_cost_layer_day_components
  add constraint package_cost_layer_day_components_cost_layer_fk
  foreign key (cost_layer_id)
  references public.package_cost_layers(id)
  on delete set null;

do $$
declare
  v_constraint text;
begin
  select constraint_name into v_constraint
  from information_schema.key_column_usage
  where table_schema = 'public'
    and table_name = 'inventory_cost_restatement_events'
    and column_name = 'cost_layer_id'
    and position_in_unique_constraint is not null
  limit 1;
  if v_constraint is not null then
    execute format(
      'alter table public.inventory_cost_restatement_events drop constraint %I',
      v_constraint
    );
  end if;
end;
$$;

alter table public.inventory_cost_restatement_events
  alter column cost_layer_id drop not null;
alter table public.inventory_cost_restatement_events
  add constraint inventory_cost_restatement_events_cost_layer_fk
  foreign key (cost_layer_id)
  references public.package_cost_layers(id)
  on delete set null;

create or replace function public.inventory_historical_allocatable_quantity(
  p_package_id text
)
returns int
language sql
stable
set search_path = public
as $$
  select public.inventory_package_allocatable_quantity(p_package_id);
$$;

create or replace function public.inventory_allocate_historical_quantity(
  p_package_id text,
  p_quantity int,
  p_request_key text,
  p_deal_id uuid,
  p_deal_line_item_id uuid,
  p_reason text default 'Applied historical won reconciliation',
  p_metadata jsonb default '{}'::jsonb
)
returns int
language sql
security definer
set search_path = public
as $$
  select public.inventory_allocate_quantity(
    p_package_id,
    p_quantity,
    'committed',
    'historical_won_reconciliation',
    p_request_key,
    p_deal_id,
    p_deal_line_item_id,
    null,
    null,
    null,
    p_reason,
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object('historical_reconciliation', true)
  );
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
  v_layer public.package_cost_layers%rowtype;
  v_component record;
  v_delta int;
  v_reserved int;
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'invalid_quantity';
  end if;

  select * into v_layer
  from public.package_cost_layers layer
  where layer.id = p_layer_id
  for update;
  if not found then raise exception 'cost_layer_not_found'; end if;

  perform 1
  from public.package_cost_layer_day_components component
  where component.cost_layer_id = p_layer_id
  order by component.day_slot
  for update;

  v_delta := p_new_quantity - v_layer.quantity;
  if v_delta = 0 then return; end if;

  for v_component in
    select component.*
    from public.package_cost_layer_day_components component
    where component.cost_layer_id = p_layer_id
    order by component.day_slot
  loop
    select coalesce(sum(allocation_component.requested_units), 0)::int
    into v_reserved
    from public.inventory_allocation_day_components allocation_component
    join public.inventory_allocations allocation
      on allocation.id = allocation_component.allocation_id
    where allocation_component.cost_layer_day_component_id = v_component.id
      and allocation.state = 'reserved';

    if v_component.quantity_total + v_delta * v_component.units_per_package < 0
      or v_component.quantity_remaining
        + v_delta * v_component.units_per_package < v_reserved
    then
      raise exception 'quantity_below_consumed_or_reserved:%',
        v_component.day_slot;
    end if;

    update public.package_cost_layer_day_components
    set quantity_total =
          quantity_total + v_delta * v_component.units_per_package,
        quantity_remaining =
          quantity_remaining + v_delta * v_component.units_per_package
    where id = v_component.id;
  end loop;

  perform set_config('inventory.component_remaining_write', 'on', true);
  update public.package_cost_layers
  set quantity = p_new_quantity,
      updated_at = timezone('utc', now())
  where id = p_layer_id;
  perform set_config('inventory.component_remaining_write', 'off', true);
  perform public.inventory_recompute_layer_remaining(p_layer_id);

  perform public.adjust_linked_inventory_available(v_layer.package_id, v_delta);
  perform public.assert_inventory_layer_component_capacity(p_layer_id);
end;
$$;

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
  v_layer public.package_cost_layers%rowtype;
  v_component record;
  v_allocation record;
  v_new_unit_cost numeric;
  v_new_currency text;
  v_component_cost numeric;
  v_allocated_cost numeric := 0;
  v_effective_cost numeric;
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_layer
  from public.package_cost_layers layer
  where layer.id = p_layer_id
  for update;
  if not found then raise exception 'cost_layer_not_found'; end if;

  v_new_unit_cost := coalesce(p_unit_cost, v_layer.unit_cost);
  if v_new_unit_cost is null or v_new_unit_cost < 0 then
    raise exception 'invalid_unit_cost';
  end if;
  v_new_currency := coalesce(
    nullif(btrim(p_currency), ''),
    nullif(btrim(v_layer.currency), ''),
    'USD'
  );

  update public.package_cost_layers
  set unit_cost = v_new_unit_cost,
      currency = v_new_currency,
      note = case
        when p_note is null then note
        when btrim(p_note) = '' then null
        else btrim(p_note)
      end,
      received_at = coalesce(p_received_at, received_at),
      updated_at = timezone('utc', now())
  where id = p_layer_id;

  if v_new_unit_cost is not distinct from v_layer.unit_cost
    and v_new_currency is not distinct from v_layer.currency
  then return; end if;

  perform set_config('inventory.component_cost_restatement', 'on', true);
  perform 1
  from public.package_cost_layer_day_components component
  where component.cost_layer_id = p_layer_id
  order by component.day_slot
  for update;
  for v_component in
    select
      component.*,
      row_number() over (order by component.day_slot) as component_number,
      count(*) over () as component_count
    from public.package_cost_layer_day_components component
    where component.cost_layer_id = p_layer_id
    order by component.day_slot
  loop
    v_component_cost := case
      when v_component.component_number = v_component.component_count
        then round(v_new_unit_cost - v_allocated_cost, 6)
      else round(v_new_unit_cost * v_component.cost_weight, 6)
    end;
    update public.package_cost_layer_day_components
    set unit_cost_component = v_component_cost,
        currency = v_new_currency,
        metadata = metadata || jsonb_build_object(
          'cost_restatement_at', timezone('utc', now()),
          'previous_unit_cost_component', v_component.unit_cost_component
        )
    where id = v_component.id;
    v_allocated_cost := v_allocated_cost + v_component_cost;
  end loop;
  perform set_config('inventory.component_cost_restatement', 'off', true);

  if not coalesce(p_cascade_to_consumptions, true) then return; end if;

  for v_allocation in
    select allocation.*
    from public.inventory_allocations allocation
    where allocation.cost_layer_id = p_layer_id
    order by allocation.created_at, allocation.id
    for update
  loop
    v_effective_cost := public.inventory_layer_effective_unit_cost(
      p_layer_id,
      v_allocation.package_id
    );

    if v_allocation.order_cost_consumption_id is not null
      and (
        v_allocation.effective_unit_cost_snapshot is distinct from v_effective_cost
        or v_allocation.cost_currency_snapshot is distinct from v_new_currency
      )
    then
      insert into public.inventory_cost_restatement_events (
        order_cost_consumption_id,
        allocation_id,
        cost_layer_id,
        old_unit_cost,
        new_unit_cost,
        old_currency,
        new_currency,
        reason,
        idempotency_key,
        actor_profile_id,
        metadata
      ) values (
        v_allocation.order_cost_consumption_id,
        v_allocation.id,
        p_layer_id,
        v_allocation.effective_unit_cost_snapshot,
        v_effective_cost,
        v_allocation.cost_currency_snapshot,
        v_new_currency,
        'Purchase cost corrected; frozen day weights retained',
        'cost-layer-edit:' || p_layer_id::text || ':allocation:'
          || v_allocation.id::text || ':' || gen_random_uuid()::text,
        auth.uid(),
        jsonb_build_object('cascade_to_consumptions', true)
      );

      perform set_config('inventory.canonical_write', 'on', true);
      update public.order_cost_consumptions
      set unit_cost = v_effective_cost,
          currency = v_new_currency
      where id = v_allocation.order_cost_consumption_id;
      perform set_config('inventory.canonical_write', 'off', true);
    end if;

    update public.inventory_allocations
    set effective_unit_cost_snapshot = v_effective_cost,
        cost_currency_snapshot = v_new_currency,
        cost_snapshot_frozen_at = timezone('utc', now()),
        updated_at = timezone('utc', now()),
        metadata = metadata || jsonb_build_object(
          'cost_restatement_at', timezone('utc', now())
        )
    where id = v_allocation.id;
  end loop;
end;
$$;

-- Uncosted quantity writes would bypass supplier, component capacity, and COGS.
-- Reconciliation must therefore add/edit a purchase layer (or delete unused
-- stock), never mutate the legacy package_inventory counter by itself.
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
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  raise exception 'canonical_stock_adjustment_requires_purchase_layer';
end;
$$;

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
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  raise exception 'canonical_stock_adjustment_requires_purchase_layer';
end;
$$;

revoke all on function public.inventory_historical_allocatable_quantity(text)
  from public;
grant execute on function public.inventory_historical_allocatable_quantity(text)
  to authenticated, service_role;
revoke all on function public.inventory_allocate_historical_quantity(
  text, int, text, uuid, uuid, text, jsonb
) from public;
grant execute on function public.inventory_allocate_historical_quantity(
  text, int, text, uuid, uuid, text, jsonb
) to authenticated, service_role;
revoke all on function public.admin_update_cost_layer_quantity(uuid, int)
  from public;
grant execute on function public.admin_update_cost_layer_quantity(uuid, int)
  to authenticated, service_role;
revoke all on function public.admin_update_cost_layer(
  uuid, numeric, text, text, timestamptz, boolean
) from public;
grant execute on function public.admin_update_cost_layer(
  uuid, numeric, text, text, timestamptz, boolean
) to authenticated, service_role;
revoke all on function public.admin_set_opening_balance(text, int, text)
  from public;
grant execute on function public.admin_set_opening_balance(text, int, text)
  to authenticated, service_role;
revoke all on function public.admin_adjust_stock_with_reason(text, int, text)
  from public;
grant execute on function public.admin_adjust_stock_with_reason(text, int, text)
  to authenticated, service_role;
