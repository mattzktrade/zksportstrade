-- Staff can hold purchased stock with no agent and no expiry.
-- Active holds are those not released, and either open-ended or still in date.

alter table public.inventory_holds
  alter column agent_profile_id drop not null;

alter table public.inventory_holds
  alter column expires_at drop not null;

alter table public.inventory_holds
  alter column expires_at drop default;

create or replace function public.inventory_hold_is_active(
  p_released_at timestamptz,
  p_expires_at timestamptz
)
returns boolean
language sql
stable
as $$
  select p_released_at is null
    and (p_expires_at is null or p_expires_at > timezone('utc', now()));
$$;

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
      and public.inventory_hold_is_active(h.released_at, h.expires_at)
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
      and public.inventory_hold_is_active(h.released_at, h.expires_at)
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

create or replace function public.admin_place_staff_stock_hold(
  p_package_id text,
  p_quantity int,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold_id uuid;
  v_group text;
  v_available int;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid quantity';
  end if;
  if not exists (select 1 from public.packages where id = p_package_id) then
    raise exception 'package not found';
  end if;
  if not exists (
    select 1 from public.package_inventory where package_id = p_package_id
  ) then
    raise exception 'inventory row missing for package';
  end if;

  perform 1
  from public.package_inventory
  where package_id = p_package_id
  for update;

  v_available := public.inventory_package_allocatable_quantity(p_package_id);
  if v_available < p_quantity then
    raise exception 'insufficient free capacity';
  end if;

  insert into public.inventory_holds (
    package_id,
    agent_profile_id,
    quantity,
    note,
    expires_at
  )
  values (
    p_package_id,
    null,
    p_quantity,
    case when p_note is null or btrim(p_note) = '' then null else btrim(p_note) end,
    null
  )
  returning id into v_hold_id;

  select inventory_group_id
  into v_group
  from public.packages
  where id = p_package_id;

  if v_group is null then
    perform public.reconcile_package_holds(p_package_id);
  else
    perform public.reconcile_linked_inventory_holds(v_group);
  end if;

  return v_hold_id;
end;
$$;

revoke all on function public.admin_place_staff_stock_hold(text, int, text) from public;
grant execute on function public.admin_place_staff_stock_hold(text, int, text) to authenticated;
