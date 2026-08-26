-- The first packer never ran: pg-safeupdate rejects UPDATE/DELETE without WHERE.
-- Also pack the whole deal (all lines on this package) onto one supplier, not
-- each line independently — a 29-guest order stored as 20+8+1 was showing as
-- three dropdowns even when each line was internally whole.

create or replace function public.inventory_search_single_supplier_pack(p_depth int)
returns void
language plpgsql
security definer
set search_path = pg_temp, public
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
  from _inv_pack_state
  where true
  limit 1;
  if not found or v_nodes > v_limit then return; end if;
  update _inv_pack_state set nodes = nodes + 1 where true;

  v_remaining_parties := v_party_n - p_depth;
  if v_assigned_count + v_remaining_parties < (
    select best_assigned from _inv_pack_state where true limit 1
  ) then return; end if;

  if p_depth = v_party_n then
    if v_assigned_count > (select best_assigned from _inv_pack_state where true limit 1)
      or (
        v_assigned_count = (select best_assigned from _inv_pack_state where true limit 1)
        and v_newest_score > (select best_newest from _inv_pack_state where true limit 1)
      )
    then
      update _inv_pack_state
      set best_assigned = v_assigned_count, best_newest = v_newest_score
      where true;
      delete from _inv_pack_best_assign where true;
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
        newest_score = newest_score + v_input_index + 1
    where true;
    perform public.inventory_search_single_supplier_pack(p_depth + 1);
    update _inv_pack_state
    set assigned_count = assigned_count - 1,
        newest_score = newest_score - v_input_index - 1
    where true;
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
        newest_score = newest_score + v_input_index + 1
    where true;
    perform public.inventory_search_single_supplier_pack(p_depth + 1);
    update _inv_pack_state
    set assigned_count = assigned_count - 1,
        newest_score = newest_score - v_input_index - 1
    where true;
    update _inv_pack_assign set assigned_key = null where idx = v_idx;
    update _inv_pack_suppliers
    set remaining = remaining + v_qty
    where supplier_key = v_supplier_key;
    if (select best_assigned from _inv_pack_state where true limit 1) = v_party_n then
      return;
    end if;
  end loop;

  if v_assigned_count + v_remaining_parties - 1
    >= (select best_assigned from _inv_pack_state where true limit 1)
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
set search_path = pg_temp, public
as $$
declare
  v_party record;
  v_line record;
  v_request record;
  v_allowed uuid[];
  v_demand int := 0;
  v_capacity int := 0;
  v_party_n int := 0;
  v_supplier_key text;
  v_used text[];
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
  drop table if exists _inv_pack_party_lines;
  drop table if exists _inv_pack_order;
  drop table if exists _inv_pack_assign;
  drop table if exists _inv_pack_best_assign;
  drop table if exists _inv_pack_line_assign;
  drop table if exists _inv_pack_supplier_original;
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
    deal_id uuid not null,
    quantity int not null,
    input_index int not null,
    prefer_keys text[] not null,
    fully_allocated boolean not null,
    current_supplier_count int not null
  ) on commit drop;
  create temp table _inv_pack_party_lines (
    idx int not null,
    line_id uuid not null,
    quantity int not null,
    primary key (idx, line_id)
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
  create temp table _inv_pack_line_assign (
    line_id uuid primary key,
    deal_id uuid not null,
    quantity int not null,
    supplier_key text
  ) on commit drop;
  create temp table _inv_pack_supplier_original (
    supplier_key text primary key,
    remaining int not null
  ) on commit drop;

  insert into _inv_pack_parties(
    idx, deal_id, quantity, input_index, prefer_keys,
    fully_allocated, current_supplier_count
  )
  select
    numbered.idx,
    numbered.deal_id,
    numbered.quantity,
    numbered.idx,
    coalesce((
      select array_agg(distinct public.inventory_layer_supplier_key(
        layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
      ))
      from public.inventory_allocations allocation
      join public.deal_line_items line on line.id = allocation.deal_line_item_id
      join public.package_cost_layers layer on layer.id = allocation.cost_layer_id
      left join public.purchase_orders purchase
        on purchase.id = layer.purchase_order_id
      where line.deal_id = numbered.deal_id
        and line.package_id = p_package_id
        and allocation.state in ('reserved', 'committed')
    ), '{}'::text[]),
    coalesce((
      select sum(allocation.quantity)
      from public.inventory_allocations allocation
      join public.deal_line_items line on line.id = allocation.deal_line_item_id
      where line.deal_id = numbered.deal_id
        and line.package_id = p_package_id
        and allocation.state in ('reserved', 'committed')
    ), 0) >= numbered.quantity,
    coalesce((
      select count(distinct public.inventory_layer_supplier_key(
        layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
      ))
      from public.inventory_allocations allocation
      join public.deal_line_items line on line.id = allocation.deal_line_item_id
      join public.package_cost_layers layer on layer.id = allocation.cost_layer_id
      left join public.purchase_orders purchase
        on purchase.id = layer.purchase_order_id
      where line.deal_id = numbered.deal_id
        and line.package_id = p_package_id
        and allocation.state in ('reserved', 'committed')
    ), 0)::int
  from (
    select
      (row_number() over (order by deal.created_at, deal.id) - 1)::int as idx,
      deal.id as deal_id,
      sum(line.quantity)::int as quantity
    from public.deal_line_items line
    join public.deals deal on deal.id = line.deal_id
    where line.package_id = p_package_id
      and coalesce(line.sourcing_mode, 'owned') = 'owned'
      and public.deal_stage_holds_purchased_stock(deal.stage)
      and not exists (
        select 1
        from public.deal_line_items locked_line
        join public.inventory_allocations locked
          on locked.deal_line_item_id = locked_line.id
        where locked_line.deal_id = deal.id
          and locked_line.package_id = p_package_id
          and locked.state in ('reserved', 'committed')
          and locked.lock_state = 'fulfilment_locked'
      )
    group by deal.id, deal.created_at
  ) numbered;

  insert into _inv_pack_party_lines(idx, line_id, quantity)
  select party.idx, line.id, line.quantity
  from _inv_pack_parties party
  join public.deal_line_items line on line.deal_id = party.deal_id
  where line.package_id = p_package_id
    and coalesce(line.sourcing_mode, 'owned') = 'owned';

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
        where allocation.cost_layer_id = layer.id
          and allocation.state in ('reserved', 'committed')
          and allocation.lock_state = 'mutable'
          and allocation.deal_line_item_id in (
            select line_id from _inv_pack_party_lines
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
      where allocation.cost_layer_id = layer.id
        and allocation.state in ('reserved', 'committed')
        and allocation.lock_state = 'mutable'
        and allocation.deal_line_item_id in (
          select line_id from _inv_pack_party_lines
        )
    ), 0)
  ) > 0;

  insert into _inv_pack_supplier_original(supplier_key, remaining)
  select supplier_key, remaining from _inv_pack_suppliers;

  select count(*)::int, coalesce(sum(quantity), 0)::int
  into v_party_n, v_demand
  from _inv_pack_parties;
  select coalesce(sum(remaining), 0)::int into v_capacity
  from _inv_pack_suppliers;
  if v_party_n = 0 then
    perform set_config('inventory.repacking', 'off', true);
    return;
  end if;

  insert into _inv_pack_assign(idx, assigned_key)
  select idx, null from _inv_pack_parties;
  insert into _inv_pack_order(seq, party_idx)
  select row_number() over (
    order by covering_count, quantity desc, input_index, deal_id
  ) - 1, idx
  from (
    select
      party.idx,
      party.quantity,
      party.input_index,
      party.deal_id,
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
  ) values (0, 80000, v_party_n, 0, 0, -1, -1);

  if v_party_n <= 36 then
    perform public.inventory_search_single_supplier_pack(0);
  end if;

  if (select best_assigned from _inv_pack_state where true limit 1) < 0 then
    delete from _inv_pack_best_assign where true;
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

  if not exists (
    select 1 from _inv_pack_parties where current_supplier_count <> 1
      or not fully_allocated
  ) then
    perform set_config('inventory.repacking', 'off', true);
    return;
  end if;

  delete from _inv_pack_suppliers where true;
  insert into _inv_pack_suppliers(supplier_key, remaining)
  select supplier_key, remaining from _inv_pack_supplier_original;
  delete from _inv_pack_line_assign where true;

  for v_party in
    select party.idx, party.deal_id, party.quantity, planned.supplier_key
    from _inv_pack_parties party
    join _inv_pack_best_assign planned on planned.idx = party.idx
    where planned.supplier_key is not null
    order by party.input_index
  loop
    update _inv_pack_suppliers
    set remaining = remaining - v_party.quantity
    where supplier_key = v_party.supplier_key;
    insert into _inv_pack_line_assign(line_id, deal_id, quantity, supplier_key)
    select line_id, v_party.deal_id, quantity, v_party.supplier_key
    from _inv_pack_party_lines
    where idx = v_party.idx;
  end loop;

  for v_party in
    select party.idx, party.deal_id
    from _inv_pack_parties party
    join _inv_pack_best_assign planned on planned.idx = party.idx
    where planned.supplier_key is null
    order by party.quantity desc, party.input_index
  loop
    v_used := '{}'::text[];
    for v_line in
      select line_id, quantity
      from _inv_pack_party_lines
      where idx = v_party.idx
      order by quantity desc, line_id
    loop
      v_supplier_key := null;
      select supplier.supplier_key
      into v_supplier_key
      from _inv_pack_suppliers supplier
      where supplier.remaining >= v_line.quantity
      order by
        case when supplier.supplier_key = any(v_used) then 0 else 1 end,
        supplier.remaining,
        supplier.supplier_key
      limit 1;
      insert into _inv_pack_line_assign(
        line_id, deal_id, quantity, supplier_key
      ) values (
        v_line.line_id, v_party.deal_id, v_line.quantity, v_supplier_key
      );
      if v_supplier_key is not null then
        update _inv_pack_suppliers
        set remaining = remaining - v_line.quantity
        where supplier_key = v_supplier_key;
        if not v_supplier_key = any(v_used) then
          v_used := array_append(v_used, v_supplier_key);
        end if;
      end if;
    end loop;
  end loop;

  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.deal_line_item_id in (select line_id from _inv_pack_party_lines)
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

  for v_line in
    select line_id, deal_id, quantity, supplier_key
    from _inv_pack_line_assign
    where supplier_key is not null
    order by quantity desc, line_id
  loop
    select array_agg(layer.id order by layer.id)
    into v_allowed
    from public.package_cost_layers layer
    left join public.purchase_orders purchase on purchase.id = layer.purchase_order_id
    where public.inventory_layer_is_candidate(layer.id, p_package_id)
      and public.inventory_layer_supplier_key(
        layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
      ) = v_line.supplier_key;
    if v_allowed is null then
      raise exception 'supplier_layers_missing:%', v_line.supplier_key;
    end if;
    perform public.inventory_allocate_quantity_from_layers(
      p_package_id, v_line.quantity, 'committed',
      'deal_line_reassignment',
      'deal-line-reassign:' || v_line.line_id::text
        || ':' || gen_random_uuid()::text,
      v_allowed, v_line.deal_id, v_line.line_id, null, null, null,
      'Signed deal inventory reassigned',
      jsonb_build_object(
        'automatic', true,
        'repack', true,
        'single_supplier', true
      )
    );
  end loop;

  for v_line in
    select line_id, deal_id, quantity
    from _inv_pack_line_assign
    where supplier_key is null
    order by quantity desc, line_id
  loop
    perform public.inventory_allocate_quantity_from_layers(
      p_package_id, v_line.quantity, 'committed',
      'deal_line_reassignment',
      'deal-line-reassign:' || v_line.line_id::text
        || ':' || gen_random_uuid()::text,
      null, v_line.deal_id, v_line.line_id, null, null, null,
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

comment on function public.inventory_repack_mutable_deal_allocations(text) is
  'Keep each signed deal on one supplier when purchased stock allows, including by rearranging other mutable deals on the same package.';

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
    group by line.deal_id, line.package_id
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

revoke all on function public.inventory_search_single_supplier_pack(int) from public;
revoke all on function public.inventory_repack_mutable_deal_allocations(text)
  from public;
grant execute on function public.inventory_repack_mutable_deal_allocations(text)
  to authenticated, service_role;
