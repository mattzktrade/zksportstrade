-- Selling a 2-day package must drop Saturday, Sunday, and the 3-day pool.
-- Selling a 3-day package must drop the 2-day pool as well. Call reconcile
-- after combo adjustments so min(day) stays authoritative when day siblings exist.

create or replace function public.adjust_linked_inventory_available(
  p_package_id text,
  p_delta int
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_group text;
  v_duration text;
begin
  select inventory_group_id, duration
  into v_group, v_duration
  from public.packages
  where id = p_package_id;

  if v_group is null then
    perform public.reconcile_package_holds(p_package_id);

    update public.package_inventory
    set qty_available = greatest(qty_held, qty_available + p_delta)
    where package_id = p_package_id;

    perform public.reconcile_package_holds(p_package_id);
    return;
  end if;

  perform public.reconcile_linked_inventory_holds(v_group);

  update public.package_inventory
  set qty_available = greatest(qty_held, qty_available + p_delta)
  where package_id = p_package_id;

  if v_duration = '3_day' then
    update public.package_inventory pi
    set qty_available = greatest(pi.qty_held, pi.qty_available + p_delta)
    from public.packages p
    where pi.package_id = p.id
      and p.inventory_group_id = v_group
      and p.shell_parent_package_id is null
      and p.duration in ('friday_only', 'saturday_only', 'sunday_only', '2_day');
    perform public.reconcile_linked_multi_day_inventory(v_group);
  elsif v_duration = '2_day' then
    update public.package_inventory pi
    set qty_available = greatest(pi.qty_held, pi.qty_available + p_delta)
    from public.packages p
    where pi.package_id = p.id
      and p.inventory_group_id = v_group
      and p.shell_parent_package_id is null
      and p.duration in ('saturday_only', 'sunday_only', '3_day');
    perform public.reconcile_linked_multi_day_inventory(v_group);
  elsif v_duration in ('thursday_only', 'friday_only', 'saturday_only', 'sunday_only') then
    perform public.reconcile_linked_multi_day_inventory(v_group);
  end if;

  perform public.reconcile_linked_inventory_holds(v_group);
end;
$$;

revoke all on function public.adjust_linked_inventory_available(text, int) from public;
grant execute on function public.adjust_linked_inventory_available(text, int) to authenticated;
grant execute on function public.adjust_linked_inventory_available(text, int) to service_role;
