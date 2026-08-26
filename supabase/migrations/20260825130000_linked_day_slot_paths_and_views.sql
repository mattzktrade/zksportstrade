-- Supplier/order reassignment and canonical reads must use component capacity.

create or replace function public.resolve_cost_ledger_package_id(
  p_package_id text
)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_package public.packages%rowtype;
  v_parent_id text;
begin
  select * into v_package
  from public.packages package
  where package.id = p_package_id;
  if not found or coalesce(v_package.inventory_is_standalone, false)
    or nullif(btrim(v_package.inventory_group_id), '') is null
  then
    return p_package_id;
  end if;

  -- Compatibility callers still expect one display ledger. Component-aware
  -- mutation functions can draw from all compatible layers. Prefer the 3-day
  -- physical parent, then a 2-day parent, then the product itself.
  select package.id into v_parent_id
  from public.packages package
  where package.inventory_group_id = v_package.inventory_group_id
    and package.shell_parent_package_id is null
    and not coalesce(package.inventory_is_standalone, false)
    and package.duration in ('3_day', '2_day')
  order by case package.duration when '3_day' then 0 else 1 end, package.id
  limit 1;
  return coalesce(v_parent_id, p_package_id);
end;
$$;

create or replace function public.linked_inventory_sellable(
  p_package_id text,
  p_agent_profile_id uuid
)
returns int
language sql
stable
set search_path = public
as $$
  select greatest(
    public.inventory_package_allocatable_quantity(p_package_id)
    + coalesce((
      select sum(hold.quantity)::int
      from public.inventory_holds hold
      where hold.package_id = p_package_id
        and hold.agent_profile_id = p_agent_profile_id
        and hold.released_at is null
        and (hold.expires_at is null
          or hold.expires_at > timezone('utc', now()))
    ), 0),
    0
  )::int;
$$;

create or replace view public.inventory_day_slot_availability as
select
  package.id as package_id,
  required.day_slot,
  coalesce(sum(floor(greatest(
    component.quantity_remaining - coalesce(reserved.units, 0),
    0
  )::numeric / required.units_per_sale)), 0)::int as available_quantity,
  coalesce(sum(component.quantity_total), 0)::int as physical_units,
  coalesce(sum(component.quantity_remaining), 0)::int as remaining_units,
  coalesce(sum(reserved.units), 0)::int as reserved_units
from public.packages package
join public.inventory_package_day_slots(package.id) required on true
left join public.package_cost_layers layer
  on public.inventory_layer_is_candidate(layer.id, package.id)
left join public.package_cost_layer_day_components component
  on component.cost_layer_id = layer.id
 and component.day_slot = required.day_slot
left join lateral (
  select coalesce(sum(allocation_component.requested_units), 0)::int as units
  from public.inventory_allocation_day_components allocation_component
  join public.inventory_allocations allocation
    on allocation.id = allocation_component.allocation_id
  where allocation_component.cost_layer_day_component_id = component.id
    and allocation.state = 'reserved'
) reserved on true
group by package.id, required.day_slot;

grant select on public.inventory_day_slot_availability
  to authenticated, service_role;

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
  public.resolve_cost_ledger_package_id(package.id) as ledger_package_id,
  coalesce(layer_totals.original_quantity, 0)::int as layer_original_quantity,
  coalesce(layer_totals.remaining_quantity, 0)::int as layer_quantity_remaining,
  coalesce(allocation_totals.reserved_quantity, 0)::int as reserved_quantity,
  public.inventory_package_manual_hold_quantity(package.id)::int
    as manual_hold_quantity,
  coalesce(allocation_totals.committed_quantity, 0)::int as committed_quantity,
  public.inventory_package_allocatable_quantity(package.id)::int
    as available_quantity,
  coalesce(shortage_totals.historical_quantity, 0)::int
    as historical_shortage_quantity,
  coalesce(shortage_totals.brokered_quantity, 0)::int
    as brokered_shortage_quantity,
  coalesce(inventory.qty_available, 0) as legacy_qty_available,
  coalesce(inventory.qty_held, 0) as legacy_qty_held,
  (
    public.inventory_package_allocatable_quantity(package.id)
    - coalesce(shortage_totals.historical_quantity, 0)
    - coalesce(unallocated.quantity, 0)
  )::int as net_quantity
