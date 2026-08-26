-- Deleting a stock purchase from a product must not leave an empty purchase
-- order shell behind. Keep a multi-product PO until its final layer is removed.

create or replace function public.admin_delete_cost_layer_and_empty_purchase_order(
  p_layer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_order_id uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select layer.purchase_order_id
  into v_purchase_order_id
  from public.package_cost_layers layer
  where layer.id = p_layer_id
  for update;

  if not found then
    raise exception 'cost_layer_not_found';
  end if;

  perform public.admin_delete_cost_layer(p_layer_id);

  if v_purchase_order_id is not null
    and not exists (
      select 1
      from public.package_cost_layers layer
      where layer.purchase_order_id = v_purchase_order_id
    )
  then
    delete from public.purchase_orders
    where id = v_purchase_order_id;
  end if;
end;
$$;

revoke all on function public.admin_delete_cost_layer_and_empty_purchase_order(uuid) from public;
grant execute on function public.admin_delete_cost_layer_and_empty_purchase_order(uuid) to authenticated;
