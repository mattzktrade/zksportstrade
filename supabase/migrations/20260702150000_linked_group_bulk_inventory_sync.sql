-- Apply linked-group inventory updates in one shot so the day-change trigger does not
-- reconcile 3-day to min(partial days) while members are still being updated one-by-one.

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

  update public.package_inventory pi
  set qty_available = greatest(0, (elem->>'qty_available')::int)
  from jsonb_array_elements(p_targets) elem
  where pi.package_id = elem->>'package_id';

  perform public.reconcile_linked_multi_day_inventory(p_group_id);
end;
$$;

revoke all on function public.apply_linked_group_inventory_sync(text, jsonb) from public;
grant execute on function public.apply_linked_group_inventory_sync(text, jsonb) to service_role;