from public.packages package
left join lateral (
  select
    coalesce(sum(layer.quantity), 0) as original_quantity,
    coalesce(sum(layer.quantity_remaining), 0) as remaining_quantity
  from public.package_cost_layers layer
  where public.inventory_layer_is_candidate(layer.id, package.id)
) layer_totals on true
left join lateral (
  select
    coalesce(sum(allocation.quantity) filter (
      where allocation.state = 'reserved'
    ), 0) as reserved_quantity,
    coalesce(sum(allocation.quantity) filter (
      where allocation.state = 'committed'
    ), 0) as committed_quantity
  from public.inventory_allocations allocation
  where allocation.package_id = package.id
) allocation_totals on true
left join lateral (
  select
    coalesce(sum(shortage.quantity) filter (
      where shortage.status = 'open'
        and shortage.shortage_type = 'historical_reconciliation'
    ), 0) as historical_quantity,
    coalesce(sum(shortage.quantity) filter (
      where shortage.status = 'open'
        and shortage.shortage_type = 'brokered'
    ), 0) as brokered_quantity
  from public.inventory_shortages shortage
  where shortage.package_id = package.id
) shortage_totals on true
left join public.inventory_unallocated_won_by_ledger unallocated
  on unallocated.ledger_package_id =
    public.resolve_cost_ledger_package_id(package.id)
left join public.package_inventory inventory
  on inventory.package_id = package.id;

grant select on public.inventory_availability to authenticated, service_role;

create or replace view public.deal_line_inventory_fulfilment as
with allocation_detail as (
  select
    allocation.deal_line_item_id,
    allocation.cost_layer_id,
    allocation.quantity,
    allocation.effective_unit_cost_snapshot as unit_cost,
    coalesce(layer.supplier_id, purchase.supplier_id) as supplier_id,
    coalesce(
      supplier.name,
      nullif(btrim(purchase.supplier), ''),
      nullif(btrim(layer.source), ''),
      'Unassigned'
    ) as supplier_name,
    coalesce(
      coalesce(layer.supplier_id, purchase.supplier_id)::text,
      'name:' || lower(coalesce(
        nullif(btrim(purchase.supplier), ''),
        nullif(btrim(layer.source), ''),
        'unassigned'
      ))
    ) as supplier_key
  from public.inventory_allocations allocation
  join public.package_cost_layers layer on layer.id = allocation.cost_layer_id
  left join public.purchase_orders purchase on purchase.id = layer.purchase_order_id
  left join public.suppliers supplier
    on supplier.id = coalesce(layer.supplier_id, purchase.supplier_id)
  where allocation.state in ('reserved', 'committed')
    and allocation.deal_line_item_id is not null
),
allocation_summary as (
  select
    detail.deal_line_item_id,
    sum(detail.quantity)::int as allocated_quantity,
    count(distinct detail.cost_layer_id)::int as layer_count,
    (array_agg(detail.cost_layer_id order by detail.cost_layer_id))[1]
      as only_cost_layer_id,
    count(distinct detail.supplier_key)::int as supplier_count,
    (array_agg(detail.supplier_id order by detail.supplier_id)
      filter (where detail.supplier_id is not null))[1] as only_supplier_id,
    case when bool_and(detail.unit_cost is not null)
      then sum(detail.quantity * detail.unit_cost)
        / nullif(sum(detail.quantity), 0)
      else null end as weighted_unit_cost
  from allocation_detail detail
  group by detail.deal_line_item_id
),
supplier_totals as (
  select
    detail.deal_line_item_id, detail.supplier_key, detail.supplier_id,
    detail.supplier_name, sum(detail.quantity)::int as quantity
  from allocation_detail detail
  group by detail.deal_line_item_id, detail.supplier_key,
    detail.supplier_id, detail.supplier_name
),
supplier_summary as (
  select
    supplier.deal_line_item_id,
    string_agg(
      supplier.quantity::text || 'x ' || supplier.supplier_name,
      ' · ' order by supplier.supplier_name
    ) as supplier_label
  from supplier_totals supplier
  group by supplier.deal_line_item_id
)
select
  line.id as deal_line_item_id,
  line.deal_id,
  line.package_id,
  line.quantity as required_quantity,
  coalesce(summary.allocated_quantity, 0)::int as allocated_quantity,
  coalesce(summary.allocated_quantity, 0) >= line.quantity as fully_allocated,
  case when coalesce(summary.allocated_quantity, 0) >= line.quantity
    then suppliers.supplier_label else null end as supplier_label,
  case when coalesce(summary.allocated_quantity, 0) >= line.quantity
      and summary.supplier_count = 1
    then summary.only_supplier_id else null end as supplier_id,
  case when coalesce(summary.allocated_quantity, 0) >= line.quantity
      and summary.layer_count = 1
    then summary.only_cost_layer_id else null end as cost_layer_id,
  case when coalesce(summary.allocated_quantity, 0) >= line.quantity
    then summary.weighted_unit_cost else null end as weighted_unit_cost
