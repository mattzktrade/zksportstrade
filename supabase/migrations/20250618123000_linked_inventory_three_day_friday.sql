-- 3-day packages consume Friday, Saturday, and Sunday single-ticket pools.

create or replace function public.reconcile_linked_multi_day_inventory(p_group_id text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_two_day_min int;
  v_three_day_min int;
begin
  if p_group_id is null then
    return;
  end if;

  select min(pi.qty_available)
  into v_two_day_min
  from public.packages p
  join public.package_inventory pi on pi.package_id = p.id
  where p.inventory_group_id = p_group_id
    and p.duration in ('saturday_only', 'sunday_only');

  if v_two_day_min is not null then
    update public.package_inventory pi
    set qty_available = v_two_day_min
    from public.packages p
    where pi.package_id = p.id
      and p.inventory_group_id = p_group_id
      and p.duration = '2_day';
  end if;

  select min(pi.qty_available)
  into v_three_day_min
  from public.packages p
  join public.package_inventory pi on pi.package_id = p.id
  where p.inventory_group_id = p_group_id
    and p.duration in ('friday_only', 'saturday_only', 'sunday_only');

  if v_three_day_min is not null then
    update public.package_inventory pi
    set qty_available = v_three_day_min
    from public.packages p
    where pi.package_id = p.id
      and p.inventory_group_id = p_group_id
      and p.duration = '3_day';
  end if;
end;
$$;

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
  update public.package_inventory
  set qty_available = qty_available + p_delta
  where package_id = p_package_id;

  select inventory_group_id, duration
  into v_group, v_duration
  from public.packages
  where id = p_package_id;

  if v_group is null then
    return;
  end if;

  if v_duration = '3_day' then
    update public.package_inventory pi
    set qty_available = pi.qty_available + p_delta
    from public.packages p
    where pi.package_id = p.id
      and p.inventory_group_id = v_group
      and p.duration in ('friday_only', 'saturday_only', 'sunday_only');
  elsif v_duration = '2_day' then
    update public.package_inventory pi
    set qty_available = pi.qty_available + p_delta
    from public.packages p
    where pi.package_id = p.id
      and p.inventory_group_id = v_group
      and p.duration in ('saturday_only', 'sunday_only');
  elsif v_duration in ('friday_only', 'saturday_only', 'sunday_only') then
    perform public.reconcile_linked_multi_day_inventory(v_group);
  end if;
end;
$$;

create or replace function public.linked_inventory_sellable(
  p_package_id text,
  p_agent_profile_id uuid
)
returns int
language plpgsql
stable
set search_path = public
as $$
declare
  v_duration text;
  v_group text;
  v_my_hold int;
  v_avail int;
  v_held int;
  v_fri_sellable int;
  v_sat_sellable int;
  v_sun_sellable int;
  r record;
begin
  select duration, inventory_group_id
  into v_duration, v_group
  from public.packages
  where id = p_package_id;

  if v_group is not null and v_duration in ('2_day', '3_day') then
    v_fri_sellable := null;
    v_sat_sellable := null;
    v_sun_sellable := null;

    for r in
      select p.id, p.duration, pi.qty_available, pi.qty_held
      from public.packages p
      join public.package_inventory pi on pi.package_id = p.id
      where p.inventory_group_id = v_group
        and p.duration in ('friday_only', 'saturday_only', 'sunday_only')
    loop
      select coalesce(sum(h.quantity), 0)::int
      into v_my_hold
      from public.inventory_holds h
      where h.package_id = r.id
        and h.agent_profile_id = p_agent_profile_id
        and h.released_at is null
        and h.expires_at > timezone('utc', now());

      if r.duration = 'friday_only' then
        v_fri_sellable := (r.qty_available - r.qty_held) + v_my_hold;
      elsif r.duration = 'saturday_only' then
        v_sat_sellable := (r.qty_available - r.qty_held) + v_my_hold;
      elsif r.duration = 'sunday_only' then
        v_sun_sellable := (r.qty_available - r.qty_held) + v_my_hold;
      end if;
    end loop;

    if v_duration = '2_day' and v_sat_sellable is not null and v_sun_sellable is not null then
      return least(v_sat_sellable, v_sun_sellable);
    end if;

    if v_duration = '3_day' and v_fri_sellable is not null and v_sat_sellable is not null and v_sun_sellable is not null then
      return least(v_fri_sellable, v_sat_sellable, v_sun_sellable);
    end if;
  end if;

  select coalesce(sum(h.quantity), 0)::int
  into v_my_hold
  from public.inventory_holds h
  where h.package_id = p_package_id
    and h.agent_profile_id = p_agent_profile_id
    and h.released_at is null
    and h.expires_at > timezone('utc', now());

  select pi.qty_available, pi.qty_held
  into v_avail, v_held
  from public.package_inventory pi
  where pi.package_id = p_package_id;

  return coalesce(v_avail, 0) - coalesce(v_held, 0) + v_my_hold;
end;
$$;

select public.reconcile_linked_multi_day_inventory(g.inventory_group_id)
from (
  select distinct inventory_group_id
  from public.packages
  where inventory_group_id is not null
) g;
