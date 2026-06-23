-- Admin cancel: mark order cancelled, restore inventory + cost layers (do not delete rows).

create or replace function public.admin_cancel_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_cons record;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if p_order_id is null then
    raise exception 'order_id_required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'already_cancelled';
  end if;

  for v_cons in
    select cost_layer_id, quantity
    from public.order_cost_consumptions
    where order_id = p_order_id
  loop
    if v_cons.cost_layer_id is not null then
      update public.package_cost_layers
      set quantity_remaining = quantity_remaining + v_cons.quantity
      where id = v_cons.cost_layer_id;
    end if;
  end loop;

  delete from public.order_cost_consumptions where order_id = p_order_id;

  perform public.lock_package_inventory(v_order.package_id);
  perform public.adjust_linked_inventory_available(v_order.package_id, v_order.guests);

  update public.orders
  set status = 'cancelled'
  where id = p_order_id;

  return jsonb_build_object(
    'order_id', p_order_id,
    'order_reference', v_order.reference,
    'package_id', v_order.package_id,
    'guests_restored', v_order.guests
  );
end;
$$;

revoke all on function public.admin_cancel_order(uuid) from public;
grant execute on function public.admin_cancel_order(uuid) to authenticated;
