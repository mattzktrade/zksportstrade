-- Link 3-day packages with Saturday/Sunday splits; improve group id derivation for admin-created ids.

-- Backfill duration from display names where admin left duration blank on create.
update public.packages
set duration = case
  when name ~* '3\s*day' then '3_day'
  when name ~* '2\s*day' or name ~* 'saturday\s*(?:&|and)\s*sunday' then '2_day'
  when name ~* 'saturday\s+only' or name ~* '^saturday' then 'saturday_only'
  when name ~* 'sunday\s+only' or name ~* '^sunday' then 'sunday_only'
  when name ~* 'friday\s+only' or name ~* '^friday' then 'friday_only'
  when name ~* 'thursday\s+only' or name ~* '^thursday' then 'thursday_only'
  else duration
end
where duration is null or btrim(duration) = '';

create or replace function public.derive_inventory_group_id(
  p_package_id text,
  p_duration text,
  p_race_id text
)
returns text
language plpgsql
immutable
as $$
declare
  v_base text;
  v_suffixes text[] := array[
    '-saturday-only', '-sunday-only', '-friday-only', '-thursday-only',
    '-sun-sat', '-sat-sun',
    '-3-days', '-3-day', '-3days',
    '-2-days', '-2-day', '-2day',
    '-sunday', '-saturday', '-friday', '-thursday'
  ];
  v_s text;
begin
  if p_duration is null or btrim(p_duration) = '' then
    return null;
  end if;
  if p_duration not in ('3_day', '2_day', 'thursday_only', 'friday_only', 'saturday_only', 'sunday_only') then
    return null;
  end if;

  v_base := regexp_replace(p_package_id, '-\d{4}$', '');

  foreach v_s in array v_suffixes loop
    if v_base like '%' || v_s then
      v_base := left(v_base, length(v_base) - length(v_s));
      exit;
    end if;
  end loop;

  v_base := regexp_replace(v_base, '-3-days?-', '-', 'g');
  v_base := regexp_replace(v_base, '-3-days?$', '', 'g');
  v_base := regexp_replace(v_base, '-3days-', '-', 'g');
  v_base := regexp_replace(v_base, '-3days$', '', 'g');
  v_base := regexp_replace(v_base, '-2-days?-', '-', 'g');
  v_base := regexp_replace(v_base, '-2-days?$', '', 'g');
  v_base := regexp_replace(v_base, '-+', '-', 'g');
  v_base := trim(both '-' from v_base);

  if v_base = '' then
    return null;
  end if;

  return p_race_id || '/' || v_base;
end;
$$;

-- 2-day and 3-day availability = min(Saturday, Sunday) in the same group
create or replace function public.reconcile_linked_multi_day_inventory(p_group_id text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_min int;
begin
  if p_group_id is null then
    return;
  end if;

  select min(pi.qty_available)
  into v_min
  from public.packages p
  join public.package_inventory pi on pi.package_id = p.id
  where p.inventory_group_id = p_group_id
    and p.duration in ('saturday_only', 'sunday_only');

  if v_min is null then
    return;
  end if;

  update public.package_inventory pi
  set qty_available = v_min
  from public.packages p
  where pi.package_id = p.id
    and p.inventory_group_id = p_group_id
    and p.duration in ('2_day', '3_day');
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

  if v_duration in ('2_day', '3_day') then
    update public.package_inventory pi
    set qty_available = pi.qty_available + p_delta
    from public.packages p
    where pi.package_id = p.id
      and p.inventory_group_id = v_group
      and p.duration in ('saturday_only', 'sunday_only');
  elsif v_duration in ('saturday_only', 'sunday_only') then
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
  v_sat_sellable int;
  v_sun_sellable int;
  r record;
begin
  select duration, inventory_group_id
  into v_duration, v_group
  from public.packages
  where id = p_package_id;

  if v_group is not null and v_duration in ('2_day', '3_day') then
    v_sat_sellable := null;
    v_sun_sellable := null;

    for r in
      select p.id, p.duration, pi.qty_available, pi.qty_held
      from public.packages p
      join public.package_inventory pi on pi.package_id = p.id
      where p.inventory_group_id = v_group
        and p.duration in ('saturday_only', 'sunday_only')
    loop
      select coalesce(sum(h.quantity), 0)::int
      into v_my_hold
      from public.inventory_holds h
      where h.package_id = r.id
        and h.agent_profile_id = p_agent_profile_id
        and h.released_at is null
        and h.expires_at > timezone('utc', now());

      if r.duration = 'saturday_only' then
        v_sat_sellable := (r.qty_available - r.qty_held) + v_my_hold;
      elsif r.duration = 'sunday_only' then
        v_sun_sellable := (r.qty_available - r.qty_held) + v_my_hold;
      end if;
    end loop;

    if v_sat_sellable is not null and v_sun_sellable is not null then
      return least(v_sat_sellable, v_sun_sellable);
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

-- Re-derive group ids and reconcile multi-day rows
update public.packages p
set inventory_group_id = public.derive_inventory_group_id(p.id, p.duration, p.race_id)
where p.inventory_group_id is distinct from public.derive_inventory_group_id(p.id, p.duration, p.race_id);

select public.reconcile_linked_multi_day_inventory(g.inventory_group_id)
from (
  select distinct inventory_group_id
  from public.packages
  where inventory_group_id is not null
) g;
