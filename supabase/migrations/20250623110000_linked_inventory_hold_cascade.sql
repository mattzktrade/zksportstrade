-- Active holds on linked inventory should affect every package that draws from the same shared pool.

create or replace function public.reconcile_package_holds(p_package_id text)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_package_id is null then
    return;
  end if;

  update public.package_inventory pi
  set qty_held = coalesce((
    select sum(h.quantity)::int
    from public.inventory_holds h
    where h.package_id = p_package_id
      and h.released_at is null
      and h.expires_at > timezone('utc', now())
  ), 0)
  where pi.package_id = p_package_id;
end;
$$;

create or replace function public.reconcile_linked_inventory_holds(p_group_id text)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_group_id is null then
    return;
  end if;

  with group_packages as (
    select id, duration
    from public.packages
    where inventory_group_id = p_group_id
  ),
  component_holds as (
    select
      component.id as package_id,
      coalesce(sum(h.quantity), 0)::int as qty_held
    from group_packages component
    left join group_packages held_package
      on held_package.duration = component.duration
      or (
        held_package.duration = '3_day'
        and component.duration in ('friday_only', 'saturday_only', 'sunday_only')
      )
      or (
        held_package.duration = '2_day'
        and component.duration in ('saturday_only', 'sunday_only')
      )
    left join public.inventory_holds h
      on h.package_id = held_package.id
      and h.released_at is null
      and h.expires_at > timezone('utc', now())
    where component.duration in ('friday_only', 'saturday_only', 'sunday_only')
    group by component.id
  )
  update public.package_inventory pi
  set qty_held = component_holds.qty_held
  from component_holds
  where pi.package_id = component_holds.package_id;

  with group_packages as (
    select id, duration
    from public.packages
    where inventory_group_id = p_group_id
  ),
  combo_holds as (
    select
      combo.id as package_id,
      least(
        coalesce(combo_inventory.qty_available, 0),
        coalesce(max(component_inventory.qty_held), 0)::int
      ) as qty_held
    from group_packages combo
    join public.package_inventory combo_inventory
      on combo_inventory.package_id = combo.id
    left join group_packages component
      on (
        combo.duration = '3_day'
        and component.duration in ('friday_only', 'saturday_only', 'sunday_only')
      )
      or (
        combo.duration = '2_day'
        and component.duration in ('saturday_only', 'sunday_only')
      )
    left join public.package_inventory component_inventory
      on component_inventory.package_id = component.id
    where combo.duration in ('2_day', '3_day')
    group by combo.id, combo_inventory.qty_available
  )
  update public.package_inventory pi
  set qty_held = combo_holds.qty_held
  from combo_holds
  where pi.package_id = combo_holds.package_id;
end;
$$;

