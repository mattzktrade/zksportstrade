-- Released allocations remain permanent audit records even when an unused
-- purchase layer is deleted. Only released rows may outlive their cost layer.

alter table public.inventory_allocations
  drop constraint if exists inventory_allocations_cost_layer_id_fkey;

alter table public.inventory_allocations
  alter column cost_layer_id drop not null;

alter table public.inventory_allocations
  add constraint inventory_allocations_cost_layer_id_fkey
  foreign key (cost_layer_id)
  references public.package_cost_layers(id)
  on delete set null;

alter table public.inventory_allocations
  drop constraint if exists inventory_allocations_active_layer_required;

alter table public.inventory_allocations
  add constraint inventory_allocations_active_layer_required
  check (state = 'released' or cost_layer_id is not null);

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

  -- A deleted deal/order leaves SET NULL business references. Mutable
  -- allocations with no remaining demand are safe to release.
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

  if public.package_uses_shared_three_day_ledger(v_layer.package_id) then
    delete from public.package_cost_layers where id = p_layer_id;
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
end;
$$;

revoke all on function public.admin_delete_cost_layer(uuid) from public;
grant execute on function public.admin_delete_cost_layer(uuid) to authenticated;
