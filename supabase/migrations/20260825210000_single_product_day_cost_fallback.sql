-- A package with no linked child/day products has no day-specific selling
-- prices from which to derive weights. Do not block purchasing in that state:
-- freeze a neutral equal split for capacity/cost completeness. As soon as a
-- linked child product exists, normal strict derived/manual policy validation
-- applies to every future purchase.

create or replace function public.freeze_new_cost_layer_day_components()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allow_historical_fallback boolean :=
    current_setting('inventory.allow_historical_cost_fallback', true) = 'on';
  v_has_linked_child boolean := false;
  v_single_product_fallback boolean := false;
begin
  select exists (
    select 1
    from public.packages source
    join public.packages sibling
      on sibling.inventory_group_id = source.inventory_group_id
     and sibling.id <> source.id
    where source.id = new.source_package_id
      and source.inventory_group_id is not null
      and not coalesce(source.inventory_is_standalone, false)
      and sibling.shell_parent_package_id is null
      and not coalesce(sibling.inventory_is_standalone, false)
      and exists (
        select 1
        from public.inventory_package_day_slots(sibling.id)
      )
  )
  into v_has_linked_child;

  v_single_product_fallback := not coalesce(v_has_linked_child, false);

  perform public.inventory_freeze_cost_layer_day_components(
    new.id,
    v_allow_historical_fallback or v_single_product_fallback
  );

  if v_single_product_fallback
    and not v_allow_historical_fallback
    and exists (
      select 1
      from public.package_cost_layer_day_components component
      where component.cost_layer_id = new.id
        and component.weight_source = 'historical_equal_fallback'
    )
  then
    perform set_config('inventory.component_cost_restatement', 'on', true);
    update public.package_cost_layer_day_components
    set weight_source = 'single_product_equal',
        metadata = metadata || jsonb_build_object(
          'single_product_equal', true,
          'reason', 'No linked child/day products existed when stock was purchased'
        )
    where cost_layer_id = new.id;
    perform set_config('inventory.component_cost_restatement', 'off', true);
  end if;

  return new;
exception
  when others then
    perform set_config('inventory.component_cost_restatement', 'off', true);
    raise;
end;
$$;