create or replace function public.admin_create_hold(
  p_package_id text,
  p_agent_profile_id uuid,
  p_quantity int,
  p_note text default null,
  p_hold_hours int default 24
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold_id uuid;
  v_agent_role text;
  v_hours int;
  v_expires timestamptz;
  v_group text;
  v_duration text;
  v_target_count int := 0;
  r record;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid quantity';
  end if;

  v_hours := coalesce(p_hold_hours, 24);
  if v_hours < 1 or v_hours > 720 then
    raise exception 'hold duration must be between 1 and 720 hours';
  end if;
  v_expires := timezone('utc', now()) + (v_hours * interval '1 hour');

  select role into v_agent_role
  from public.profiles
  where id = p_agent_profile_id;
  if not found then
    raise exception 'profile not found';
  end if;
  if v_agent_role is distinct from 'agent' then
    raise exception 'holds can only be assigned to agent profiles';
  end if;

  select inventory_group_id, duration
  into v_group, v_duration
  from public.packages
  where id = p_package_id;
  if not found then
    raise exception 'package not found';
  end if;

  if v_group is null or v_duration not in ('3_day', '2_day', 'friday_only', 'saturday_only', 'sunday_only') then
    perform public.reconcile_package_holds(p_package_id);

    for r in
      select qty_available, qty_held
      from public.package_inventory
      where package_id = p_package_id
      for update
    loop
      v_target_count := v_target_count + 1;
      if r.qty_held + p_quantity > r.qty_available then
        raise exception 'insufficient free capacity';
      end if;
    end loop;

    if v_target_count = 0 then
      raise exception 'inventory row missing for package';
    end if;

    insert into public.inventory_holds (package_id, agent_profile_id, quantity, note, expires_at)
    values (
      p_package_id,
      p_agent_profile_id,
      p_quantity,
      case when p_note is null or btrim(p_note) = '' then null else btrim(p_note) end,
      v_expires
    )
    returning id into v_hold_id;

    perform public.reconcile_package_holds(p_package_id);
    return v_hold_id;
  end if;

  perform public.reconcile_linked_inventory_holds(v_group);

  for r in
    select pi.qty_available, pi.qty_held
    from public.package_inventory pi
    join public.packages p on p.id = pi.package_id
    where p.inventory_group_id = v_group
      and (
        (v_duration = '3_day' and p.duration in ('friday_only', 'saturday_only', 'sunday_only'))
        or (v_duration = '2_day' and p.duration in ('saturday_only', 'sunday_only'))
        or (v_duration in ('friday_only', 'saturday_only', 'sunday_only') and p.id = p_package_id)
      )
    for update
  loop
    v_target_count := v_target_count + 1;
    if r.qty_held + p_quantity > r.qty_available then
      raise exception 'insufficient free capacity';
    end if;
  end loop;

  if v_target_count = 0 then
    raise exception 'inventory row missing for linked package';
  end if;

  insert into public.inventory_holds (package_id, agent_profile_id, quantity, note, expires_at)
  values (
    p_package_id,
    p_agent_profile_id,
    p_quantity,
    case when p_note is null or btrim(p_note) = '' then null else btrim(p_note) end,
    v_expires
  )
  returning id into v_hold_id;

  perform public.reconcile_linked_inventory_holds(v_group);
  return v_hold_id;
end;
$$;

create or replace function public.admin_release_hold(p_hold_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg text;
  v_released timestamptz;
  v_group text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select package_id, released_at
  into v_pkg, v_released
  from public.inventory_holds
  where id = p_hold_id
  for update;
  if not found then
    raise exception 'hold not found';
  end if;
  if v_released is not null then
    raise exception 'hold already released';
  end if;

  update public.inventory_holds
  set released_at = timezone('utc', now())
  where id = p_hold_id;

  select inventory_group_id
  into v_group
  from public.packages
  where id = v_pkg;

  if v_group is null then
    perform public.reconcile_package_holds(v_pkg);
  else
    perform public.reconcile_linked_inventory_holds(v_group);
  end if;
end;
$$;

create or replace function public.release_expired_inventory_holds()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_package_ids text[];
  r record;
begin
  select coalesce(array_agg(distinct package_id), array[]::text[])
  into v_package_ids
  from public.inventory_holds
  where released_at is null
    and expires_at <= timezone('utc', now());

  update public.inventory_holds
  set released_at = timezone('utc', now())
  where released_at is null
    and expires_at <= timezone('utc', now());
  get diagnostics v_count = row_count;

  for r in
    select distinct p.inventory_group_id
    from public.packages p
    where p.id = any(v_package_ids)
      and p.inventory_group_id is not null
  loop
    perform public.reconcile_linked_inventory_holds(r.inventory_group_id);
  end loop;

  for r in
    select p.id as package_id
    from public.packages p
    where p.id = any(v_package_ids)
      and p.inventory_group_id is null
  loop
    perform public.reconcile_package_holds(r.package_id);
  end loop;

  return v_count;
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
  select inventory_group_id, duration
  into v_group, v_duration
  from public.packages
  where id = p_package_id;

  if v_group is null then
    perform public.reconcile_package_holds(p_package_id);

    update public.package_inventory
    set qty_available = qty_available + p_delta
    where package_id = p_package_id;

    perform public.reconcile_package_holds(p_package_id);
    return;
  end if;

  perform public.reconcile_linked_inventory_holds(v_group);

  update public.package_inventory
  set qty_available = qty_available + p_delta
  where package_id = p_package_id;

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

  perform public.reconcile_linked_inventory_holds(v_group);
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
      join public.packages held_package on held_package.id = h.package_id
      where held_package.inventory_group_id = v_group
        and h.agent_profile_id = p_agent_profile_id
        and h.released_at is null
        and h.expires_at > timezone('utc', now())
        and (
          held_package.duration = r.duration
          or (
            held_package.duration = '3_day'
            and r.duration in ('friday_only', 'saturday_only', 'sunday_only')
          )
          or (
            held_package.duration = '2_day'
            and r.duration in ('saturday_only', 'sunday_only')
          )
        );

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

select public.reconcile_linked_inventory_holds(g.inventory_group_id)
from (
  select distinct inventory_group_id
  from public.packages
  where inventory_group_id is not null
) g;

select public.reconcile_package_holds(p.id)
from public.packages p
where p.inventory_group_id is null;

revoke all on function public.admin_create_hold(text, uuid, int, text, int) from public;
grant execute on function public.admin_create_hold(text, uuid, int, text, int) to authenticated;

revoke all on function public.admin_release_hold(uuid) from public;
grant execute on function public.admin_release_hold(uuid) to authenticated;

revoke all on function public.release_expired_inventory_holds() from public;
grant execute on function public.release_expired_inventory_holds() to anon;
grant execute on function public.release_expired_inventory_holds() to authenticated;
grant execute on function public.release_expired_inventory_holds() to service_role;

grant execute on function public.adjust_linked_inventory_available(text, int) to service_role;