from public.deal_line_items line
left join allocation_summary summary on summary.deal_line_item_id = line.id
left join supplier_summary suppliers on suppliers.deal_line_item_id = line.id;

grant select on public.deal_line_inventory_fulfilment
  to authenticated, service_role;

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

  perform 1
  from public.package_cost_layers layer
  where (p_preferred_cost_layer_id is not null
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
    or v_deal.stage not in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
  then
    update public.deal_line_items
    set supplier_id = null, fulfilment_cost_layer_id = null,
        expected_unit_cost = null, updated_at = timezone('utc', now())
    where id = v_line.id;
    return;
  end if;

  v_request_key := 'deal-line-reassign:' || v_line.id::text
    || ':' || gen_random_uuid()::text;
  perform public.inventory_allocate_quantity_from_layers(
    v_line.package_id, v_line.quantity, 'committed',
    case when p_preferred_cost_layer_id is null
      then 'deal_line_reassignment'
      else 'deal_line_supplier_reassignment' end,
    v_request_key,
    case when p_preferred_cost_layer_id is null then null
      else array[p_preferred_cost_layer_id] end,
    v_line.deal_id, v_line.id, null, null, null,
    'Confirmed deal inventory reassigned',
    jsonb_build_object(
      'automatic', p_preferred_cost_layer_id is null,
      'preferred_cost_layer_id', p_preferred_cost_layer_id
    )
  );
end;
$$;

create or replace function public.inventory_reassign_deal_line_to_supplier(
  p_deal_line_item_id uuid,
  p_supplier_key text
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
  v_supplier_id uuid;
  v_supplier_name text;
  v_allowed uuid[];
  v_available int;
  v_request_key text;
begin
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;

  if p_supplier_key like 'id:%' then
    v_supplier_id := substring(p_supplier_key from 4)::uuid;
    select lower(btrim(supplier.name)) into v_supplier_name
    from public.suppliers supplier where supplier.id = v_supplier_id;
    if not found then raise exception 'supplier_not_found'; end if;
  elsif p_supplier_key like 'name:%' then
    v_supplier_name := lower(btrim(substring(p_supplier_key from 6)));
    if v_supplier_name = '' then raise exception 'supplier_required'; end if;
  else
    raise exception 'invalid_supplier_key';
  end if;

  select * into v_line
  from public.deal_line_items line
  where line.id = p_deal_line_item_id
  for update;
  if not found then raise exception 'deal_line_not_found'; end if;
  select * into v_deal
  from public.deals deal where deal.id = v_line.deal_id for update;
  if not found then raise exception 'deal_not_found'; end if;
  if coalesce(v_line.sourcing_mode, 'owned') <> 'owned'
    or v_deal.stage not in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
  then raise exception 'invalid_deal_line_assignment'; end if;

  select array_agg(layer.id order by layer.id)
  into v_allowed
  from public.package_cost_layers layer
  left join public.purchase_orders purchase on purchase.id = layer.purchase_order_id
  left join public.suppliers supplier
    on supplier.id = coalesce(layer.supplier_id, purchase.supplier_id)
  where public.inventory_layer_is_candidate(layer.id, v_line.package_id)
    and case when v_supplier_id is not null then
      coalesce(layer.supplier_id, purchase.supplier_id) = v_supplier_id
      or lower(btrim(coalesce(purchase.supplier, ''))) = v_supplier_name
      or lower(btrim(coalesce(layer.source, ''))) = v_supplier_name
    else
      lower(btrim(coalesce(supplier.name, ''))) = v_supplier_name
      or lower(btrim(coalesce(purchase.supplier, ''))) = v_supplier_name
      or lower(btrim(coalesce(layer.source, ''))) = v_supplier_name
    end;
  if v_allowed is null then raise exception 'insufficient_supplier_stock'; end if;

  -- Lock all possible old/new layers before releasing either side.
  perform 1
  from public.package_cost_layers layer
  where layer.id = any(v_allowed)
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
      v_request.request_key, 'Deal supplier pool changed', true
    );
  end loop;

  select coalesce(sum(public.inventory_layer_component_available_quantity(
    layer_id, v_line.package_id
  )), 0)::int
  into v_available
  from unnest(v_allowed) layer_id;
  if v_available < v_line.quantity then
    raise exception 'insufficient_supplier_stock:%:%',
      v_line.quantity, v_available;
  end if;

  update public.inventory_shortages
  set status = 'cancelled',
      resolved_at = coalesce(resolved_at, timezone('utc', now())),
      updated_at = timezone('utc', now()),
      metadata = metadata || jsonb_build_object(
        'cancel_reason', 'Deal supplier pool changed'
      )
  where deal_line_item_id = v_line.id and status = 'open';

  v_request_key := 'deal-line-supplier-pool:' || v_line.id::text
    || ':' || gen_random_uuid()::text;
  perform public.inventory_allocate_quantity_from_layers(
    v_line.package_id, v_line.quantity, 'committed',
    'deal_line_supplier_pool_reassignment', v_request_key, v_allowed,
    v_line.deal_id, v_line.id, null, null, null,
    'Confirmed deal supplier reassigned by supplier pool',
    jsonb_build_object('supplier_key', p_supplier_key)
  );
end;
$$;

create or replace function public.inventory_swap_deal_line_suppliers(
  p_assignments jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment record;
  v_request record;
  v_expected_count int;
  v_actual_count int;
begin
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_assignments) is distinct from 'array'
    or jsonb_array_length(p_assignments) = 0
  then raise exception 'assignments_required'; end if;

  select count(*), count(distinct assignment.line_id)
  into v_expected_count, v_actual_count
  from (
    select (value->>'lineId')::uuid as line_id
    from jsonb_array_elements(p_assignments)
  ) assignment;
  if v_expected_count <> v_actual_count then
    raise exception 'duplicate_deal_line_assignment';
  end if;

  perform 1
  from public.deal_line_items line
  join public.deals deal on deal.id = line.deal_id
  where line.id in (
    select (value->>'lineId')::uuid
    from jsonb_array_elements(p_assignments)
  )
    and nullif(btrim((
      select value->>'supplierKey'
      from jsonb_array_elements(p_assignments)
      where (value->>'lineId')::uuid = line.id
    )), '') is not null
    and coalesce(line.sourcing_mode, 'owned') = 'owned'
    and deal.stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
  order by line.id
  for update of line;
  get diagnostics v_actual_count = row_count;
  if v_actual_count <> v_expected_count then
    raise exception 'invalid_deal_line_assignment';
  end if;

  -- Every old and potentially new physical layer is locked once, globally by
  -- UUID, before either side of a balanced supplier swap is released.
  perform 1
  from public.package_cost_layers layer
  where layer.id in (
      select allocation.cost_layer_id
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id in (
        select (value->>'lineId')::uuid
        from jsonb_array_elements(p_assignments)
      )
        and allocation.state <> 'released'
    )
    or exists (
      select 1
      from public.deal_line_items line
      where line.id in (
        select (value->>'lineId')::uuid
        from jsonb_array_elements(p_assignments)
      )
        and public.inventory_layer_is_candidate(layer.id, line.package_id)
    )
  order by layer.id
  for update;

  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.deal_line_item_id in (
      select (value->>'lineId')::uuid
      from jsonb_array_elements(p_assignments)
    )
      and allocation.state <> 'released'
    order by allocation.request_key
  loop
    perform public.inventory_release_allocations(
      v_request.request_key,
      'Supplier assignments swapped as one batch',
      true
    );
  end loop;

  for v_assignment in
    select
      (value->>'lineId')::uuid as line_id,
      value->>'supplierKey' as supplier_key
    from jsonb_array_elements(p_assignments)
    order by (value->>'lineId')::uuid
  loop
    perform public.inventory_reassign_deal_line_to_supplier(
      v_assignment.line_id, v_assignment.supplier_key
    );
  end loop;
end;
$$;

create or replace function public.admin_reassign_order_package_stock(
  p_order_id uuid,
  p_package_id text,
  p_allocations jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_expected int;
  v_total int;
  v_item record;
  v_request record;
  v_line_id uuid;
  v_request_base text;
begin
  if not public.has_cms_permission('operations.manage') and not public.is_admin()
    and auth.role() is distinct from 'service_role'
  then raise exception 'forbidden'; end if;

  select * into v_order from public.orders
  where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.status = 'cancelled' then raise exception 'order_cancelled'; end if;
  if jsonb_typeof(p_allocations) is distinct from 'array' then
    raise exception 'invalid_allocations';
  end if;

  select line.id into v_line_id
  from public.order_line_items line
  where line.order_id = p_order_id and line.package_id = p_package_id
  order by line.sort_order, line.id limit 1;
  if v_line_id is not null then
    select coalesce(sum(line.quantity), 0)::int into v_expected
    from public.order_line_items line
    where line.order_id = p_order_id and line.package_id = p_package_id;
  elsif v_order.package_id = p_package_id then
    v_expected := v_order.guests;
  else
    raise exception 'package_not_on_order';
  end if;

  create temporary table if not exists ops_day_reassign_input (
    cost_layer_id uuid primary key,
    quantity int not null check (quantity > 0)
  ) on commit drop;
  truncate table pg_temp.ops_day_reassign_input;
  for v_item in
    select
      (value->>'cost_layer_id')::uuid as cost_layer_id,
      floor((value->>'quantity')::numeric)::int as quantity
    from jsonb_array_elements(p_allocations)
  loop
    if v_item.cost_layer_id is null or coalesce(v_item.quantity, 0) <= 0 then
      raise exception 'invalid_allocation_row';
    end if;
    insert into pg_temp.ops_day_reassign_input as input (
      cost_layer_id, quantity
    ) values (v_item.cost_layer_id, v_item.quantity)
    on conflict (cost_layer_id) do update
    set quantity = input.quantity + excluded.quantity;
  end loop;
  select coalesce(sum(quantity), 0)::int into v_total
  from pg_temp.ops_day_reassign_input;
  if v_total <> v_expected then
    raise exception 'allocation_total_must_equal_line_quantity';
  end if;
  if exists (
    select 1
    from pg_temp.ops_day_reassign_input input
    where not public.inventory_layer_is_candidate(
      input.cost_layer_id, p_package_id
    )
  ) then raise exception 'invalid_cost_layer_for_package'; end if;

  perform 1
  from public.package_cost_layers layer
  where layer.id in (
      select input.cost_layer_id from pg_temp.ops_day_reassign_input input
    )
    or layer.id in (
      select allocation.cost_layer_id
      from public.inventory_allocations allocation
      where allocation.order_id = p_order_id
        and allocation.package_id = p_package_id
        and allocation.state <> 'released'
    )
  order by layer.id
  for update;

  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.order_id = p_order_id
      and allocation.package_id = p_package_id
      and allocation.state <> 'released'
    order by allocation.request_key
  loop
    perform public.inventory_release_allocations(
      v_request.request_key, 'Order supplier stock reassigned', true
    );
  end loop;

  v_request_base := 'order-supplier-reassign:' || p_order_id::text
    || ':' || p_package_id || ':' || gen_random_uuid()::text;
  for v_item in
    select input.cost_layer_id, input.quantity
    from pg_temp.ops_day_reassign_input input
    order by input.cost_layer_id
  loop
    perform public.inventory_allocate_quantity_from_layers(
      p_package_id, v_item.quantity, 'committed',
      'order_supplier_reassignment',
      v_request_base || ':layer:' || v_item.cost_layer_id::text,
      array[v_item.cost_layer_id],
      (select deal.id from public.deals deal
        where deal.order_id = p_order_id limit 1),
      (select line.deal_line_item_id from public.order_line_items line
        where line.id = v_line_id),
      p_order_id, v_line_id, null,
      'Operations reassigned order supplier stock',
      jsonb_build_object('manual_layer_selection', true)
    );
  end loop;

  delete from public.order_supplier_fulfilments
  where order_id = p_order_id and package_id = p_package_id;
  insert into public.order_supplier_fulfilments (
    order_id, order_line_item_id, package_id, supplier_id,
    quantity, status, notes
  )
  select
    p_order_id, v_line_id, p_package_id,
    coalesce(layer.supplier_id, purchase.supplier_id),
    sum(input.quantity)::int, 'confirmed', 'Assigned from component inventory'
  from pg_temp.ops_day_reassign_input input
  join public.package_cost_layers layer on layer.id = input.cost_layer_id
  left join public.purchase_orders purchase
    on purchase.id = layer.purchase_order_id
  group by coalesce(layer.supplier_id, purchase.supplier_id);

  insert into public.order_operation_events (
    order_id, event_type, actor_profile_id, summary, metadata
  ) values (
    p_order_id, 'supplier_stock_reassigned', auth.uid(),
    'Reassigned inventory supplier',
    jsonb_build_object(
      'package_id', p_package_id,
      'quantity', v_expected,
      'day_component_capacity', true
    )
  );
end;
$$;

revoke all on function public.resolve_cost_ledger_package_id(text) from public;
grant execute on function public.resolve_cost_ledger_package_id(text)
  to authenticated, service_role;
revoke all on function public.linked_inventory_sellable(text, uuid) from public;
grant execute on function public.linked_inventory_sellable(text, uuid)
  to authenticated, service_role;
revoke all on function public.inventory_reassign_deal_line_to_supplier(uuid, text)
  from public;
grant execute on function public.inventory_reassign_deal_line_to_supplier(uuid, text)
  to authenticated, service_role;
revoke all on function public.inventory_reassign_deal_line(uuid, uuid)
  from public;
grant execute on function public.inventory_reassign_deal_line(uuid, uuid)
  to authenticated, service_role;
revoke all on function public.inventory_swap_deal_line_suppliers(jsonb)
  from public;
grant execute on function public.inventory_swap_deal_line_suppliers(jsonb)
  to authenticated, service_role;
revoke all on function public.admin_reassign_order_package_stock(uuid, text, jsonb)
  from public;
grant execute on function public.admin_reassign_order_package_stock(uuid, text, jsonb)
  to authenticated, service_role;
