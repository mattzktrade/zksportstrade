-- Some production databases predate the shared-ledger delete helper even
-- though later cost-layer deletion functions reference it. Restore the helper
-- explicitly so stock deletion has no unresolved runtime dependency.

create or replace function public.package_uses_shared_three_day_ledger(
  p_package_id text
)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.packages split
    join public.packages parent
      on parent.inventory_group_id = split.inventory_group_id
     and parent.duration = '3_day'
     and parent.shell_parent_package_id is null
    join public.package_cost_layers parent_layer
      on parent_layer.package_id = parent.id
    where split.id = p_package_id
      and split.inventory_group_id is not null
      and split.shell_parent_package_id is null
      and split.duration is distinct from '3_day'
  );
$$;

revoke all on function public.package_uses_shared_three_day_ledger(text)
  from public;
grant execute on function public.package_uses_shared_three_day_ledger(text)
  to authenticated;
