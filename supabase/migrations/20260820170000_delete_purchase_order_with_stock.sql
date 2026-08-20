-- Deleting a purchase order also removes its unused stock layers and the
-- inventory those layers added. Sold / held stock still blocks the delete.

create or replace function public.admin_delete_purchase_order(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer record;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if not exists (select 1 from public.purchase_orders where id = p_id) then
    raise exception 'purchase_order_not_found';
  end if;

  if exists (
    select 1
    from public.package_cost_layers
    where purchase_order_id = p_id
      and quantity_remaining is distinct from quantity
  ) or exists (
    select 1
    from public.package_cost_layers layer
    join public.order_cost_consumptions consumed on consumed.cost_layer_id = layer.id
    where layer.purchase_order_id = p_id
  ) then
    raise exception 'purchase_order_stock_sold';
  end if;

  for v_layer in
    select id
    from public.package_cost_layers
    where purchase_order_id = p_id
    order by created_at, id
  loop
    perform public.admin_delete_cost_layer(v_layer.id);
  end loop;

  delete from public.purchase_orders where id = p_id;
  if not found then
    raise exception 'purchase_order_not_found';
  end if;
end;
$$;
