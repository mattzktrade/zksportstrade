-- Make cost-layer quantity edits linked-inventory aware.
-- Previously this only adjusted the edited package row, which could desync linked
-- 2-day / 3-day / single-day availability when correcting purchased quantities.

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
  v_pkg record;
  v_consumed int;
  v_delta int;
  r record;
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

  select id, duration, inventory_group_id
  into v_pkg
  from public.packages
  where id = v_layer.package_id;
  if not found then
    raise exception 'package_not_found';
  end if;

  if v_pkg.inventory_group_id is null
     or v_pkg.duration not in ('3_day', '2_day', 'friday_only', 'saturday_only', 'sunday_only') then
    perform public.reconcile_package_holds(v_pkg.id);

    for r in
      select qty_available, qty_held
      from public.package_inventory
      where package_id = v_pkg.id
      for update
    loop
      if (r.qty_available + v_delta) < r.qty_held then
        raise exception 'would_drop_below_holds';
      end if;
      if (r.qty_available + v_delta) < 0 then
        raise exception 'inventory_negative';
      end if;
    end loop;

    update public.package_cost_layers
    set quantity = p_new_quantity,
        quantity_remaining = quantity_remaining + v_delta
    where id = p_layer_id;

    update public.package_inventory
    set qty_available = qty_available + v_delta
    where package_id = v_pkg.id;

    perform public.reconcile_package_holds(v_pkg.id);
    return;
  end if;

  perform public.reconcile_linked_inventory_holds(v_pkg.inventory_group_id);

  for r in
    select pi.package_id, pi.qty_available, pi.qty_held
    from public.package_inventory pi
    join public.packages p on p.id = pi.package_id
    where p.inventory_group_id = v_pkg.inventory_group_id
      and (
        p.id = v_pkg.id
        or (v_pkg.duration = '3_day' and p.duration in ('friday_only', 'saturday_only', 'sunday_only'))
        or (v_pkg.duration = '2_day' and p.duration in ('saturday_only', 'sunday_only'))
      )
    for update of pi
  loop
    if (r.qty_available + v_delta) < r.qty_held then
      raise exception 'would_drop_below_holds';
    end if;
    if (r.qty_available + v_delta) < 0 then
      raise exception 'inventory_negative';
    end if;
  end loop;

  update public.package_cost_layers
  set quantity = p_new_quantity,
      quantity_remaining = quantity_remaining + v_delta
  where id = p_layer_id;

  update public.package_inventory pi
  set qty_available = pi.qty_available + v_delta
  from public.packages p
  where pi.package_id = p.id
    and p.inventory_group_id = v_pkg.inventory_group_id
    and (
      p.id = v_pkg.id
      or (v_pkg.duration = '3_day' and p.duration in ('friday_only', 'saturday_only', 'sunday_only'))
      or (v_pkg.duration = '2_day' and p.duration in ('saturday_only', 'sunday_only'))
    );

  perform public.reconcile_linked_multi_day_inventory(v_pkg.inventory_group_id);
  perform public.reconcile_linked_inventory_holds(v_pkg.inventory_group_id);
end;
$$;

revoke all on function public.admin_update_cost_layer_quantity(uuid, int) from public;
grant execute on function public.admin_update_cost_layer_quantity(uuid, int) to authenticated;
