-- Offline Closed Won pulls (and linked heals) must never set qty_available below qty_held,
-- or package_inventory_held_lte_available rejects the update.

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
      and p.duration in ('friday_only', 'saturday_only', 'sunday_only');
  elsif v_duration = '2_day' then
    update public.package_inventory pi
    set qty_available = greatest(pi.qty_held, pi.qty_available + p_delta)
    from public.packages p
    where pi.package_id = p.id
      and p.inventory_group_id = v_group
      and p.duration in ('saturday_only', 'sunday_only');
  elsif v_duration in ('friday_only', 'saturday_only', 'sunday_only') then
    perform public.reconcile_linked_multi_day_inventory(v_group);
  end if;

  perform public.reconcile_linked_inventory_holds(v_group);
end;
$$;

create or replace function public.apply_linked_group_inventory_sync(
  p_group_id text,
  p_targets jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_group_id is null or p_group_id = '' then
    return;
  end if;
  if p_targets is null or jsonb_typeof(p_targets) <> 'array' then
    return;
  end if;

  perform pg_advisory_xact_lock(88001234);

  update public.package_inventory pi
  set qty_available = greatest(pi.qty_held, greatest(0, (elem->>'qty_available')::int))
  from jsonb_array_elements(p_targets) elem
  where pi.package_id = elem->>'package_id';

  perform public.reconcile_linked_multi_day_inventory(p_group_id);
end;
$$;

revoke all on function public.apply_linked_group_inventory_sync(text, jsonb) from public;
grant execute on function public.apply_linked_group_inventory_sync(text, jsonb) to service_role;
grant execute on function public.adjust_linked_inventory_available(text, int) to service_role;
