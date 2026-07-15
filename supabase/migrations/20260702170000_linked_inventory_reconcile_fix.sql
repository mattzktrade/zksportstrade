-- Harden linked-group inventory reconciliation:
-- 1) Exclude shell packages from min() (they must never drive pool capacity).
-- 2) Skip per-row reconcile trigger during bulk linked-group sync (session flag + disable).
-- 3) Reconcile only the target group's rows.

create or replace function public.reconcile_linked_multi_day_inventory(p_group_id text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_two_day_min int;
  v_three_day_min int;
begin
  if p_group_id is null or p_group_id = '' then
    return;
  end if;

  select min(pi.qty_available)
  into v_two_day_min
  from public.packages p
  join public.package_inventory pi on pi.package_id = p.id
  where p.inventory_group_id = p_group_id
    and p.shell_parent_package_id is null
    and p.duration in ('saturday_only', 'sunday_only');

  if v_two_day_min is not null then
    update public.package_inventory pi
    set qty_available = v_two_day_min
    from public.packages p
    where pi.package_id = p.id
      and p.inventory_group_id = p_group_id
      and p.shell_parent_package_id is null
      and p.duration = '2_day';
  end if;

  select min(pi.qty_available)
  into v_three_day_min
  from public.packages p
  join public.package_inventory pi on pi.package_id = p.id
  where p.inventory_group_id = p_group_id
    and p.shell_parent_package_id is null
    and p.duration in ('friday_only', 'saturday_only', 'sunday_only');

  if v_three_day_min is not null then
    update public.package_inventory pi
    set qty_available = v_three_day_min
    from public.packages p
    where pi.package_id = p.id
      and p.inventory_group_id = p_group_id
      and p.shell_parent_package_id is null
      and p.duration = '3_day';
  end if;
end;
$$;

create or replace function public.trg_reconcile_linked_multi_day_on_day_change()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_group text;
  v_duration text;
begin
  if tg_op <> 'UPDATE' or new.qty_available is not distinct from old.qty_available then
    return new;
  end if;

  if coalesce(current_setting('zk.linked_bulk_sync', true), '0') = '1' then
    return new;
  end if;

  select inventory_group_id, duration
  into v_group, v_duration
  from public.packages
  where id = new.package_id;

  if v_group is not null
     and v_duration in ('saturday_only', 'sunday_only')
     and exists (
       select 1
       from public.packages p
       where p.id = new.package_id
         and p.shell_parent_package_id is null
     ) then
    perform public.reconcile_linked_multi_day_inventory(v_group);
  end if;

  return new;
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
  perform set_config('zk.linked_bulk_sync', '1', true);
  alter table public.package_inventory disable trigger package_inventory_reconcile_multi_day;

  update public.package_inventory pi
  set qty_available = greatest(0, (elem->>'qty_available')::int)
  from jsonb_array_elements(p_targets) elem
  where pi.package_id = elem->>'package_id';

  alter table public.package_inventory enable trigger package_inventory_reconcile_multi_day;
  perform set_config('zk.linked_bulk_sync', '0', true);

  perform public.reconcile_linked_multi_day_inventory(p_group_id);
end;
$$;

revoke all on function public.apply_linked_group_inventory_sync(text, jsonb) from public;
grant execute on function public.apply_linked_group_inventory_sync(text, jsonb) to service_role;

create or replace function public.begin_linked_bulk_sync()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- One linked-group bulk write at a time — prevents cron races corrupting other groups.
  perform pg_advisory_xact_lock(88001234);
  perform set_config('zk.linked_bulk_sync', '1', true);
  alter table public.package_inventory disable trigger package_inventory_reconcile_multi_day;
end;
$$;

create or replace function public.end_linked_bulk_sync(p_group_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  alter table public.package_inventory enable trigger package_inventory_reconcile_multi_day;
  perform set_config('zk.linked_bulk_sync', '0', true);
  if p_group_id is not null and p_group_id <> '' then
    perform public.reconcile_linked_multi_day_inventory(p_group_id);
  end if;
end;
$$;

revoke all on function public.begin_linked_bulk_sync() from public;
grant execute on function public.begin_linked_bulk_sync() to service_role;
revoke all on function public.end_linked_bulk_sync(text) from public;
grant execute on function public.end_linked_bulk_sync(text) to service_role;
