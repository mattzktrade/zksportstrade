-- Keep signed deal parties on one supplier whenever purchased stock allows it.
-- Automatic allocation reshuffles other mutable assignments on the same package
-- before splitting, and leftover splits consume the fewest supplier pools.

create or replace function public.inventory_layer_supplier_key(
  p_layer_supplier_id uuid,
  p_purchase_supplier_id uuid,
  p_purchase_supplier text,
  p_layer_source text
)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select case
    when public.inventory_layer_effective_supplier_id(
      p_layer_supplier_id, p_purchase_supplier_id
    ) is not null then
      'id:' || public.inventory_layer_effective_supplier_id(
        p_layer_supplier_id, p_purchase_supplier_id
      )::text
    when nullif(btrim(coalesce(p_purchase_supplier, p_layer_source, '')), '') is not null then
      'name:' || lower(btrim(coalesce(p_purchase_supplier, p_layer_source)))
    else 'unassigned'
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
  v_now timestamptz := timezone('utc', now());
  v_allocation_id uuid;
  v_occ_id uuid;
  v_unit_cost numeric;
  v_currency text;
  v_preferred_key text;
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

  -- Best-fit: the smallest supplier pool that can still cover the whole party.
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
  )) >= p_quantity
  order by
    sum(public.inventory_layer_component_available_quantity(
      layer.id, p_package_id
    )) asc,
    min(layer.received_at),
    1
  limit 1;

  v_remaining := p_quantity;
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

