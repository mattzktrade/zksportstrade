-- Route canonical inventory mutations through frozen day components.

create or replace function public.inventory_attach_allocation_day_components(
  p_allocation_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allocation public.inventory_allocations%rowtype;
  v_required record;
  v_component public.package_cost_layer_day_components%rowtype;
  v_units int;
  v_effective numeric := 0;
  v_currency text;
  v_component_count int := 0;
begin
  select * into v_allocation
  from public.inventory_allocations allocation
  where allocation.id = p_allocation_id
  for update;
  if not found then raise exception 'allocation_not_found'; end if;

  if exists (
    select 1 from public.inventory_allocation_day_components component
    where component.allocation_id = p_allocation_id
  ) then
    return v_allocation.effective_unit_cost_snapshot;
  end if;

  for v_required in
    select * from public.inventory_package_day_slots(v_allocation.package_id)
    order by day_slot
  loop
    select * into v_component
    from public.package_cost_layer_day_components component
    where component.cost_layer_id = v_allocation.cost_layer_id
      and component.day_slot = v_required.day_slot
    for update;
    if not found then
      raise exception 'cost_layer_missing_required_day:%:%',
        v_allocation.cost_layer_id, v_required.day_slot;
    end if;

    v_units := v_allocation.quantity * v_required.units_per_sale;
    if v_allocation.state = 'committed'
      and v_component.quantity_remaining < v_units
    then
      raise exception 'insufficient_day_slot_capacity:%:%:%:%',
        v_allocation.cost_layer_id, v_required.day_slot,
        v_units, v_component.quantity_remaining;
    end if;

    insert into public.inventory_allocation_day_components (
      allocation_id, cost_layer_day_component_id, day_slot,
      requested_units, consumed_units,
      unit_cost_component_snapshot, cost_weight_snapshot,
      currency_snapshot, snapshot_frozen_at, metadata
    ) values (
      v_allocation.id, v_component.id, v_required.day_slot,
      v_units, v_units,
      v_component.unit_cost_component, v_component.cost_weight,
      v_component.currency, v_component.frozen_at,
      jsonb_build_object(
        'source_package_id', (
          select layer.source_package_id
          from public.package_cost_layers layer
          where layer.id = v_allocation.cost_layer_id
        )
      )
    );

    if v_allocation.state = 'committed' then
      update public.package_cost_layer_day_components
      set quantity_remaining = quantity_remaining - v_units
      where id = v_component.id
        and quantity_remaining >= v_units;
      if not found then raise exception 'concurrent_day_slot_inventory_change'; end if;
    end if;

    if v_component.unit_cost_component is null then
      v_effective := null;
    elsif v_effective is not null then
      v_effective := v_effective
        + v_component.unit_cost_component * v_required.units_per_sale;
    end if;
    v_currency := coalesce(v_currency, v_component.currency);
    v_component_count := v_component_count + 1;
  end loop;

  if v_component_count = 0 then
    raise exception 'package_has_no_day_slots:%', v_allocation.package_id;
  end if;

  update public.inventory_allocations
  set effective_unit_cost_snapshot = case
        when v_effective is null then null else round(v_effective, 6)
      end,
      cost_currency_snapshot = v_currency,
      cost_snapshot_frozen_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_allocation.id;

  if v_allocation.state = 'committed' then
    perform public.inventory_recompute_layer_remaining(v_allocation.cost_layer_id);
  end if;
  return case when v_effective is null then null else round(v_effective, 6) end;
end;
$$;

create or replace function public.inventory_package_allocatable_quantity(
  p_package_id text
)
returns int
language sql
stable
set search_path = public
as $$
  select greatest(
    coalesce((
      select sum(public.inventory_layer_component_available_quantity(
        layer.id, p_package_id
      ))::int
      from public.package_cost_layers layer
      where public.inventory_layer_is_candidate(layer.id, p_package_id)
    ), 0)
    - public.inventory_package_manual_hold_quantity(p_package_id),
    0
  )::int;
$$;

-- Internal allocator accepts an optional exact candidate set. Public callers
-- retain the established inventory_allocate_quantity signature.
create or replace function public.inventory_allocate_quantity_from_layers(
  p_package_id text,
  p_quantity int,
  p_state text,
  p_source text,
  p_request_key text,
  p_allowed_layer_ids uuid[] default null,
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
  v_remaining int;
  v_available int;
  v_take int;
  v_layer record;
  v_existing int;
  v_now timestamptz := timezone('utc', now());
  v_allocation_id uuid;
  v_occ_id uuid;
  v_unit_cost numeric;
  v_currency text;
  v_preferred_supplier uuid;
begin
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('operations.manage')
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;
  if coalesce(p_quantity, 0) <= 0 then raise exception 'invalid_quantity'; end if;
  if p_state not in ('reserved', 'committed') then
    raise exception 'invalid_allocation_state';
  end if;
  if nullif(btrim(p_source), '') is null then raise exception 'source_required'; end if;
  if nullif(btrim(p_request_key), '') is null then
    raise exception 'request_key_required';
  end if;
  if not exists (select 1 from public.packages where id = p_package_id) then
    raise exception 'package_not_found:%', p_package_id;
  end if;

  select coalesce(sum(quantity), 0)::int into v_existing
  from public.inventory_allocations
  where request_key = btrim(p_request_key);
  if v_existing > 0 then
    if v_existing <> p_quantity then
      raise exception 'idempotency_quantity_mismatch';
    end if;
    return v_existing;
  end if;

  -- Lock package rows and every eligible component in globally stable order.
  perform 1
  from public.packages package
  where package.id = p_package_id
  for update;
  perform 1
  from public.package_cost_layers layer
  join public.package_cost_layer_day_components component
    on component.cost_layer_id = layer.id
  where public.inventory_layer_is_candidate(layer.id, p_package_id)
    and (p_allowed_layer_ids is null or layer.id = any(p_allowed_layer_ids))
  order by layer.id, component.day_slot
  for update of layer, component;

  select coalesce(sum(
    public.inventory_layer_component_available_quantity(layer.id, p_package_id)
  ), 0)::int
  into v_available
  from public.package_cost_layers layer
  where public.inventory_layer_is_candidate(layer.id, p_package_id)
    and (p_allowed_layer_ids is null or layer.id = any(p_allowed_layer_ids));

  v_available := greatest(
    v_available - public.inventory_package_manual_hold_quantity(p_package_id),
    0
  );
  if v_available < p_quantity then
    raise exception 'insufficient_purchased_day_capacity:%:%:%',
      p_package_id, p_quantity, v_available;
  end if;

  -- Keep a party with one supplier whenever that supplier's compatible layer
  -- pool can cover it. Exact-source and FIFO ordering remain deterministic.
  select coalesce(layer.supplier_id, purchase.supplier_id)
  into v_preferred_supplier
  from public.package_cost_layers layer
  left join public.purchase_orders purchase on purchase.id = layer.purchase_order_id
  where public.inventory_layer_is_candidate(layer.id, p_package_id)
    and (p_allowed_layer_ids is null or layer.id = any(p_allowed_layer_ids))
    and coalesce(layer.supplier_id, purchase.supplier_id) is not null
  group by coalesce(layer.supplier_id, purchase.supplier_id)
  having sum(public.inventory_layer_component_available_quantity(
    layer.id, p_package_id
  )) >= p_quantity
  order by
    min(layer.received_at),
    coalesce(layer.supplier_id, purchase.supplier_id)
  limit 1;

  v_remaining := p_quantity;
  for v_layer in
    select
      layer.*,
      public.inventory_layer_component_available_quantity(
        layer.id, p_package_id
      ) as allocatable,
      coalesce(layer.supplier_id, purchase.supplier_id) as effective_supplier_id,
      case when layer.source_package_id = p_package_id then 0
        when source.duration = '2_day' then 1
        when source.duration = '3_day' then 2
        else 3 end as source_rank
    from public.package_cost_layers layer
    join public.packages source on source.id = layer.source_package_id
    left join public.purchase_orders purchase on purchase.id = layer.purchase_order_id
    where public.inventory_layer_is_candidate(layer.id, p_package_id)
      and (p_allowed_layer_ids is null or layer.id = any(p_allowed_layer_ids))
    order by
      case when v_preferred_supplier is not null
        and coalesce(layer.supplier_id, purchase.supplier_id)
          = v_preferred_supplier then 0 else 1 end,
      source_rank,
      layer.received_at,
      layer.id
  loop
    exit when v_remaining = 0;
    v_take := least(v_layer.allocatable, v_remaining);
    if v_take <= 0 then continue; end if;

    insert into public.inventory_allocations (
      cost_layer_id, package_id, deal_id, deal_line_item_id,
      order_id, order_line_item_id, reservation_id,
      quantity, state, source, request_key, idempotency_key,
      reserved_at, committed_at, created_by, metadata
    ) values (
      v_layer.id, p_package_id, p_deal_id, p_deal_line_item_id,
      p_order_id, p_order_line_item_id, p_reservation_id,
      v_take, p_state, btrim(p_source), btrim(p_request_key),
      btrim(p_request_key) || ':layer:' || v_layer.id::text,
      case when p_state = 'reserved' then v_now else null end,
      case when p_state = 'committed' then v_now else null end,
      auth.uid(), coalesce(p_metadata, '{}'::jsonb)
        || jsonb_build_object('reason', nullif(btrim(p_reason), ''))
    )
    returning id into v_allocation_id;

    v_unit_cost := public.inventory_attach_allocation_day_components(
      v_allocation_id
    );

    if p_state = 'committed' and p_order_id is not null then
      select cost_currency_snapshot into v_currency
      from public.inventory_allocations where id = v_allocation_id;
      perform set_config('inventory.canonical_write', 'on', true);
      insert into public.order_cost_consumptions (
        order_id, cost_layer_id, package_id, quantity, unit_cost, currency,
        supplier_source_snapshot, fulfilment_block_snapshot
      )
      select
        p_order_id, layer.id, p_package_id, v_take, v_unit_cost,
        coalesce(v_currency, layer.currency, 'USD'),
        layer.source, block.name
      from public.package_cost_layers layer
      left join public.fulfilment_blocks block
        on block.id = layer.fulfilment_block_id
      where layer.id = v_layer.id
      returning id into v_occ_id;
      update public.inventory_allocations
      set order_cost_consumption_id = v_occ_id,
          updated_at = timezone('utc', now())
      where id = v_allocation_id;
      perform set_config('inventory.canonical_write', 'off', true);
    end if;
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining <> 0 then raise exception 'allocation_incomplete'; end if;
  return p_quantity;
end;
$$;

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
language sql
security definer
set search_path = public
as $$
  select public.inventory_allocate_quantity_from_layers(
    p_package_id, p_quantity, p_state, p_source, p_request_key, null,
    p_deal_id, p_deal_line_item_id, p_order_id, p_order_line_item_id,
    p_reservation_id, p_reason, p_metadata
  );
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
  v_component record;
  v_released int := 0;
begin
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('operations.manage')
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;
  if nullif(btrim(p_request_key), '') is null then
    raise exception 'request_key_required';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;

  perform 1
  from public.inventory_allocations allocation
  where allocation.request_key = btrim(p_request_key)
    and allocation.state <> 'released'
  order by allocation.cost_layer_id, allocation.id
  for update;

  perform 1
  from public.package_cost_layer_day_components component
  join public.inventory_allocation_day_components allocation_component
    on allocation_component.cost_layer_day_component_id = component.id
  join public.inventory_allocations allocation
    on allocation.id = allocation_component.allocation_id
  where allocation.request_key = btrim(p_request_key)
    and allocation.state <> 'released'
  order by component.cost_layer_id, component.day_slot
  for update of component;

  for v_allocation in
    select *
    from public.inventory_allocations allocation
    where allocation.request_key = btrim(p_request_key)
      and allocation.state <> 'released'
    order by allocation.cost_layer_id, allocation.id
  loop
    if v_allocation.lock_state = 'fulfilment_locked' then
      raise exception 'allocation_fulfilment_locked:%', v_allocation.id;
    end if;
    if v_allocation.state = 'committed'
      and not coalesce(p_allow_committed, false)
    then
      raise exception 'committed_release_requires_explicit_override';
    end if;

    if v_allocation.state = 'committed' then
      for v_component in
        select
          component.id,
          component.quantity_total,
          allocation_component.consumed_units
        from public.inventory_allocation_day_components allocation_component
        join public.package_cost_layer_day_components component
          on component.id = allocation_component.cost_layer_day_component_id
        where allocation_component.allocation_id = v_allocation.id
        order by component.day_slot
      loop
        update public.package_cost_layer_day_components
        set quantity_remaining = least(
          quantity_total,
          quantity_remaining + v_component.consumed_units
        )
        where id = v_component.id;
      end loop;
      perform public.inventory_recompute_layer_remaining(
        v_allocation.cost_layer_id
      );
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
  v_component record;
  v_order_id uuid;
  v_occ_id uuid;
  v_converted int := 0;
begin
  select line.order_id into v_order_id
  from public.order_line_items line
  where line.id = p_order_line_item_id;
  if not found then raise exception 'order_line_not_found'; end if;

  perform 1
  from public.inventory_allocations allocation
  where allocation.reservation_id = p_reservation_id
    and allocation.state = 'reserved'
  order by allocation.cost_layer_id, allocation.id
  for update;
  perform 1
  from public.package_cost_layer_day_components component
  join public.inventory_allocation_day_components allocation_component
    on allocation_component.cost_layer_day_component_id = component.id
  join public.inventory_allocations allocation
    on allocation.id = allocation_component.allocation_id
  where allocation.reservation_id = p_reservation_id
    and allocation.state = 'reserved'
  order by component.cost_layer_id, component.day_slot
  for update of component;

  for v_allocation in
    select *
    from public.inventory_allocations
    where reservation_id = p_reservation_id and state = 'reserved'
    order by cost_layer_id, id
  loop
    if v_allocation.lock_state = 'fulfilment_locked' then
      raise exception 'allocation_fulfilment_locked:%', v_allocation.id;
    end if;
    for v_component in
      select
        component.id,
        allocation_component.consumed_units
      from public.inventory_allocation_day_components allocation_component
      join public.package_cost_layer_day_components component
        on component.id = allocation_component.cost_layer_day_component_id
      where allocation_component.allocation_id = v_allocation.id
      order by component.day_slot
    loop
      update public.package_cost_layer_day_components
      set quantity_remaining = quantity_remaining - v_component.consumed_units
      where id = v_component.id
        and quantity_remaining >= v_component.consumed_units;
      if not found then raise exception 'concurrent_day_slot_inventory_change'; end if;
    end loop;
    perform public.inventory_recompute_layer_remaining(v_allocation.cost_layer_id);

    perform set_config('inventory.canonical_write', 'on', true);
    insert into public.order_cost_consumptions (
      order_id, cost_layer_id, package_id, quantity, unit_cost, currency,
      supplier_source_snapshot, fulfilment_block_snapshot
    )
    select
      v_order_id, layer.id, v_allocation.package_id, v_allocation.quantity,
      v_allocation.effective_unit_cost_snapshot,
      coalesce(v_allocation.cost_currency_snapshot, layer.currency, 'USD'),
      layer.source, block.name
    from public.package_cost_layers layer
    left join public.fulfilment_blocks block
      on block.id = layer.fulfilment_block_id
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

-- Legacy/native order entry keeps its RPC shape but now uses the same allocator.
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
  v_line_id uuid;
begin
  if coalesce(p_guests, 0) <= 0 then return; end if;
  select line.id into v_line_id
  from public.order_line_items line
  where line.order_id = p_order_id
    and line.package_id = p_order_package_id
  order by line.sort_order, line.id
  limit 1;
  perform public.inventory_allocate_quantity(
    p_order_package_id, p_guests, 'committed', 'allocate_order_cost_layers',
    'order:' || p_order_id::text || ':package:' || p_order_package_id,
    (select deal.id from public.deals deal where deal.order_id = p_order_id limit 1),
    (select line.deal_line_item_id from public.order_line_items line
      where line.id = v_line_id),
    p_order_id, v_line_id, null,
    'Order committed through day-slot allocator',
    jsonb_build_object('requested_currency', p_currency)
  );
end;
$$;

-- Compatibility OCC writes are projected through day components. The
-- quantity_remaining guard prevents legacy callers from applying a second
-- aggregate decrement after this trigger has updated component capacity.
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
  v_allocation_id uuid;
  v_request_key text;
  v_effective_unit_cost numeric;
  v_effective_currency text;
begin
  if not public.inventory_allocation_enforcement_enabled()
    or current_setting('inventory.canonical_write', true) = 'on'
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    select allocation.request_key into v_request_key
    from public.inventory_allocations allocation
    where allocation.order_cost_consumption_id = old.id
      and allocation.state <> 'released'
    limit 1;
    if v_request_key is not null then
      perform public.inventory_release_allocations(
        v_request_key,
        'Compatibility COGS row removed',
        true
      );
    end if;
    return old;
  end if;

  if new.cost_layer_id is null then
    raise exception 'insufficient_purchased_stock:%:%',
      new.package_id, new.quantity;
  end if;
  if not public.inventory_layer_is_candidate(new.cost_layer_id, new.package_id)
    or public.inventory_layer_component_available_quantity(
      new.cost_layer_id, new.package_id
    ) < new.quantity
  then
    raise exception 'insufficient_canonical_day_capacity:%:%',
      new.package_id, new.quantity;
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
    committed_at, metadata
  ) values (
    new.cost_layer_id, new.package_id, v_deal_id, v_deal_line_id,
    new.order_id, v_order_line_id, new.id,
    new.quantity, 'committed', 'order_cost_consumptions',
    'occ:' || new.id::text, 'occ:' || new.id::text,
    coalesce(new.created_at, timezone('utc', now())),
    jsonb_build_object('compatibility_projection', true)
  )
  returning id into v_allocation_id;
  v_effective_unit_cost :=
    public.inventory_attach_allocation_day_components(v_allocation_id);
  select allocation.cost_currency_snapshot
  into v_effective_currency
  from public.inventory_allocations allocation
  where allocation.id = v_allocation_id;

  -- Legacy order paths initially write the physical bundle cost. Replace it
  -- immediately with the frozen sold-day cost while canonical_write prevents
  -- the compatibility trigger from projecting a second allocation.
  perform set_config('inventory.canonical_write', 'on', true);
  update public.order_cost_consumptions
  set unit_cost = v_effective_unit_cost,
      currency = coalesce(v_effective_currency, currency)
  where id = new.id;
  perform set_config('inventory.canonical_write', 'off', true);
  return new;
end;
$$;

drop trigger if exists order_cost_consumptions_inventory_projection_trg
  on public.order_cost_consumptions;
create trigger order_cost_consumptions_inventory_projection_trg
after insert or delete on public.order_cost_consumptions
for each row execute function public.project_order_cost_consumption_allocation();

revoke all on function public.inventory_attach_allocation_day_components(uuid)
  from public;
revoke all on function public.inventory_allocate_quantity_from_layers(
  text, int, text, text, text, uuid[], uuid, uuid, uuid, uuid, uuid, text, jsonb
) from public;
grant execute on function public.inventory_attach_allocation_day_components(uuid)
  to service_role;
grant execute on function public.inventory_allocate_quantity_from_layers(
  text, int, text, text, text, uuid[], uuid, uuid, uuid, uuid, uuid, text, jsonb
) to service_role;

revoke all on function public.inventory_package_allocatable_quantity(text)
  from public;
grant execute on function public.inventory_package_allocatable_quantity(text)
  to authenticated, service_role;
revoke all on function public.inventory_allocate_quantity(
  text, int, text, text, text, uuid, uuid, uuid, uuid, uuid, text, jsonb
) from public;
grant execute on function public.inventory_allocate_quantity(
  text, int, text, text, text, uuid, uuid, uuid, uuid, uuid, text, jsonb
) to authenticated, service_role;
