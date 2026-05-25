-- Allow admins to amend the original purchased quantity on a cost layer.
-- Adjusts package_cost_layers.quantity, layer.quantity_remaining (by the same delta),
-- and package_inventory.qty_available so available stock stays in sync.

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
  v_layer record;
  v_consumed int;
  v_delta int;
  v_qty_available int;
  v_qty_held int;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'invalid_quantity';
  end if;

  select id, package_id, quantity, quantity_remaining
  into v_layer
  from public.package_cost_layers
  where id = p_layer_id
  for update;
  if not found then
    raise exception 'cost_layer_not_found';
  end if;

  v_consumed := v_layer.quantity - v_layer.quantity_remaining;
  if p_new_quantity < v_consumed then
    raise exception 'quantity_below_consumed';
  end if;

  v_delta := p_new_quantity - v_layer.quantity;
  if v_delta = 0 then
    return;
  end if;

  select qty_available, qty_held
  into v_qty_available, v_qty_held
  from public.package_inventory
  where package_id = v_layer.package_id
  for update;
  if not found then
    raise exception 'inventory_missing';
  end if;

  if (v_qty_available + v_delta) < v_qty_held then
    raise exception 'would_drop_below_holds';
  end if;
  if (v_qty_available + v_delta) < 0 then
    raise exception 'inventory_negative';
  end if;

  update public.package_cost_layers
  set quantity = p_new_quantity,
      quantity_remaining = quantity_remaining + v_delta
  where id = p_layer_id;

  update public.package_inventory
  set qty_available = qty_available + v_delta
  where package_id = v_layer.package_id;
end;
$$;

revoke all on function public.admin_update_cost_layer_quantity(uuid, int) from public;
grant execute on function public.admin_update_cost_layer_quantity(uuid, int) to authenticated;
