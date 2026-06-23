-- Make admin stock additions explicitly increase the selected package and its linked pool.

create or replace function public.admin_add_cost_layer(
  p_package_id text,
  p_quantity int,
  p_unit_cost numeric,
  p_currency text default null,
  p_note text default null,
  p_received_at timestamptz default null,
  p_source text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer_id uuid;
  v_currency text;
  v_received timestamptz;
  v_pkg_currency text;
  v_group text;
  v_duration text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'invalid_unit_cost';
  end if;

  select
    coalesce(nullif(btrim(pk.currency), ''), 'USD'),
    pk.inventory_group_id,
    pk.duration
  into v_pkg_currency, v_group, v_duration
  from public.packages pk
  where pk.id = p_package_id;
  if not found then
    raise exception 'package_not_found';
  end if;

  v_currency := coalesce(nullif(btrim(p_currency), ''), v_pkg_currency);
  v_received := coalesce(p_received_at, now());

  if not exists (select 1 from public.package_inventory pi where pi.package_id = p_package_id) then
    insert into public.package_inventory (package_id, qty_available, qty_held)
    values (p_package_id, 0, 0);
  end if;

  if v_group is null then
    perform public.reconcile_package_holds(p_package_id);
    perform public.lock_package_inventory(p_package_id);
  else
    perform public.reconcile_linked_inventory_holds(v_group);
    perform public.lock_package_inventory(p.id)
    from public.packages p
    where p.inventory_group_id = v_group;
  end if;

  insert into public.package_cost_layers (
    package_id, quantity, quantity_remaining, unit_cost, currency, note, source, received_at, created_by
  )
  values (
    p_package_id,
    p_quantity,
    p_quantity,
    p_unit_cost,
    v_currency,
    nullif(btrim(p_note), ''),
    nullif(btrim(p_source), ''),
    v_received,
    auth.uid()
  )
  returning id into v_layer_id;

  if v_group is null then
    update public.package_inventory
    set qty_available = qty_available + p_quantity
    where package_id = p_package_id;

    perform public.reconcile_package_holds(p_package_id);
    return v_layer_id;
  end if;

  if v_duration = '3_day' then
    update public.package_inventory pi
    set qty_available = pi.qty_available + p_quantity
    from public.packages p
    where pi.package_id = p.id
      and p.inventory_group_id = v_group
      and p.duration in ('3_day', 'friday_only', 'saturday_only', 'sunday_only');

    perform public.reconcile_linked_multi_day_inventory(v_group);
  elsif v_duration = '2_day' then
    update public.package_inventory pi
    set qty_available = pi.qty_available + p_quantity
    from public.packages p
    where pi.package_id = p.id
      and p.inventory_group_id = v_group
      and p.duration in ('2_day', 'saturday_only', 'sunday_only');

    perform public.reconcile_linked_multi_day_inventory(v_group);
  elsif v_duration in ('friday_only', 'saturday_only', 'sunday_only') then
    update public.package_inventory
    set qty_available = qty_available + p_quantity
    where package_id = p_package_id;

    perform public.reconcile_linked_multi_day_inventory(v_group);
  else
    update public.package_inventory
    set qty_available = qty_available + p_quantity
    where package_id = p_package_id;
  end if;

  perform public.reconcile_linked_inventory_holds(v_group);
  return v_layer_id;
end;
$$;

revoke all on function public.admin_add_cost_layer(text, int, numeric, text, text, timestamptz, text) from public;
grant execute on function public.admin_add_cost_layer(text, int, numeric, text, text, timestamptz, text) to authenticated;
