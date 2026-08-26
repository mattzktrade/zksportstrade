-- Reducing purchased quantity must keep quantity_remaining <= quantity in the
-- same UPDATE. The previous rewrite set quantity first and recomputed remaining
-- afterwards, so shrinking a layer (28 → 14) hit
-- package_cost_layers_remaining_lte_quantity before remaining could follow.
-- Recompute from day components is unchanged, but must not zero remaining on
-- layers that have no components.

create or replace function public.inventory_recompute_layer_remaining(
  p_cost_layer_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining int;
  v_has_components boolean;
begin
  select exists (
    select 1
    from public.package_cost_layer_day_components component
    where component.cost_layer_id = p_cost_layer_id
  )
  into v_has_components;

  if not coalesce(v_has_components, false) then
    select coalesce(layer.quantity_remaining, 0)
    into v_remaining
    from public.package_cost_layers layer
    where layer.id = p_cost_layer_id;
    return coalesce(v_remaining, 0);
  end if;

  select coalesce(min(floor(
    component.quantity_remaining::numeric / component.units_per_package
  )), 0)::int
  into v_remaining
  from public.package_cost_layer_day_components component
  where component.cost_layer_id = p_cost_layer_id;

  perform set_config('inventory.component_remaining_write', 'on', true);
  update public.package_cost_layers
  set quantity_remaining = greatest(v_remaining, 0),
      updated_at = timezone('utc', now())
  where id = p_cost_layer_id;
  perform set_config('inventory.component_remaining_write', 'off', true);
  return greatest(v_remaining, 0);
end;
$$;

create or replace function public.admin_update_cost_layer_quantity(
  p_layer_id uuid,
  p_new_quantity int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer public.package_cost_layers%rowtype;
  v_component record;
  v_delta int;
  v_reserved int;
  v_has_components boolean;
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'invalid_quantity';
  end if;

  select * into v_layer
  from public.package_cost_layers layer
  where layer.id = p_layer_id
  for update;
  if not found then raise exception 'cost_layer_not_found'; end if;

  perform 1
  from public.package_cost_layer_day_components component
  where component.cost_layer_id = p_layer_id
  order by component.day_slot
  for update;

  v_delta := p_new_quantity - v_layer.quantity;
  if v_delta = 0 then return; end if;

  v_reserved := public.inventory_layer_reserved_quantity(p_layer_id);
  if v_layer.quantity_remaining + v_delta < v_reserved then
    raise exception 'quantity_below_consumed_or_reserved';
  end if;

  select exists (
    select 1
    from public.package_cost_layer_day_components component
    where component.cost_layer_id = p_layer_id
  )
  into v_has_components;

  for v_component in
    select component.*
    from public.package_cost_layer_day_components component
    where component.cost_layer_id = p_layer_id
    order by component.day_slot
  loop
    select coalesce(sum(allocation_component.requested_units), 0)::int
    into v_reserved
    from public.inventory_allocation_day_components allocation_component
    join public.inventory_allocations allocation
      on allocation.id = allocation_component.allocation_id
    where allocation_component.cost_layer_day_component_id = v_component.id
      and allocation.state = 'reserved';

    if v_component.quantity_total + v_delta * v_component.units_per_package < 0
      or v_component.quantity_remaining
        + v_delta * v_component.units_per_package < v_reserved
    then
      raise exception 'quantity_below_consumed_or_reserved:%',
        v_component.day_slot;
    end if;

    update public.package_cost_layer_day_components
    set quantity_total =
          quantity_total + v_delta * v_component.units_per_package,
        quantity_remaining =
          quantity_remaining + v_delta * v_component.units_per_package
    where id = v_component.id;
  end loop;

  perform set_config('inventory.component_remaining_write', 'on', true);
  update public.package_cost_layers
  set quantity = p_new_quantity,
      quantity_remaining = quantity_remaining + v_delta,
      updated_at = timezone('utc', now())
  where id = p_layer_id;
  perform set_config('inventory.component_remaining_write', 'off', true);

  if coalesce(v_has_components, false) then
    perform public.inventory_recompute_layer_remaining(p_layer_id);
  end if;

  perform public.adjust_linked_inventory_available(v_layer.package_id, v_delta);
  perform public.assert_inventory_layer_component_capacity(p_layer_id);
end;
$$;

revoke all on function public.inventory_recompute_layer_remaining(uuid) from public;
grant execute on function public.inventory_recompute_layer_remaining(uuid)
  to authenticated, service_role;
revoke all on function public.admin_update_cost_layer_quantity(uuid, int)
  from public;
grant execute on function public.admin_update_cost_layer_quantity(uuid, int)
  to authenticated, service_role;
