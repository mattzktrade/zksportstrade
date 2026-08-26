-- Staff choose a supplier, not an individual purchase layer. Allocate across
-- all purchases from that supplier in FIFO order while keeping the whole party
-- with that supplier whenever its aggregate stock can cover the line.

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
  v_layer record;
  v_request record;
  v_request_key text;
  v_ledger_package_id text;
  v_supplier_id uuid;
  v_supplier_name text;
  v_available int;
  v_remaining int;
  v_take int;
  v_now timestamptz := timezone('utc', now());
begin
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('deals.manage')
  then
    raise exception 'forbidden';
  end if;

  if p_supplier_key like 'id:%' then
    v_supplier_id := substring(p_supplier_key from 4)::uuid;
    select lower(btrim(supplier.name))
    into v_supplier_name
    from public.suppliers supplier
    where supplier.id = v_supplier_id;
    if not found then raise exception 'supplier_not_found'; end if;
  elsif p_supplier_key like 'name:%' then
    v_supplier_name := lower(btrim(substring(p_supplier_key from 6)));
    if v_supplier_name = '' then raise exception 'supplier_required'; end if;
  else
    raise exception 'invalid_supplier_key';
  end if;

  select * into v_line
  from public.deal_line_items
  where id = p_deal_line_item_id
  for update;
  if not found then raise exception 'deal_line_not_found'; end if;

  select * into v_deal
  from public.deals
  where id = v_line.deal_id
  for update;
  if not found then raise exception 'deal_not_found'; end if;
  if coalesce(v_line.sourcing_mode, 'owned') <> 'owned'
    or v_deal.stage not in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
  then
    raise exception 'invalid_deal_line_assignment';
  end if;

  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.deal_line_item_id = v_line.id
      and allocation.state <> 'released'
    order by allocation.request_key
  loop
    perform public.inventory_release_allocations(
      v_request.request_key,
      'Deal supplier pool changed',
      true
    );
  end loop;

  update public.inventory_shortages
  set status = 'cancelled',
      resolved_at = coalesce(resolved_at, v_now),
      updated_at = v_now,
      metadata = metadata || jsonb_build_object(
        'cancel_reason',
        'Deal supplier pool changed'
      )
  where deal_line_item_id = v_line.id
    and status = 'open';

  update public.deal_line_items
  set supplier_id = null,
      fulfilment_cost_layer_id = null,
      expected_unit_cost = null,
      updated_at = v_now
  where id = v_line.id;

  v_ledger_package_id := public.resolve_cost_ledger_package_id(v_line.package_id);

  perform 1
  from public.package_cost_layers layer
  where layer.package_id = v_ledger_package_id
  order by layer.received_at, layer.id
  for update;

  select coalesce(sum(greatest(
    layer.quantity_remaining - public.inventory_layer_reserved_quantity(layer.id),
    0
  )), 0)::int
  into v_available
  from public.package_cost_layers layer
  left join public.purchase_orders purchase on purchase.id = layer.purchase_order_id
  left join public.suppliers supplier
    on supplier.id = coalesce(layer.supplier_id, purchase.supplier_id)
  where layer.package_id = v_ledger_package_id
    and case
      when v_supplier_id is not null
        then
          coalesce(layer.supplier_id, purchase.supplier_id) = v_supplier_id
          or lower(btrim(coalesce(purchase.supplier, ''))) = v_supplier_name
          or lower(btrim(coalesce(layer.source, ''))) = v_supplier_name
      else
        lower(btrim(coalesce(supplier.name, ''))) = v_supplier_name
        or lower(btrim(coalesce(purchase.supplier, ''))) = v_supplier_name
        or lower(btrim(coalesce(layer.source, ''))) = v_supplier_name
    end;

  if v_available < v_line.quantity then
    raise exception 'insufficient_supplier_stock:%:%',
      v_line.quantity,
      v_available;
  end if;

  v_request_key :=
    'deal-line-supplier-pool:' || v_line.id::text || ':' || gen_random_uuid()::text;
  v_remaining := v_line.quantity;

  for v_layer in
    select
      layer.*,
      greatest(
        layer.quantity_remaining - public.inventory_layer_reserved_quantity(layer.id),
        0
      )::int as allocatable
    from public.package_cost_layers layer
    left join public.purchase_orders purchase on purchase.id = layer.purchase_order_id
    left join public.suppliers supplier
      on supplier.id = coalesce(layer.supplier_id, purchase.supplier_id)
    where layer.package_id = v_ledger_package_id
      and case
        when v_supplier_id is not null
          then
            coalesce(layer.supplier_id, purchase.supplier_id) = v_supplier_id
            or lower(btrim(coalesce(purchase.supplier, ''))) = v_supplier_name
            or lower(btrim(coalesce(layer.source, ''))) = v_supplier_name
        else
          lower(btrim(coalesce(supplier.name, ''))) = v_supplier_name
          or lower(btrim(coalesce(purchase.supplier, ''))) = v_supplier_name
          or lower(btrim(coalesce(layer.source, ''))) = v_supplier_name
      end
    order by layer.received_at, layer.id
  loop
    exit when v_remaining = 0;
    v_take := least(v_layer.allocatable, v_remaining);
    if v_take <= 0 then continue; end if;

    insert into public.inventory_allocations (
      cost_layer_id,
      package_id,
      deal_id,
      deal_line_item_id,
      quantity,
      state,
      source,
      request_key,
      idempotency_key,
      committed_at,
      created_by,
      metadata
    ) values (
      v_layer.id,
      v_line.package_id,
      v_line.deal_id,
      v_line.id,
      v_take,
      'committed',
      'deal_line_supplier_pool_reassignment',
      v_request_key,
      v_request_key || ':layer:' || v_layer.id::text,
      v_now,
      auth.uid(),
      jsonb_build_object(
        'reason', 'Confirmed deal supplier reassigned by supplier pool',
        'supplier_key', p_supplier_key
      )
    );

    update public.package_cost_layers
    set quantity_remaining = quantity_remaining - v_take
    where id = v_layer.id
      and quantity_remaining >= v_take;
    if not found then raise exception 'concurrent_inventory_change'; end if;
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining <> 0 then raise exception 'allocation_incomplete'; end if;
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
  then
    raise exception 'forbidden';
  end if;

  if jsonb_typeof(p_assignments) is distinct from 'array'
    or jsonb_array_length(p_assignments) = 0
  then
    raise exception 'assignments_required';
  end if;

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

  perform 1
  from public.package_cost_layers layer
  where layer.package_id in (
    select distinct public.resolve_cost_ledger_package_id(line.package_id)
    from public.deal_line_items line
    where line.id in (
      select (value->>'lineId')::uuid
      from jsonb_array_elements(p_assignments)
    )
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
  loop
    perform public.inventory_reassign_deal_line_to_supplier(
      v_assignment.line_id,
      v_assignment.supplier_key
    );
  end loop;
end;
$$;

revoke all on function public.inventory_reassign_deal_line_to_supplier(uuid, text)
  from public;
grant execute on function public.inventory_reassign_deal_line_to_supplier(uuid, text)
  to authenticated, service_role;

revoke all on function public.inventory_swap_deal_line_suppliers(jsonb) from public;
grant execute on function public.inventory_swap_deal_line_suppliers(jsonb)
  to authenticated, service_role;
