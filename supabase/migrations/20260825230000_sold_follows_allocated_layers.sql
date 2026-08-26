-- Sold / remaining must follow committed allocations, not FIFO leftover on
-- the oldest purchase. Split parties across two BAM lots left
-- fulfilment_cost_layer_id null, so the leftover 4 units stuck on the
-- imported abc layer even after every deal was assigned to BAM.

create or replace function public.inventory_reconcile_layer_remaining_from_allocations(
  p_layer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_components boolean;
  v_consumed int;
begin
  perform 1
  from public.package_cost_layers layer
  where layer.id = p_layer_id
  for update;
  if not found then return; end if;

  perform 1
  from public.package_cost_layer_day_components component
  where component.cost_layer_id = p_layer_id
  order by component.day_slot
  for update;

  select exists (
    select 1
    from public.package_cost_layer_day_components component
    where component.cost_layer_id = p_layer_id
  )
  into v_has_components;

  if v_has_components then
    update public.package_cost_layer_day_components component
    set quantity_remaining = greatest(
      0,
      least(
        component.quantity_total,
        component.quantity_total - coalesce((
          select sum(allocation_component.consumed_units)::int
          from public.inventory_allocation_day_components allocation_component
          join public.inventory_allocations allocation
            on allocation.id = allocation_component.allocation_id
          where allocation_component.cost_layer_day_component_id = component.id
            and allocation.state = 'committed'
        ), 0)
      )
    )
    where component.cost_layer_id = p_layer_id;
    perform public.inventory_recompute_layer_remaining(p_layer_id);
  else
    select coalesce(sum(allocation.quantity), 0)::int
    into v_consumed
    from public.inventory_allocations allocation
    where allocation.cost_layer_id = p_layer_id
      and allocation.state = 'committed';

    perform set_config('inventory.component_remaining_write', 'on', true);
    update public.package_cost_layers
    set quantity_remaining = greatest(0, quantity - v_consumed),
        updated_at = timezone('utc', now())
    where id = p_layer_id;
    perform set_config('inventory.component_remaining_write', 'off', true);
  end if;

  perform public.assert_inventory_layer_capacity(p_layer_id);
end;
$$;

create or replace function public.inventory_reconcile_candidate_layers(
  p_package_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer_id uuid;
begin
  for v_layer_id in
    select layer.id
    from public.package_cost_layers layer
    where public.inventory_layer_is_candidate(layer.id, p_package_id)
    order by layer.id
  loop
    perform public.inventory_reconcile_layer_remaining_from_allocations(v_layer_id);
  end loop;
end;
$$;

do $$
declare
  v_layer record;
begin
  for v_layer in
    select layer.id
    from public.package_cost_layers layer
    order by layer.id
  loop
    perform public.inventory_reconcile_layer_remaining_from_allocations(v_layer.id);
  end loop;
end;
$$;

revoke all on function public.inventory_reconcile_layer_remaining_from_allocations(uuid)
  from public;
grant execute on function public.inventory_reconcile_layer_remaining_from_allocations(uuid)
  to authenticated, service_role;
revoke all on function public.inventory_reconcile_candidate_layers(text)
  from public;
grant execute on function public.inventory_reconcile_candidate_layers(text)
  to authenticated, service_role;
