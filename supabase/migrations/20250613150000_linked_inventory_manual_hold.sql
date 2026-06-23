-- Manual admin holds on linked inventory groups apply to the whole shared pool.

create or replace function public.admin_set_package_qty_held(
  p_package_id text,
  p_qty_held int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group text;
  r record;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if p_qty_held is null or p_qty_held < 0 then
    raise exception 'invalid_qty_held';
  end if;

  select inventory_group_id
  into v_group
  from public.packages
  where id = p_package_id;

  if not found then
    raise exception 'package_not_found';
  end if;

  if v_group is null then
    if p_qty_held > (
      select coalesce(pi.qty_available, 0)
      from public.package_inventory pi
      where pi.package_id = p_package_id
    ) then
      raise exception 'held_exceeds_available';
    end if;

    update public.package_inventory
    set qty_held = p_qty_held
    where package_id = p_package_id;
    return;
  end if;

  for r in
    select p.id as package_id, coalesce(pi.qty_available, 0) as qty_available
    from public.packages p
    join public.package_inventory pi on pi.package_id = p.id
    where p.inventory_group_id = v_group
  loop
    if p_qty_held > r.qty_available then
      raise exception 'held_exceeds_available';
    end if;
  end loop;

  update public.package_inventory pi
  set qty_held = p_qty_held
  from public.packages p
  where pi.package_id = p.id
    and p.inventory_group_id = v_group;
end;
$$;

revoke all on function public.admin_set_package_qty_held(text, int) from public;
grant execute on function public.admin_set_package_qty_held(text, int) to authenticated;
