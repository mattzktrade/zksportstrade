-- Prevent the per-row reconcile trigger from firing during bulk linked-group updates.

-- The trigger reconciles on each Saturday/Sunday change; mid-batch that can leave other

-- groups (e.g. Hungary) at wrong min() before all siblings in the editing group are set.



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



  alter table public.package_inventory disable trigger package_inventory_reconcile_multi_day;



  update public.package_inventory pi

  set qty_available = greatest(0, (elem->>'qty_available')::int)

  from jsonb_array_elements(p_targets) elem

  where pi.package_id = elem->>'package_id';



  alter table public.package_inventory enable trigger package_inventory_reconcile_multi_day;



  perform public.reconcile_linked_multi_day_inventory(p_group_id);

end;

$$;



revoke all on function public.apply_linked_group_inventory_sync(text, jsonb) from public;

grant execute on function public.apply_linked_group_inventory_sync(text, jsonb) to service_role;

