-- Preserve frozen day-cost and restatement snapshots when their source stock
-- layer is deleted. The FK's ON DELETE SET NULL is an audit-preserving change,
-- but the immutable-row triggers must permit that change only inside the
-- controlled admin stock-deletion transaction.

create or replace function public.guard_frozen_cost_layer_day_component()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('inventory.component_cost_restatement', true) = 'on' then
    return new;
  end if;
  if current_setting('inventory.component_stock_delete', true) = 'on'
    and tg_op = 'UPDATE'
    and new.cost_layer_id is null
    and old.cost_layer_id is not null
  then
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

create or replace function public.prevent_inventory_component_audit_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'inventory_cost_restatement_events'
    and current_setting('inventory.component_stock_delete', true) = 'on'
    and tg_op = 'UPDATE'
    and new.cost_layer_id is null
    and old.cost_layer_id is not null
  then
    return new;
  end if;
  raise exception 'inventory_component_audit_rows_are_append_only';
end;
$$;

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
  v_qty_available int;
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

  select qty_available, qty_held
  into v_qty_available, v_qty_held
  from public.package_inventory
  where package_id = v_layer.package_id;

  if found then
    if (v_qty_available - v_layer.quantity) < v_qty_held then
      raise exception 'qty_held_would_exceed_capacity';
    end if;
    perform public.adjust_linked_inventory_available(
      v_layer.package_id,
      -v_layer.quantity
    );
  end if;

  delete from public.package_cost_layers where id = p_layer_id;
  perform set_config('inventory.component_stock_delete', 'off', true);
end;
$$;

revoke all on function public.admin_delete_cost_layer(uuid) from public;
grant execute on function public.admin_delete_cost_layer(uuid) to authenticated;