create or replace function public.inventory_search_single_supplier_pack(p_depth int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_idx int;
  v_qty int;
  v_input_index int;
  v_party_n int;
  v_remaining_parties int;
  v_supplier_key text;
  v_assigned_count int;
  v_newest_score int;
  v_nodes int;
  v_limit int;
  v_prefer text[];
begin
  select nodes, node_limit, party_n, assigned_count, newest_score
  into v_nodes, v_limit, v_party_n, v_assigned_count, v_newest_score
  from _inv_pack_state;
  if not found or v_nodes > v_limit then return; end if;
  update _inv_pack_state set nodes = nodes + 1;

  v_remaining_parties := v_party_n - p_depth;
  if v_assigned_count + v_remaining_parties < (
    select best_assigned from _inv_pack_state
  ) then return; end if;

  if p_depth = v_party_n then
    if v_assigned_count > (select best_assigned from _inv_pack_state)
      or (
        v_assigned_count = (select best_assigned from _inv_pack_state)
        and v_newest_score > (select best_newest from _inv_pack_state)
      )
    then
      update _inv_pack_state
      set best_assigned = v_assigned_count, best_newest = v_newest_score;
      delete from _inv_pack_best_assign;
      insert into _inv_pack_best_assign(idx, supplier_key)
      select idx, assigned_key from _inv_pack_assign;
    end if;
    return;
  end if;

  select party_idx into v_idx from _inv_pack_order where seq = p_depth;
  if v_idx is null then return; end if;
  select quantity, input_index, prefer_keys
  into v_qty, v_input_index, v_prefer
  from _inv_pack_parties
  where idx = v_idx;

  if coalesce(v_qty, 0) <= 0 then
    update _inv_pack_assign set assigned_key = null where idx = v_idx;
    update _inv_pack_state
    set assigned_count = assigned_count + 1,
        newest_score = newest_score + v_input_index + 1;
    perform public.inventory_search_single_supplier_pack(p_depth + 1);
    update _inv_pack_state
    set assigned_count = assigned_count - 1,
        newest_score = newest_score - v_input_index - 1;
    return;
  end if;

  for v_supplier_key in
    select supplier.supplier_key
    from _inv_pack_suppliers supplier
    where supplier.remaining >= v_qty
    order by
      case when v_prefer is not null and supplier.supplier_key = any(v_prefer)
        then 0 else 1 end,
      supplier.remaining,
      supplier.supplier_key
  loop
    update _inv_pack_suppliers
    set remaining = remaining - v_qty
    where supplier_key = v_supplier_key;
    update _inv_pack_assign
    set assigned_key = v_supplier_key
    where idx = v_idx;
    update _inv_pack_state
    set assigned_count = assigned_count + 1,
        newest_score = newest_score + v_input_index + 1;
    perform public.inventory_search_single_supplier_pack(p_depth + 1);
    update _inv_pack_state
    set assigned_count = assigned_count - 1,
        newest_score = newest_score - v_input_index - 1;
    update _inv_pack_assign set assigned_key = null where idx = v_idx;
    update _inv_pack_suppliers
    set remaining = remaining + v_qty
    where supplier_key = v_supplier_key;
    if (select best_assigned from _inv_pack_state) = v_party_n then
      return;
    end if;
  end loop;

  if v_assigned_count + v_remaining_parties - 1
    >= (select best_assigned from _inv_pack_state)
  then
    update _inv_pack_assign set assigned_key = null where idx = v_idx;
    perform public.inventory_search_single_supplier_pack(p_depth + 1);
  end if;
end;
$$;

create or replace function public.inventory_repack_mutable_deal_allocations(
  p_package_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party record;
  v_request record;
  v_allowed uuid[];
  v_demand int := 0;
  v_capacity int := 0;
  v_party_n int := 0;
  v_unsplit int := 0;
  v_best_assigned int := 0;
  v_max_suppliers int := 0;
  v_supplier_key text;
begin
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;
  if current_setting('inventory.repacking', true) = 'on' then
    return;
  end if;
  if nullif(btrim(p_package_id), '') is null then
    raise exception 'package_id_required';
  end if;

  perform set_config('inventory.repacking', 'on', true);

  perform 1 from public.packages package
  where package.id = p_package_id
  for update;
  perform 1
  from public.deal_line_items line
  join public.deals deal on deal.id = line.deal_id
  where line.package_id = p_package_id
    and coalesce(line.sourcing_mode, 'owned') = 'owned'
    and public.deal_stage_holds_purchased_stock(deal.stage)
  order by line.id
  for update of line;
  perform 1
  from public.package_cost_layers layer
  where public.inventory_layer_is_candidate(layer.id, p_package_id)
  order by layer.id
  for update;

  drop table if exists _inv_pack_state;
  drop table if exists _inv_pack_suppliers;
  drop table if exists _inv_pack_parties;
  drop table if exists _inv_pack_order;
  drop table if exists _inv_pack_assign;
  drop table if exists _inv_pack_best_assign;
  create temp table _inv_pack_state (
    nodes int not null,
    node_limit int not null,
    party_n int not null,
    assigned_count int not null,
    newest_score int not null,
    best_assigned int not null,
    best_newest int not null
  ) on commit drop;
  create temp table _inv_pack_suppliers (
    supplier_key text primary key,
    remaining int not null
  ) on commit drop;
  create temp table _inv_pack_parties (
    idx int primary key,
    party_id uuid not null,
    deal_id uuid not null,
    quantity int not null,
    input_index int not null,
    prefer_keys text[] not null,
    fully_allocated boolean not null,
    current_supplier_count int not null
  ) on commit drop;
  create temp table _inv_pack_order (
    seq int primary key,
    party_idx int not null
  ) on commit drop;
  create temp table _inv_pack_assign (
    idx int primary key,
    assigned_key text
  ) on commit drop;
  create temp table _inv_pack_best_assign (
    idx int primary key,
    supplier_key text
  ) on commit drop;

  insert into _inv_pack_suppliers(supplier_key, remaining)
  select
    public.inventory_layer_supplier_key(
      layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
    ),
    sum(
      public.inventory_layer_component_available_quantity(layer.id, p_package_id)
      + coalesce((
        select sum(allocation.quantity)::int
        from public.inventory_allocations allocation
        join public.deal_line_items line on line.id = allocation.deal_line_item_id
        join public.deals deal on deal.id = line.deal_id
        where allocation.cost_layer_id = layer.id
          and allocation.package_id = p_package_id
          and allocation.state in ('reserved', 'committed')
          and allocation.lock_state = 'mutable'
          and coalesce(line.sourcing_mode, 'owned') = 'owned'
          and public.deal_stage_holds_purchased_stock(deal.stage)
          and not exists (
            select 1
            from public.inventory_allocations locked
            where locked.deal_line_item_id = line.id
              and locked.state in ('reserved', 'committed')
              and locked.lock_state = 'fulfilment_locked'
          )
      ), 0)
    )::int
  from public.package_cost_layers layer
  left join public.purchase_orders purchase on purchase.id = layer.purchase_order_id
  where public.inventory_layer_is_candidate(layer.id, p_package_id)
  group by 1
  having sum(
    public.inventory_layer_component_available_quantity(layer.id, p_package_id)
    + coalesce((
      select sum(allocation.quantity)::int
      from public.inventory_allocations allocation
      join public.deal_line_items line on line.id = allocation.deal_line_item_id
      join public.deals deal on deal.id = line.deal_id
      where allocation.cost_layer_id = layer.id
        and allocation.package_id = p_package_id
        and allocation.state in ('reserved', 'committed')
        and allocation.lock_state = 'mutable'
        and coalesce(line.sourcing_mode, 'owned') = 'owned'
        and public.deal_stage_holds_purchased_stock(deal.stage)
        and not exists (
          select 1
          from public.inventory_allocations locked
          where locked.deal_line_item_id = line.id
            and locked.state in ('reserved', 'committed')
            and locked.lock_state = 'fulfilment_locked'
        )
    ), 0)
  ) > 0;

  insert into _inv_pack_parties(
    idx, party_id, deal_id, quantity, input_index, prefer_keys,
    fully_allocated, current_supplier_count
  )
  select
    numbered.idx,
    numbered.id,
    numbered.deal_id,
    numbered.quantity,
    numbered.idx,
    coalesce((
      select array_agg(distinct public.inventory_layer_supplier_key(
        layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
      ))
      from public.inventory_allocations allocation
      join public.package_cost_layers layer on layer.id = allocation.cost_layer_id
      left join public.purchase_orders purchase
        on purchase.id = layer.purchase_order_id
      where allocation.deal_line_item_id = numbered.id
        and allocation.state in ('reserved', 'committed')
    ), '{}'::text[]),
    coalesce((
      select sum(allocation.quantity)
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id = numbered.id
        and allocation.state in ('reserved', 'committed')
    ), 0) >= numbered.quantity,
    coalesce((
      select count(distinct public.inventory_layer_supplier_key(
        layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
      ))
      from public.inventory_allocations allocation
      join public.package_cost_layers layer on layer.id = allocation.cost_layer_id
      left join public.purchase_orders purchase
        on purchase.id = layer.purchase_order_id
      where allocation.deal_line_item_id = numbered.id
        and allocation.state in ('reserved', 'committed')
    ), 0)::int
  from (
    select
      (row_number() over (
        order by deal.created_at, line.sort_order, line.id
      ) - 1)::int as idx,
      line.id,
      line.deal_id,
      line.quantity
    from public.deal_line_items line
    join public.deals deal on deal.id = line.deal_id
    where line.package_id = p_package_id
      and coalesce(line.sourcing_mode, 'owned') = 'owned'
      and public.deal_stage_holds_purchased_stock(deal.stage)
      and not exists (
        select 1
        from public.inventory_allocations locked
        where locked.deal_line_item_id = line.id
          and locked.state in ('reserved', 'committed')
          and locked.lock_state = 'fulfilment_locked'
      )
  ) numbered;

  select count(*)::int, coalesce(sum(quantity), 0)::int
  into v_party_n, v_demand
  from _inv_pack_parties;
  select coalesce(sum(remaining), 0)::int into v_capacity
  from _inv_pack_suppliers;
  if v_party_n = 0 then
    perform set_config('inventory.repacking', 'off', true);
    return;
  end if;
  if v_demand > v_capacity then
    for v_party in
      select party_id, deal_id, quantity
      from _inv_pack_parties
      where not fully_allocated
      order by input_index
    loop
      begin
        perform public.inventory_allocate_quantity_from_layers(
          p_package_id, v_party.quantity, 'committed',
          'deal_line_reassignment',
          'deal-line-reassign:' || v_party.party_id::text
            || ':' || gen_random_uuid()::text,
          null, v_party.deal_id, v_party.party_id, null, null, null,
          'Signed deal inventory allocated',
          jsonb_build_object('automatic', true, 'repack', false)
        );
      exception
        when others then
          raise notice 'Could not allocate deal line % during shortage pack: %',
            v_party.party_id, sqlerrm;
      end;
    end loop;
    perform set_config('inventory.repacking', 'off', true);
    return;
  end if;

  insert into _inv_pack_assign(idx, assigned_key)
  select idx, null from _inv_pack_parties;
  insert into _inv_pack_order(seq, party_idx)
  select row_number() over (
    order by covering_count, quantity desc, input_index, party_id
  ) - 1, idx
  from (
    select
      party.idx,
      party.quantity,
      party.input_index,
      party.party_id,
      (
        select count(*)::int
        from _inv_pack_suppliers supplier
        where supplier.remaining >= party.quantity
      ) as covering_count
    from _inv_pack_parties party
  ) ordered;

  insert into _inv_pack_state(
    nodes, node_limit, party_n, assigned_count, newest_score,
    best_assigned, best_newest
  ) values (
    0,
    80000,
    v_party_n,
    0,
    0,
    -1,
    -1
  );

  if v_party_n <= 36 then
    perform public.inventory_search_single_supplier_pack(0);
  end if;

  if (select best_assigned from _inv_pack_state) < 0 then
    delete from _inv_pack_best_assign;
    insert into _inv_pack_best_assign(idx, supplier_key)
    select idx, null from _inv_pack_parties;
    for v_party in
      select party.idx, party.quantity, party.prefer_keys
      from _inv_pack_parties party
      join _inv_pack_order pack_order on pack_order.party_idx = party.idx
      order by pack_order.seq
    loop
      v_supplier_key := null;
      select supplier.supplier_key
      into v_supplier_key
      from _inv_pack_suppliers supplier
      where supplier.remaining >= v_party.quantity
      order by
        case when v_party.prefer_keys is not null
          and supplier.supplier_key = any(v_party.prefer_keys)
          then 0 else 1 end,
        supplier.remaining,
        supplier.supplier_key
      limit 1;
      if v_supplier_key is not null then
        update _inv_pack_best_assign
        set supplier_key = v_supplier_key
        where idx = v_party.idx;
        update _inv_pack_suppliers
        set remaining = remaining - v_party.quantity
        where supplier_key = v_supplier_key;
      end if;
    end loop;
  end if;

  select best_assigned into v_best_assigned from _inv_pack_state;
  if v_best_assigned < 0 then
    select count(*)::int into v_best_assigned
    from _inv_pack_best_assign
    where supplier_key is not null;
  end if;
  select
    count(*) filter (where current_supplier_count = 1 and fully_allocated)::int,
    coalesce(max(current_supplier_count), 0)
  into v_unsplit, v_max_suppliers
  from _inv_pack_parties;
  if v_unsplit >= v_best_assigned
    and v_max_suppliers <= 2
    and not exists (
      select 1 from _inv_pack_parties where not fully_allocated
    )
    and not exists (
      select 1
      from _inv_pack_parties party
      join _inv_pack_best_assign planned on planned.idx = party.idx
      where planned.supplier_key is not null
        and (
          party.current_supplier_count <> 1
          or planned.supplier_key <> all(party.prefer_keys)
        )
    )
  then
    perform set_config('inventory.repacking', 'off', true);
    return;
  end if;

  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.deal_line_item_id in (select party_id from _inv_pack_parties)
      and allocation.state <> 'released'
      and allocation.lock_state = 'mutable'
    order by allocation.request_key
  loop
    perform public.inventory_release_allocations(
      v_request.request_key,
      'Deal suppliers reshuffled to keep parties together',
      true
    );
  end loop;

  for v_party in
    select party.party_id, party.deal_id, party.quantity, planned.supplier_key
    from _inv_pack_parties party
    join _inv_pack_best_assign planned on planned.idx = party.idx
    where planned.supplier_key is not null
    order by party.input_index
  loop
    select array_agg(layer.id order by layer.id)
    into v_allowed
    from public.package_cost_layers layer
    left join public.purchase_orders purchase on purchase.id = layer.purchase_order_id
    where public.inventory_layer_is_candidate(layer.id, p_package_id)
      and public.inventory_layer_supplier_key(
        layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
      ) = v_party.supplier_key;
    if v_allowed is null then
      raise exception 'supplier_layers_missing:%', v_party.supplier_key;
    end if;
    perform public.inventory_allocate_quantity_from_layers(
      p_package_id, v_party.quantity, 'committed',
      'deal_line_reassignment',
      'deal-line-reassign:' || v_party.party_id::text
        || ':' || gen_random_uuid()::text,
      v_allowed, v_party.deal_id, v_party.party_id, null, null, null,
      'Signed deal inventory reassigned',
      jsonb_build_object(
        'automatic', true,
        'repack', true,
        'single_supplier', true
      )
    );
  end loop;

  for v_party in
    select party.party_id, party.deal_id, party.quantity
    from _inv_pack_parties party
    join _inv_pack_best_assign planned on planned.idx = party.idx
    where planned.supplier_key is null
    order by party.quantity desc, party.input_index
  loop
    perform public.inventory_allocate_quantity_from_layers(
      p_package_id, v_party.quantity, 'committed',
      'deal_line_reassignment',
      'deal-line-reassign:' || v_party.party_id::text
        || ':' || gen_random_uuid()::text,
      null, v_party.deal_id, v_party.party_id, null, null, null,
      'Signed deal inventory reassigned',
      jsonb_build_object(
        'automatic', true,
        'repack', true,
        'single_supplier', false
      )
    );
  end loop;

  perform set_config('inventory.repacking', 'off', true);
exception
  when others then
    perform set_config('inventory.repacking', 'off', true);
    raise;
end;
$$;

create or replace function public.inventory_reassign_deal_line(
  p_deal_line_item_id uuid,
  p_preferred_cost_layer_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.deal_line_items%rowtype;
  v_deal public.deals%rowtype;
  v_request record;
  v_request_key text;
begin
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;

  select * into v_line from public.deal_line_items
  where id = p_deal_line_item_id for update;
  if not found then raise exception 'deal_line_not_found'; end if;
  select * into v_deal from public.deals
  where id = v_line.deal_id for update;
  if not found then raise exception 'deal_not_found'; end if;

  if p_preferred_cost_layer_id is not null
    and not public.inventory_layer_is_candidate(
      p_preferred_cost_layer_id, v_line.package_id
    )
  then raise exception 'invalid_cost_layer_for_package'; end if;

  perform 1 from public.packages package
  where package.id = v_line.package_id
  for update;
  perform 1
  from public.deal_line_items line
  join public.deals deal on deal.id = line.deal_id
  where line.package_id = v_line.package_id
    and coalesce(line.sourcing_mode, 'owned') = 'owned'
    and public.deal_stage_holds_purchased_stock(deal.stage)
  order by line.id
  for update of line;
  perform 1
  from public.package_cost_layers layer
  where public.inventory_layer_is_candidate(layer.id, v_line.package_id)
    or (p_preferred_cost_layer_id is not null
      and layer.id = p_preferred_cost_layer_id)
    or layer.id in (
      select allocation.cost_layer_id
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id = v_line.id
        and allocation.state <> 'released'
    )
  order by layer.id
  for update;

  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.deal_line_item_id = v_line.id
      and allocation.state <> 'released'
    order by allocation.request_key
  loop
    perform public.inventory_release_allocations(
      v_request.request_key,
      'Deal product, quantity, or supplier changed',
      true
    );
  end loop;

  update public.inventory_shortages
  set status = 'cancelled',
      resolved_at = coalesce(resolved_at, timezone('utc', now())),
      updated_at = timezone('utc', now()),
      metadata = metadata || jsonb_build_object(
        'cancel_reason', 'Deal product or quantity changed'
      )
  where deal_line_item_id = v_line.id and status = 'open';

  if coalesce(v_line.sourcing_mode, 'owned') = 'brokered'
    or not public.deal_stage_holds_purchased_stock(v_deal.stage)
  then
    update public.deal_line_items
    set supplier_id = null, fulfilment_cost_layer_id = null,
        expected_unit_cost = null, updated_at = timezone('utc', now())
    where id = v_line.id;
    return;
  end if;

  if p_preferred_cost_layer_id is not null then
    v_request_key := 'deal-line-reassign:' || v_line.id::text
      || ':' || gen_random_uuid()::text;
    perform public.inventory_allocate_quantity_from_layers(
      v_line.package_id, v_line.quantity, 'committed',
      'deal_line_supplier_reassignment',
      v_request_key,
      array[p_preferred_cost_layer_id],
      v_line.deal_id, v_line.id, null, null, null,
      'Signed deal inventory reassigned',
      jsonb_build_object(
        'automatic', false,
        'preferred_cost_layer_id', p_preferred_cost_layer_id
      )
    );
    return;
  end if;

  if current_setting('inventory.repacking', true) = 'on' then
    v_request_key := 'deal-line-reassign:' || v_line.id::text
      || ':' || gen_random_uuid()::text;
    perform public.inventory_allocate_quantity_from_layers(
      v_line.package_id, v_line.quantity, 'committed',
      'deal_line_reassignment', v_request_key, null,
      v_line.deal_id, v_line.id, null, null, null,
      'Signed deal inventory reassigned',
      jsonb_build_object('automatic', true)
    );
    return;
  end if;

  perform public.inventory_repack_mutable_deal_allocations(v_line.package_id);
end;
$$;

do $$
declare
  v_package text;
begin
  for v_package in
    select distinct line.package_id
    from public.deal_line_items line
    join public.deals deal on deal.id = line.deal_id
    join public.inventory_allocations allocation
      on allocation.deal_line_item_id = line.id
    join public.package_cost_layers layer on layer.id = allocation.cost_layer_id
    left join public.purchase_orders purchase
      on purchase.id = layer.purchase_order_id
    where public.deal_stage_holds_purchased_stock(deal.stage)
      and coalesce(line.sourcing_mode, 'owned') = 'owned'
      and allocation.state in ('reserved', 'committed')
    group by line.id, line.package_id
    having count(distinct public.inventory_layer_supplier_key(
      layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
    )) > 1
  loop
    begin
      perform public.inventory_repack_mutable_deal_allocations(v_package);
    exception
      when others then
        raise notice 'Could not reshuffle suppliers for package %: %',
          v_package, sqlerrm;
    end;
  end loop;
end;
$$;

revoke all on function public.inventory_layer_supplier_key(uuid, uuid, text, text)
  from public;
grant execute on function public.inventory_layer_supplier_key(uuid, uuid, text, text)
  to authenticated, service_role;
revoke all on function public.inventory_allocate_quantity_from_layers(
  text, int, text, text, text, uuid[], uuid, uuid, uuid, uuid, uuid, text, jsonb
) from public;
grant execute on function public.inventory_allocate_quantity_from_layers(
  text, int, text, text, text, uuid[], uuid, uuid, uuid, uuid, uuid, text, jsonb
) to service_role;
revoke all on function public.inventory_search_single_supplier_pack(int) from public;
revoke all on function public.inventory_repack_mutable_deal_allocations(text)
  from public;
grant execute on function public.inventory_repack_mutable_deal_allocations(text)
  to authenticated, service_role;
revoke all on function public.inventory_reassign_deal_line(uuid, uuid) from public;
grant execute on function public.inventory_reassign_deal_line(uuid, uuid)
  to authenticated, service_role;
