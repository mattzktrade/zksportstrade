-- Stop per-row Saturday/Sunday updates from firing reconcile mid-batch.
-- That trigger was corrupting other linked groups (e.g. Hungary) while cron synced ~57 groups.
-- Reconcile now runs only from apply_linked_group_inventory_sync and adjust_linked_inventory_available.

drop trigger if exists package_inventory_reconcile_multi_day on public.package_inventory;

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
  set qty_available = greatest(0, (elem->>'qty_available')::int)
  from jsonb_array_elements(p_targets) elem
  where pi.package_id = elem->>'package_id';

  perform public.reconcile_linked_multi_day_inventory(p_group_id);
end;
$$;

revoke all on function public.apply_linked_group_inventory_sync(text, jsonb) from public;
grant execute on function public.apply_linked_group_inventory_sync(text, jsonb) to service_role;
