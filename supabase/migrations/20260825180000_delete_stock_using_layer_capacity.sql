-- Cost-layer deletion must validate against canonical purchased capacity, not
-- the legacy package_inventory counter. That counter can be stale after
-- historical imports/reassignments and previously blocked fully unused stock.

create or replace function public.admin_delete_cost_layer(p_layer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer record;
  v_request record;
  v_qty_held int;
  v_remaining_capacity int;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  perform 1
  from public.package_cost_layers
  where id = p_layer_id
  for update;
  if not found then
    raise exception 'cost_layer_not_found';
  end if;

  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.cost_layer_id = p_layer_id
      and allocation.state <> 'released'
      and allocation.lock_state = 'mutable'
      and allocation.deal_id is null
      and allocation.deal_line_item_id is null
      and allocation.order_id is null
      and allocation.order_line_item_id is null
      and allocation.reservation_id is null
      and allocation.order_cost_consumption_id is null
    order by allocation.request_key
  loop
    perform public.inventory_release_allocations(
      v_request.request_key,
      'Unused purchase stock deleted after its demand was removed',
      true
    );
  end loop;

  update public.inventory_shortages shortage
  set status = 'cancelled',
      resolved_at = coalesce(shortage.resolved_at, timezone('utc', now())),
      updated_at = timezone('utc', now()),
      metadata = shortage.metadata || jsonb_build_object(
        'cancel_reason',
        'Covering purchase stock deleted after demand was removed'
      )
  from public.inventory_allocations allocation
  where allocation.cost_layer_id = p_layer_id
    and allocation.source = 'historical_shortage_cover'
    and shortage.id::text = allocation.metadata->>'shortage_id'
    and allocation.state = 'released'
    and allocation.deal_id is null
    and allocation.deal_line_item_id is null
    and allocation.order_id is null
    and allocation.order_line_item_id is null;

  if exists (
    select 1
    from public.inventory_allocations allocation
    where allocation.cost_layer_id = p_layer_id
      and allocation.state <> 'released'
  ) then
    raise exception 'layer_has_active_allocations';
  end if;

  select id, package_id, quantity, quantity_remaining
  into v_layer
  from public.package_cost_layers
  where id = p_layer_id
  for update;
  if not found then
    raise exception 'cost_layer_not_found';
  end if;

  if v_layer.quantity_remaining is distinct from v_layer.quantity then
    raise exception 'layer_already_consumed';
  end if;

  if exists (
    select 1
    from public.order_cost_consumptions
    where cost_layer_id = p_layer_id
  ) then
    raise exception 'layer_already_consumed';
  end if;

  perform set_config('inventory.component_stock_delete', 'on', true);

  if public.package_uses_shared_three_day_ledger(v_layer.package_id) then
    delete from public.package_cost_layers where id = p_layer_id;
    perform set_config('inventory.component_stock_delete', 'off', true);
    return;
  end if;

  perform public.lock_package_inventory(v_layer.package_id);

  select coalesce(sum(layer.quantity), 0)::int
  into v_remaining_capacity
  from public.package_cost_layers layer
  where layer.package_id = v_layer.package_id
    and layer.id <> p_layer_id;

  select coalesce(inventory.qty_held, 0)::int
  into v_qty_held
  from public.package_inventory inventory
  where inventory.package_id = v_layer.package_id
  for update;
  v_qty_held := coalesce(v_qty_held, 0);

  if v_remaining_capacity < v_qty_held then
    raise exception 'qty_held_would_exceed_capacity';
  end if;

  delete from public.package_cost_layers
  where id = p_layer_id;

  update public.package_inventory
  set qty_available = greatest(qty_held, v_remaining_capacity)
  where package_id = v_layer.package_id;

  perform public.reconcile_package_holds(v_layer.package_id);
  perform set_config('inventory.component_stock_delete', 'off', true);
end;
$$;

revoke all on function public.admin_delete_cost_layer(uuid) from public;
grant execute on function public.admin_delete_cost_layer(uuid) to authenticated;
