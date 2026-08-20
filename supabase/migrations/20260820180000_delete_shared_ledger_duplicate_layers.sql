-- Linked day / 2-day products share the 3-day purchase ledger. Duplicate cost
-- layers on those splits must not reduce the shared pool when deleted — they
-- were imported as extra ledgers, not extra physical stock.

create or replace function public.package_uses_shared_three_day_ledger(p_package_id text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.packages split
    join public.packages parent
      on parent.inventory_group_id = split.inventory_group_id
     and parent.duration = '3_day'
     and parent.shell_parent_package_id is null
    join public.package_cost_layers parent_layer
      on parent_layer.package_id = parent.id
    where split.id = p_package_id
      and split.inventory_group_id is not null
      and split.shell_parent_package_id is null
      and split.duration is distinct from '3_day'
  );
$$;

create or replace function public.admin_delete_cost_layer(p_layer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer record;
  v_qty_held int;
  v_qty_available int;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
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

  if exists (select 1 from public.order_cost_consumptions where cost_layer_id = p_layer_id) then
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
    perform public.adjust_linked_inventory_available(v_layer.package_id, -v_layer.quantity);
  end if;

  delete from public.package_cost_layers where id = p_layer_id;
end;
$$;

revoke all on function public.package_uses_shared_three_day_ledger(text) from public;
grant execute on function public.package_uses_shared_three_day_ledger(text) to authenticated;

revoke all on function public.admin_delete_cost_layer(uuid) from public;
grant execute on function public.admin_delete_cost_layer(uuid) to authenticated;
