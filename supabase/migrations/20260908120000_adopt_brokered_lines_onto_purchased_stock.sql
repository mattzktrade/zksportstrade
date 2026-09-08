-- Assigning a purchased supplier to a signed brokered deal must convert the
-- line to owned stock and allocate it. Previously the deal page only stamped
-- supplier_id / fulfilment_cost_layer_id, so the sales list showed the supplier
-- as plain text, COGS stayed empty, and the header still counted those units as
-- leftover.

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
  v_was_brokered boolean := false;
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
  if not public.deal_stage_holds_purchased_stock(v_deal.stage)
    or coalesce(v_line.sourcing_mode, 'owned') not in ('owned', 'brokered')
  then raise exception 'invalid_deal_line_assignment'; end if;
  v_was_brokered := coalesce(v_line.sourcing_mode, 'owned') = 'brokered';

  select array_agg(layer.id order by layer.id)
  into v_allowed
  from public.package_cost_layers layer
  left join public.purchase_orders purchase on purchase.id = layer.purchase_order_id
  left join public.suppliers supplier
    on supplier.id = public.inventory_layer_effective_supplier_id(
      layer.supplier_id, purchase.supplier_id
    )
  where public.inventory_layer_is_candidate(layer.id, v_line.package_id)
    and public.inventory_layer_in_supplier_pool(
      layer.supplier_id,
      purchase.supplier_id,
      purchase.supplier,
      layer.source,
      supplier.name,
      v_supplier_id,
      v_supplier_name
    );
  if v_allowed is null then raise exception 'insufficient_supplier_stock'; end if;

  perform 1
  from public.package_cost_layers layer
  where layer.id = any(v_allowed)
    or layer.id in (
      select allocation.cost_layer_id
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id = v_line.id
        and allocation.state <> 'released'
    )
    or layer.id = v_line.fulfilment_cost_layer_id
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

  if v_was_brokered then
    update public.deal_line_items
    set sourcing_mode = 'owned',
        updated_at = timezone('utc', now())
    where id = v_line.id;
    v_line.sourcing_mode := 'owned';
  end if;

  update public.inventory_shortages
  set status = 'cancelled',
      resolved_at = coalesce(resolved_at, timezone('utc', now())),
      updated_at = timezone('utc', now()),
      metadata = metadata || jsonb_build_object(
        'cancel_reason',
        case
          when v_was_brokered then 'Brokered deal adopted onto purchased stock'
          else 'Deal supplier pool changed'
        end
      )
  where deal_line_item_id = v_line.id and status = 'open';

  if v_was_brokered then
    update public.sourcing_shortages
    set status = 'purchased',
        cleared_at = coalesce(cleared_at, timezone('utc', now())),
        updated_at = timezone('utc', now()),
        note = coalesce(note, 'Covered by purchased supplier stock')
    where deal_line_item_id = v_line.id
      and status not in ('purchased', 'cancelled');
  end if;

  v_request_key := 'deal-line-supplier-pool:' || v_line.id::text
    || ':' || gen_random_uuid()::text;
  perform public.inventory_allocate_quantity_from_layers(
    v_line.package_id, v_line.quantity, 'committed',
    'deal_line_supplier_pool_reassignment', v_request_key, v_allowed,
    v_line.deal_id, v_line.id, null, null, null,
    case
      when v_was_brokered then 'Brokered deal adopted onto purchased supplier stock'
      else 'Signed deal supplier reassigned by supplier pool'
    end,
    jsonb_build_object(
      'supplier_key', p_supplier_key,
      'adopted_from_brokered', v_was_brokered
    )
  );

  perform public.inventory_sync_deal_line_shortage(v_line.id);
end;
$$;

comment on function public.inventory_reassign_deal_line_to_supplier(uuid, text) is
  'Assign a signed deal line onto a purchased supplier pool. Brokered lines are converted to owned stock and allocated.';

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
    and coalesce(line.sourcing_mode, 'owned') in ('owned', 'brokered')
    and public.deal_stage_holds_purchased_stock(deal.stage)
  order by line.id
  for update of line;
  get diagnostics v_actual_count = row_count;
  if v_actual_count <> v_expected_count then
    raise exception 'invalid_deal_line_assignment';
  end if;

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

revoke all on function public.inventory_reassign_deal_line_to_supplier(uuid, text)
  from public;
grant execute on function public.inventory_reassign_deal_line_to_supplier(uuid, text)
  to authenticated, service_role;
revoke all on function public.inventory_swap_deal_line_suppliers(jsonb) from public;
grant execute on function public.inventory_swap_deal_line_suppliers(jsonb)
  to authenticated, service_role;

do $$
declare
  v_line record;
  v_supplier_id uuid;
  v_supplier_name text;
  v_supplier_key text;
begin
  for v_line in
    select
      line.id,
      public.inventory_layer_effective_supplier_id(
        layer.supplier_id, purchase.supplier_id
      ) as supplier_id,
      lower(btrim(coalesce(supplier.name, purchase.supplier, layer.source, '')))
        as supplier_name
    from public.deal_line_items line
    join public.deals deal on deal.id = line.deal_id
    join public.package_cost_layers layer
      on layer.id = line.fulfilment_cost_layer_id
    left join public.purchase_orders purchase
      on purchase.id = layer.purchase_order_id
    left join public.suppliers supplier
      on supplier.id = public.inventory_layer_effective_supplier_id(
        layer.supplier_id, purchase.supplier_id
      )
    where coalesce(line.sourcing_mode, 'owned') = 'brokered'
      and public.deal_stage_holds_purchased_stock(deal.stage)
      and deal.stage not in ('closed_lost', 'cancelled')
    order by deal.created_at, line.sort_order, line.id
  loop
    v_supplier_id := v_line.supplier_id;
    v_supplier_name := v_line.supplier_name;
    if v_supplier_id is not null then
      v_supplier_key := 'id:' || v_supplier_id::text;
    elsif v_supplier_name <> '' then
      v_supplier_key := 'name:' || v_supplier_name;
    else
      continue;
    end if;
    begin
      perform public.inventory_reassign_deal_line_to_supplier(
        v_line.id, v_supplier_key
      );
    exception
      when others then
        raise notice 'Could not adopt brokered deal line % onto purchased stock: %',
          v_line.id, sqlerrm;
    end;
  end loop;
end;
$$;
