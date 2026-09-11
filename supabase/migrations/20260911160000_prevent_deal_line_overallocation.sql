-- Signed native deals allocate at signing. Creating the native order then
-- called allocate_order_cost_layers again, and adding stock ran
-- _backfill_package_order_costs for any order whose allocations had no
-- order_id. Both paths committed a second full party onto the same deal line
-- (Madrid Club Suite showed 2× F1 and 2× Sport and Music for a 2-guest deal).
-- That trapped purchased stock, so later signed sales (Palo Alto 12) stayed
-- uncovered even when bought = sold.

create or replace function public.inventory_deal_line_live_quantity(
  p_deal_line_item_id uuid
)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(allocation.quantity), 0)::int
  from public.inventory_allocations allocation
  where allocation.deal_line_item_id = p_deal_line_item_id
    and allocation.state in ('reserved', 'committed');
$$;

create or replace function public.inventory_link_deal_line_allocations_to_order(
  p_deal_line_item_id uuid,
  p_order_id uuid,
  p_order_line_item_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allocation record;
  v_occ_id uuid;
  v_linked int := 0;
begin
  if p_deal_line_item_id is null or p_order_id is null then
    return 0;
  end if;

  update public.inventory_allocations
  set order_id = coalesce(order_id, p_order_id),
      order_line_item_id = coalesce(order_line_item_id, p_order_line_item_id),
      updated_at = timezone('utc', now())
  where deal_line_item_id = p_deal_line_item_id
    and state in ('reserved', 'committed')
    and (
      order_id is distinct from p_order_id
      or (
        p_order_line_item_id is not null
        and order_line_item_id is distinct from p_order_line_item_id
      )
    );

  for v_allocation in
    select
      allocation.id,
      allocation.cost_layer_id,
      allocation.package_id,
      allocation.quantity,
      allocation.effective_unit_cost_snapshot,
      allocation.cost_currency_snapshot
    from public.inventory_allocations allocation
    where allocation.deal_line_item_id = p_deal_line_item_id
      and allocation.state = 'committed'
      and allocation.order_cost_consumption_id is null
    order by allocation.created_at, allocation.id
  loop
    perform set_config('inventory.canonical_write', 'on', true);
    insert into public.order_cost_consumptions (
      order_id, cost_layer_id, package_id, quantity, unit_cost, currency,
      supplier_source_snapshot, fulfilment_block_snapshot
    )
    select
      p_order_id,
      layer.id,
      v_allocation.package_id,
      v_allocation.quantity,
      coalesce(v_allocation.effective_unit_cost_snapshot, layer.unit_cost),
      coalesce(v_allocation.cost_currency_snapshot, layer.currency, 'USD'),
      layer.source,
      block.name
    from public.package_cost_layers layer
    left join public.fulfilment_blocks block
      on block.id = layer.fulfilment_block_id
    where layer.id = v_allocation.cost_layer_id
    returning id into v_occ_id;
    perform set_config('inventory.canonical_write', 'off', true);
    if v_occ_id is not null then
      update public.inventory_allocations
      set order_cost_consumption_id = v_occ_id,
          order_id = coalesce(order_id, p_order_id),
          order_line_item_id = coalesce(order_line_item_id, p_order_line_item_id),
          updated_at = timezone('utc', now())
      where id = v_allocation.id;
      v_linked := v_linked + v_allocation.quantity;
    end if;
    v_occ_id := null;
  end loop;

  return v_linked;
end;
$$;

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
  v_line_qty int := 0;
  v_line_live int := 0;
  v_order_live int := 0;
  v_needed int;
  v_now timestamptz := timezone('utc', now());
  v_allocation_id uuid;
  v_occ_id uuid;
  v_unit_cost numeric;
  v_currency text;
  v_preferred_key text;
begin
  if not public.inventory_caller_may_mutate() then
    raise exception 'forbidden';
  end if;
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
  where request_key = btrim(p_request_key)
    and state in ('reserved', 'committed');
  if v_existing > 0 then
    if v_existing > p_quantity then
      raise exception 'idempotency_quantity_mismatch';
    end if;
    perform public.inventory_link_deal_line_allocations_to_order(
      p_deal_line_item_id, p_order_id, p_order_line_item_id
    );
    return v_existing;
  end if;

  v_needed := p_quantity;
  if p_deal_line_item_id is not null then
    perform 1
    from public.deal_line_items line
    where line.id = p_deal_line_item_id
    for update;
    select line.quantity into v_line_qty
    from public.deal_line_items line
    where line.id = p_deal_line_item_id;
    if found then
      v_line_live := public.inventory_deal_line_live_quantity(p_deal_line_item_id);
      if v_line_live >= v_line_qty then
        perform public.inventory_link_deal_line_allocations_to_order(
          p_deal_line_item_id, p_order_id, p_order_line_item_id
        );
        return 0;
      end if;
      v_needed := least(v_needed, v_line_qty - v_line_live);
    end if;
  elsif p_deal_id is not null then
    select coalesce(sum(allocation.quantity), 0)::int
    into v_line_live
    from public.inventory_allocations allocation
    where allocation.deal_id = p_deal_id
      and allocation.package_id = p_package_id
      and allocation.state in ('reserved', 'committed');
    if v_line_live >= p_quantity then
      return 0;
    end if;
    v_needed := least(v_needed, p_quantity - v_line_live);
  end if;

  if p_order_id is not null then
    select coalesce(sum(allocation.quantity), 0)::int
    into v_order_live
    from public.inventory_allocations allocation
    where allocation.order_id = p_order_id
      and allocation.package_id = p_package_id
      and allocation.state in ('reserved', 'committed');
    if v_order_live >= p_quantity then
      perform public.inventory_link_deal_line_allocations_to_order(
        p_deal_line_item_id, p_order_id, p_order_line_item_id
      );
      return 0;
    end if;
    v_needed := least(v_needed, p_quantity - v_order_live);
  end if;

  if v_needed <= 0 then
    perform public.inventory_link_deal_line_allocations_to_order(
      p_deal_line_item_id, p_order_id, p_order_line_item_id
    );
    return 0;
  end if;

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
  if v_available < v_needed then
    raise exception 'insufficient_purchased_day_capacity:%:%:%',
      p_package_id, v_needed, v_available;
  end if;

  select public.inventory_layer_supplier_key(
    layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
  )
  into v_preferred_key
  from public.package_cost_layers layer
  left join public.purchase_orders purchase on purchase.id = layer.purchase_order_id
  where public.inventory_layer_is_candidate(layer.id, p_package_id)
    and (p_allowed_layer_ids is null or layer.id = any(p_allowed_layer_ids))
  group by 1
  having sum(public.inventory_layer_component_available_quantity(
    layer.id, p_package_id
  )) >= v_needed
  order by
    sum(public.inventory_layer_component_available_quantity(
      layer.id, p_package_id
    )) asc,
    min(layer.received_at),
    1
  limit 1;

  v_remaining := v_needed;
  for v_layer in
    select
      layer.*,
      public.inventory_layer_component_available_quantity(
        layer.id, p_package_id
      ) as allocatable,
      public.inventory_layer_supplier_key(
        layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
      ) as supplier_key,
      coalesce((
        select sum(public.inventory_layer_component_available_quantity(
          pool.id, p_package_id
        ))::int
        from public.package_cost_layers pool
        left join public.purchase_orders pool_purchase
          on pool_purchase.id = pool.purchase_order_id
        where public.inventory_layer_is_candidate(pool.id, p_package_id)
          and (p_allowed_layer_ids is null or pool.id = any(p_allowed_layer_ids))
          and public.inventory_layer_supplier_key(
            pool.supplier_id, pool_purchase.supplier_id,
            pool_purchase.supplier, pool.source
          ) = public.inventory_layer_supplier_key(
            layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
          )
      ), 0) as pool_qty,
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
      case when v_preferred_key is not null
        and public.inventory_layer_supplier_key(
          layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
        ) = v_preferred_key then 0 else 1 end,
      case when v_preferred_key is null then -coalesce((
        select sum(public.inventory_layer_component_available_quantity(
          pool.id, p_package_id
        ))::int
        from public.package_cost_layers pool
        left join public.purchase_orders pool_purchase
          on pool_purchase.id = pool.purchase_order_id
        where public.inventory_layer_is_candidate(pool.id, p_package_id)
          and (p_allowed_layer_ids is null or pool.id = any(p_allowed_layer_ids))
          and public.inventory_layer_supplier_key(
            pool.supplier_id, pool_purchase.supplier_id,
            pool_purchase.supplier, pool.source
          ) = public.inventory_layer_supplier_key(
            layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
          )
      ), 0) else 0 end,
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
      btrim(p_request_key) || ':layer:' || v_layer.id::text
        || ':' || gen_random_uuid()::text,
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
  return v_needed;
end;
$$;

create or replace function public.inventory_allocate_deal_line_remainder(
  p_deal_line_item_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.deal_line_items%rowtype;
  v_deal public.deals%rowtype;
  v_needed int;
  v_order_line_id uuid;
  v_allocated int := 0;
begin
  if p_deal_line_item_id is null then return 0; end if;
  if not public.inventory_caller_may_mutate()
    and session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;

  select * into v_line from public.deal_line_items
  where id = p_deal_line_item_id for update;
  if not found then return 0; end if;
  select * into v_deal from public.deals where id = v_line.deal_id for update;
  if not found then return 0; end if;
  if not public.deal_stage_holds_purchased_stock(v_deal.stage)
    or coalesce(v_line.sourcing_mode, 'owned') <> 'owned'
  then
    perform public.inventory_sync_deal_line_shortage(v_line.id);
    return 0;
  end if;

  v_needed := v_line.quantity
    - public.inventory_deal_line_live_quantity(v_line.id);
  if v_needed <= 0 then
    perform public.inventory_sync_deal_line_shortage(v_line.id);
    return 0;
  end if;

  select line.id into v_order_line_id
  from public.order_line_items line
  where line.deal_line_item_id = v_line.id
  order by line.sort_order, line.id
  limit 1;

  begin
    v_allocated := public.inventory_allocate_quantity_from_layers(
      v_line.package_id, v_needed, 'committed',
      'deal_line_remainder',
      'deal-line-remainder:' || v_line.id::text || ':' || gen_random_uuid()::text,
      null, v_line.deal_id, v_line.id, v_deal.order_id, v_order_line_id, null,
      'Fill uncovered signed deal quantity without releasing existing stock',
      jsonb_build_object('automatic', true)
    );
  exception
    when others then
      if sqlerrm like 'insufficient_purchased_stock%'
        or sqlerrm like 'insufficient_purchased_day_capacity%'
        or sqlerrm like 'insufficient_canonical%'
      then
        v_allocated := 0;
      else
        raise;
      end if;
  end;

  perform public.inventory_sync_deal_line_shortage(v_line.id);
  return coalesce(v_allocated, 0);
end;
$$;

create or replace function public.inventory_trim_deal_line_overallocation(
  p_deal_line_item_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.deal_line_items%rowtype;
  v_deal public.deals%rowtype;
  v_live int;
  v_keep_key text;
  v_kept int := 0;
  v_released int := 0;
  v_keep_ids uuid[] := '{}';
  v_allocation record;
  v_order_line_id uuid;
begin
  if p_deal_line_item_id is null then return 0; end if;
  if not public.inventory_caller_may_mutate()
    and session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;

  select * into v_line from public.deal_line_items
  where id = p_deal_line_item_id for update;
  if not found then return 0; end if;
  select * into v_deal from public.deals where id = v_line.deal_id for update;
  if not found then return 0; end if;

  v_live := public.inventory_deal_line_live_quantity(v_line.id);
  if v_live <= v_line.quantity then return 0; end if;

  perform 1
  from public.package_cost_layers layer
  where layer.id in (
    select allocation.cost_layer_id
    from public.inventory_allocations allocation
    where allocation.deal_line_item_id = v_line.id
      and allocation.state <> 'released'
  )
  order by layer.id
  for update;

  select supplier_key into v_keep_key
  from (
    select
      public.inventory_layer_supplier_key(
        layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
      ) as supplier_key,
      sum(allocation.quantity)::int as quantity,
      bool_or(allocation.source in (
        'deal_line_supplier_pool_reassignment',
        'deal_line_supplier_reassignment'
      )) as staff_assigned,
      min(allocation.created_at) as first_at
    from public.inventory_allocations allocation
    join public.package_cost_layers layer on layer.id = allocation.cost_layer_id
    left join public.purchase_orders purchase
      on purchase.id = layer.purchase_order_id
    where allocation.deal_line_item_id = v_line.id
      and allocation.state in ('reserved', 'committed')
    group by 1
  ) grouped
  where grouped.quantity >= v_line.quantity
  order by
    case when grouped.staff_assigned then 0 else 1 end,
    abs(grouped.quantity - v_line.quantity),
    grouped.first_at
  limit 1;

  if v_keep_key is not null then
    for v_allocation in
      select allocation.id, allocation.quantity
      from public.inventory_allocations allocation
      join public.package_cost_layers layer on layer.id = allocation.cost_layer_id
      left join public.purchase_orders purchase
        on purchase.id = layer.purchase_order_id
      where allocation.deal_line_item_id = v_line.id
        and allocation.state in ('reserved', 'committed')
        and public.inventory_layer_supplier_key(
          layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
        ) = v_keep_key
      order by
        case when allocation.source in (
          'deal_line_supplier_pool_reassignment',
          'deal_line_supplier_reassignment'
        ) then 0 else 1 end,
        allocation.created_at,
        allocation.id
    loop
      exit when v_kept >= v_line.quantity;
      continue when v_allocation.quantity > (v_line.quantity - v_kept);
      v_keep_ids := array_append(v_keep_ids, v_allocation.id);
      v_kept := v_kept + v_allocation.quantity;
    end loop;
  end if;

  if v_kept < v_line.quantity then
    for v_allocation in
      select allocation.id, allocation.quantity
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id = v_line.id
        and allocation.state in ('reserved', 'committed')
        and not (allocation.id = any(v_keep_ids))
      order by allocation.created_at, allocation.id
    loop
      exit when v_kept >= v_line.quantity;
      continue when v_allocation.quantity > (v_line.quantity - v_kept);
      v_keep_ids := array_append(v_keep_ids, v_allocation.id);
      v_kept := v_kept + v_allocation.quantity;
    end loop;
  end if;

  for v_allocation in
    select allocation.request_key
    from public.inventory_allocations allocation
    where allocation.deal_line_item_id = v_line.id
      and allocation.state in ('reserved', 'committed')
    group by allocation.request_key
    having not bool_or(allocation.id = any(v_keep_ids))
    order by allocation.request_key
  loop
    v_released := v_released + public.inventory_release_allocations(
      v_allocation.request_key,
      'Trim deal line allocated above sold quantity',
      true
    );
  end loop;

  if public.inventory_deal_line_live_quantity(v_line.id) > v_line.quantity then
    for v_allocation in
      select distinct allocation.request_key
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id = v_line.id
        and allocation.state in ('reserved', 'committed')
      order by allocation.request_key
    loop
      v_released := v_released + public.inventory_release_allocations(
        v_allocation.request_key,
        'Trim deal line allocated above sold quantity',
        true
      );
    end loop;
    perform public.inventory_allocate_deal_line_remainder(v_line.id);
  end if;

  select line.id into v_order_line_id
  from public.order_line_items line
  where line.deal_line_item_id = v_line.id
  order by line.sort_order, line.id
  limit 1;
  perform public.inventory_link_deal_line_allocations_to_order(
    v_line.id, v_deal.order_id, v_order_line_id
  );
  perform public.inventory_sync_deal_line_shortage(v_line.id);
  return v_released;
end;
$$;

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
  v_deal_line_id uuid;
  v_deal_id uuid;
  v_channel text;
  v_live int := 0;
begin
  if coalesce(p_guests, 0) <= 0 then return; end if;
  perform set_config('inventory.trusted_commit', 'on', true);
  select line.id, line.deal_line_item_id into v_line_id, v_deal_line_id
  from public.order_line_items line
  where line.order_id = p_order_id
    and line.package_id = p_order_package_id
  order by line.sort_order, line.id
  limit 1;
  select deal.id into v_deal_id
  from public.deals deal
  where deal.order_id = p_order_id
  limit 1;
  if v_deal_line_id is not null then
    v_live := public.inventory_deal_line_live_quantity(v_deal_line_id);
    if v_live >= p_guests then
      perform public.inventory_link_deal_line_allocations_to_order(
        v_deal_line_id, p_order_id, v_line_id
      );
      perform set_config('inventory.trusted_commit', 'off', true);
      return;
    end if;
  end if;
  begin
    perform public.inventory_allocate_quantity(
      p_order_package_id, p_guests, 'committed', 'allocate_order_cost_layers',
      'order:' || p_order_id::text || ':package:' || p_order_package_id,
      coalesce(
        v_deal_id,
        (select deal.id from public.deals deal where deal.order_id = p_order_id limit 1)
      ),
      v_deal_line_id,
      p_order_id, v_line_id, null,
      'Order committed through day-slot allocator',
      jsonb_build_object('requested_currency', p_currency)
    );
  exception
    when others then
      if sqlerrm like 'insufficient_purchased_stock%'
        or sqlerrm like 'insufficient_purchased_day_capacity%'
        or sqlerrm like 'insufficient_canonical%'
      then
        select order_row.channel into v_channel
        from public.orders order_row
        where order_row.id = p_order_id;
        if v_channel = 'native_deal' and v_deal_line_id is not null then
          perform public.inventory_sync_deal_line_shortage(v_deal_line_id);
        else
          raise;
        end if;
      else
        raise;
      end if;
  end;
  perform set_config('inventory.trusted_commit', 'off', true);
end;
$$;

create or replace function public._backfill_package_order_costs(
  p_package_id text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_available int;
  v_allocate int;
  v_shortage int;
  v_count int := 0;
  v_deal_line_id uuid;
  v_line_live int := 0;
begin
  if not exists (
    select 1 from public.packages package where package.id = p_package_id
  ) then
    raise exception 'package_not_found';
  end if;

  for v_order in
    with line_orders as (
      select
        orders.id as order_id,
        orders.deal_id,
        line.package_id,
        sum(line.quantity)::int as quantity,
        (array_agg(line.id order by line.sort_order, line.id))[1]
          as order_line_item_id,
        (array_agg(line.deal_line_item_id order by line.sort_order, line.id))[1]
          as deal_line_item_id
      from public.orders orders
      join public.order_line_items line on line.order_id = orders.id
      where orders.status <> 'cancelled'
        and line.package_id = p_package_id
        and coalesce(line.sourcing_mode, 'owned') = 'owned'
      group by orders.id, orders.deal_id, line.package_id
    ),
    legacy_orders as (
      select
        orders.id as order_id,
        orders.deal_id,
        orders.package_id,
        orders.guests::int as quantity,
        null::uuid as order_line_item_id,
        null::uuid as deal_line_item_id
      from public.orders orders
      where orders.status <> 'cancelled'
        and orders.package_id = p_package_id
        and not exists (
          select 1 from public.order_line_items line
          where line.order_id = orders.id
        )
    )
    select candidate.*
    from (
      select * from line_orders
      union all
      select * from legacy_orders
    ) candidate
    where not exists (
      select 1
      from public.inventory_allocations allocation
      where allocation.order_id = candidate.order_id
        and allocation.package_id = candidate.package_id
        and allocation.state <> 'released'
    )
      and not exists (
        select 1
        from public.order_cost_consumptions consumption
        where consumption.order_id = candidate.order_id
          and consumption.package_id = candidate.package_id
      )
    order by candidate.order_id
  loop
    v_deal_line_id := v_order.deal_line_item_id;
    if v_deal_line_id is null and v_order.deal_id is not null then
      select line.id into v_deal_line_id
      from public.deal_line_items line
      where line.deal_id = v_order.deal_id
        and line.package_id = v_order.package_id
      order by line.sort_order, line.id
      limit 1;
    end if;

    if v_deal_line_id is not null then
      v_line_live := public.inventory_deal_line_live_quantity(v_deal_line_id);
      if v_line_live >= v_order.quantity then
        perform public.inventory_link_deal_line_allocations_to_order(
          v_deal_line_id, v_order.order_id, v_order.order_line_item_id
        );
        v_count := v_count + 1;
        continue;
      end if;
    end if;

    v_available :=
      public.inventory_package_allocatable_quantity(v_order.package_id);
    v_allocate := least(
      v_order.quantity - coalesce(v_line_live, 0),
      v_available
    );
    v_shortage := v_order.quantity
      - coalesce(v_line_live, 0)
      - greatest(v_allocate, 0);

    if v_allocate > 0 then
      perform public.inventory_allocate_quantity(
        v_order.package_id,
        v_allocate,
        'committed',
        'admin_backfill_package_order_costs',
        'order-cost-backfill:' || v_order.order_id::text
          || ':' || v_order.package_id,
        v_order.deal_id,
        v_deal_line_id,
        v_order.order_id,
        v_order.order_line_item_id,
        null,
        'Backfilled missing order COGS through day components',
        jsonb_build_object('historical_order_backfill', true)
      );
    end if;

    if v_shortage > 0 then
      insert into public.inventory_shortages (
        package_id,
        deal_id,
        order_id,
        order_line_item_id,
        shortage_type,
        quantity,
        status,
        source,
        idempotency_key,
        note,
        created_by,
        metadata
      ) values (
        v_order.package_id,
        v_order.deal_id,
        v_order.order_id,
        v_order.order_line_item_id,
        'historical_reconciliation',
        v_shortage,
        'open',
        'admin_backfill_package_order_costs',
        'order-cost-backfill-shortage:' || v_order.order_id::text
          || ':' || v_order.package_id,
        'Historical order did not have enough purchased day capacity',
        auth.uid(),
        jsonb_build_object(
          'requested_quantity', v_order.quantity,
          'allocated_quantity', coalesce(v_line_live, 0) + greatest(v_allocate, 0),
          'historical_order_backfill', true
        )
      )
      on conflict (idempotency_key) do nothing;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.sync_deal_inventory_after_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_old_holds boolean;
  v_new_holds boolean;
  v_allocated int;
begin
  v_old_holds := public.deal_stage_holds_purchased_stock(old.stage);
  v_new_holds := public.deal_stage_holds_purchased_stock(new.stage);

  if not v_old_holds and not v_new_holds then
    return new;
  end if;

  for v_line in
    select line.id, line.quantity, coalesce(line.sourcing_mode, 'owned') as sourcing_mode
    from public.deal_line_items line
    where line.deal_id = new.id
    order by line.sort_order, line.id
  loop
    if v_old_holds and v_new_holds then
      if v_line.sourcing_mode <> 'owned' then
        perform public.inventory_sync_deal_line_shortage(v_line.id);
        continue;
      end if;
      select coalesce(sum(allocation.quantity), 0)::int
      into v_allocated
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id = v_line.id
        and allocation.state in ('reserved', 'committed');
      if v_allocated > v_line.quantity then
        perform public.inventory_trim_deal_line_overallocation(v_line.id);
        v_allocated := public.inventory_deal_line_live_quantity(v_line.id);
      end if;
      if v_allocated >= v_line.quantity then
        perform public.inventory_sync_deal_line_shortage(v_line.id);
        continue;
      end if;
      begin
        perform public.inventory_allocate_deal_line_remainder(v_line.id);
      exception
        when others then
          perform public.inventory_sync_deal_line_shortage(v_line.id);
          raise notice 'Could not allocate deal line % after stage %: %',
            v_line.id, new.stage, sqlerrm;
      end;
    elsif v_new_holds then
      begin
        perform public.inventory_reassign_deal_line(v_line.id, null);
      exception
        when others then
          perform public.inventory_sync_deal_line_shortage(v_line.id);
          raise notice 'Could not allocate deal line % after stage %: %',
            v_line.id, new.stage, sqlerrm;
      end;
    else
      perform public.inventory_reassign_deal_line(v_line.id, null);
    end if;
  end loop;

  return new;
end;
$$;

create or replace function public.inventory_assert_deal_line_not_overallocated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line_qty int;
  v_live int;
begin
  if new.deal_line_item_id is null then return new; end if;
  if new.state not in ('reserved', 'committed') then return new; end if;
  select line.quantity into v_line_qty
  from public.deal_line_items line
  where line.id = new.deal_line_item_id;
  if not found then return new; end if;
  v_live := public.inventory_deal_line_live_quantity(new.deal_line_item_id);
  if v_live > v_line_qty then
    raise exception 'deal_line_overallocated:%:%:%',
      new.deal_line_item_id, v_live, v_line_qty;
  end if;
  return new;
end;
$$;

revoke all on function public.inventory_deal_line_live_quantity(uuid) from public;
grant execute on function public.inventory_deal_line_live_quantity(uuid)
  to authenticated, service_role;
revoke all on function public.inventory_link_deal_line_allocations_to_order(uuid, uuid, uuid)
  from public;
grant execute on function public.inventory_link_deal_line_allocations_to_order(uuid, uuid, uuid)
  to service_role;
revoke all on function public.inventory_allocate_deal_line_remainder(uuid) from public;
grant execute on function public.inventory_allocate_deal_line_remainder(uuid)
  to authenticated, service_role;
revoke all on function public.inventory_trim_deal_line_overallocation(uuid) from public;
grant execute on function public.inventory_trim_deal_line_overallocation(uuid)
  to authenticated, service_role;
revoke all on function public.allocate_order_cost_layers(uuid, text, int, text)
  from public;
revoke all on function public.allocate_order_cost_layers(uuid, text, int, text)
  from authenticated;
grant execute on function public.allocate_order_cost_layers(uuid, text, int, text)
  to service_role;
revoke all on function public.inventory_allocate_quantity_from_layers(
  text, int, text, text, text, uuid[], uuid, uuid, uuid, uuid, uuid, text, jsonb
) from public;
grant execute on function public.inventory_allocate_quantity_from_layers(
  text, int, text, text, text, uuid[], uuid, uuid, uuid, uuid, uuid, text, jsonb
) to service_role;
revoke all on function public._backfill_package_order_costs(text) from public;

do $$
declare
  v_line record;
  v_package text;
begin
  for v_line in
    select line.id
    from public.deal_line_items line
    join public.deals deal on deal.id = line.deal_id
    where public.inventory_deal_line_live_quantity(line.id) > line.quantity
    order by line.id
  loop
    begin
      perform public.inventory_trim_deal_line_overallocation(v_line.id);
    exception
      when others then
        raise notice 'Could not trim over-allocated deal line %: %',
          v_line.id, sqlerrm;
    end;
  end loop;

  for v_line in
    select line.id, line.package_id
    from public.deal_line_items line
    join public.deals deal on deal.id = line.deal_id
    where public.deal_stage_holds_purchased_stock(deal.stage)
      and deal.stage not in ('closed_lost', 'cancelled')
      and coalesce(line.sourcing_mode, 'owned') = 'owned'
      and public.inventory_deal_line_live_quantity(line.id) < line.quantity
    order by deal.created_at, line.sort_order, line.id
  loop
    begin
      perform public.inventory_allocate_deal_line_remainder(v_line.id);
    exception
      when others then
        raise notice 'Could not fill remainder for deal line %: %',
          v_line.id, sqlerrm;
    end;
  end loop;

  for v_package in
    select distinct shortage.package_id
    from public.inventory_shortages shortage
    where shortage.shortage_type = 'historical_reconciliation'
      and shortage.status = 'open'
    order by 1
  loop
    perform public.inventory_cover_historical_shortages(
      v_package,
      'migration:20260911160000:' || v_package
    );
  end loop;
end;
$$;

drop trigger if exists inventory_allocations_no_deal_line_overalloc_trg
  on public.inventory_allocations;
create trigger inventory_allocations_no_deal_line_overalloc_trg
after insert or update of quantity, state, deal_line_item_id
on public.inventory_allocations
for each row execute function public.inventory_assert_deal_line_not_overallocated();

comment on function public.inventory_allocate_deal_line_remainder(uuid) is
  'Allocate only the uncovered remainder of a signed deal line; never release stock already covering it.';
comment on function public.inventory_trim_deal_line_overallocation(uuid) is
  'Release extra committed/reserved units when a deal line holds more stock than it sold.';
