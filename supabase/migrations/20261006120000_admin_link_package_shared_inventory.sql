-- Staff can attach an existing day/weekend product to another product's
-- stock group. The attached product's own purchases are removed so they are
-- not counted twice; signed deals stay on that product and are rebalanced
-- onto the shared ledger.

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
     and parent.duration in ('3_day', '2_day')
     and parent.shell_parent_package_id is null
     and not coalesce(parent.inventory_is_standalone, false)
    join public.package_cost_layers parent_layer
      on parent_layer.package_id = parent.id
    where split.id = p_package_id
      and split.inventory_group_id is not null
      and split.shell_parent_package_id is null
      and not coalesce(split.inventory_is_standalone, false)
      and split.duration is distinct from '3_day'
      and split.duration is distinct from parent.duration
  );
$$;

comment on function public.package_uses_shared_three_day_ledger(text) is
  'True when this split product uses a 2-day or 3-day sibling as the physical purchase ledger.';

create or replace function public.admin_link_package_shared_inventory(
  p_package_id text,
  p_share_with_package_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_joining public.packages%rowtype;
  v_source public.packages%rowtype;
  v_first_id text;
  v_second_id text;
  v_group text;
  v_previous_group text;
  v_source_qty int := 0;
  v_source_layers int := 0;
  v_joining_sold int := 0;
  v_joining_held int := 0;
  v_joining_qty int := 0;
  v_discarded_units int := 0;
  v_discarded_layers int := 0;
  v_layer record;
  v_request record;
  v_sibling_count int := 0;
  v_swap public.packages%rowtype;
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if nullif(btrim(p_package_id), '') is null
    or nullif(btrim(p_share_with_package_id), '') is null
  then
    raise exception 'link_inventory_not_found';
  end if;
  if btrim(p_package_id) = btrim(p_share_with_package_id) then
    raise exception 'link_inventory_same_package';
  end if;

  perform pg_advisory_xact_lock(88001234);

  if btrim(p_package_id) < btrim(p_share_with_package_id) then
    v_first_id := btrim(p_package_id);
    v_second_id := btrim(p_share_with_package_id);
  else
    v_first_id := btrim(p_share_with_package_id);
    v_second_id := btrim(p_package_id);
  end if;

  perform 1 from public.packages where id = v_first_id for update;
  perform 1 from public.packages where id = v_second_id for update;

  select * into v_joining from public.packages where id = btrim(p_package_id);
  if not found then raise exception 'link_inventory_not_found'; end if;
  select * into v_source from public.packages where id = btrim(p_share_with_package_id);
  if not found then raise exception 'link_inventory_not_found'; end if;

  if v_joining.shell_parent_package_id is not null
    or v_source.shell_parent_package_id is not null
  then
    raise exception 'link_inventory_shell';
  end if;
  if v_joining.race_id is distinct from v_source.race_id then
    raise exception 'link_inventory_different_race';
  end if;
  if v_joining.duration is null
    or v_source.duration is null
    or v_joining.duration not in (
      '3_day', '2_day', 'thursday_only', 'friday_only', 'saturday_only', 'sunday_only'
    )
    or v_source.duration not in (
      '3_day', '2_day', 'thursday_only', 'friday_only', 'saturday_only', 'sunday_only'
    )
  then
    raise exception 'link_inventory_duration';
  end if;

  -- The weekend product keeps purchased stock. A day product is the one that joins.
  if (
    v_joining.duration in ('2_day', '3_day')
    and v_source.duration in ('thursday_only', 'friday_only', 'saturday_only', 'sunday_only')
  ) or (v_joining.duration = '2_day' and v_source.duration = '3_day')
  then
    v_swap := v_joining;
    v_joining := v_source;
    v_source := v_swap;
  end if;

  if not coalesce(v_joining.inventory_is_standalone, false)
    and not coalesce(v_source.inventory_is_standalone, false)
    and nullif(btrim(v_joining.inventory_group_id), '') is not null
    and v_joining.inventory_group_id is not distinct from v_source.inventory_group_id
  then
    raise exception 'link_inventory_already_sharing';
  end if;

  if not coalesce(v_joining.inventory_is_standalone, false)
    and nullif(btrim(v_joining.inventory_group_id), '') is not null
  then
    select count(*)::int
    into v_sibling_count
    from public.packages sibling
    where sibling.inventory_group_id = v_joining.inventory_group_id
      and sibling.id <> v_joining.id
      and sibling.shell_parent_package_id is null
      and not coalesce(sibling.inventory_is_standalone, false);
    if v_sibling_count > 0
      and (
        coalesce(v_source.inventory_is_standalone, false)
        or v_source.inventory_group_id is distinct from v_joining.inventory_group_id
      )
    then
      raise exception 'link_inventory_already_grouped';
    end if;
  end if;

  v_group := case
    when not coalesce(v_source.inventory_is_standalone, false)
      then nullif(btrim(v_source.inventory_group_id), '')
    else null
  end;
  if v_group is null then
    v_group := public.derive_inventory_group_id(
      v_source.id, v_source.duration, v_source.race_id
    );
  end if;
  if v_group is null then
    v_group := public.derive_inventory_group_id(
      v_joining.id, v_joining.duration, v_joining.race_id
    );
  end if;
  if v_group is null then
    raise exception 'link_inventory_group_required';
  end if;

  v_previous_group := nullif(btrim(v_joining.inventory_group_id), '');

  insert into public.package_inventory (package_id, qty_available, qty_held)
  values (v_joining.id, 0, 0)
  on conflict (package_id) do nothing;
  insert into public.package_inventory (package_id, qty_available, qty_held)
  values (v_source.id, 0, 0)
  on conflict (package_id) do nothing;

  perform 1 from public.package_inventory where package_id = v_first_id for update;
  perform 1 from public.package_inventory where package_id = v_second_id for update;
  perform 1
  from public.package_cost_layers layer
  where layer.package_id in (v_joining.id, v_source.id)
  order by layer.id
  for update;

  select coalesce(inventory.qty_available, 0)::int
  into v_source_qty
  from public.package_inventory inventory
  where inventory.package_id = v_source.id;
  v_source_qty := coalesce(v_source_qty, 0);

  select coalesce(inventory.qty_held, 0)::int
  into v_joining_held
  from public.package_inventory inventory
  where inventory.package_id = v_joining.id;
  v_joining_held := coalesce(v_joining_held, 0);

  select coalesce(sum(layer.quantity), 0)::int
  into v_source_layers
  from public.package_cost_layers layer
  where layer.package_id = v_source.id;
  v_source_layers := coalesce(v_source_layers, 0);

  select coalesce(sum(layer.quantity), 0)::int
  into v_discarded_units
  from public.package_cost_layers layer
  where layer.package_id = v_joining.id;
  v_discarded_units := coalesce(v_discarded_units, 0);

  select coalesce(sum(line.quantity), 0)::int
  into v_joining_sold
  from public.deal_line_items line
  join public.deals deal on deal.id = line.deal_id
  where line.package_id = v_joining.id
    and coalesce(line.sourcing_mode, 'owned') = 'owned'
    and public.deal_stage_holds_purchased_stock(deal.stage);
  v_joining_sold := coalesce(v_joining_sold, 0);

  v_joining_qty := greatest(v_joining_held, v_source_qty - v_joining_sold);

  if exists (
    select 1
    from public.inventory_allocations allocation
    join public.package_cost_layers layer on layer.id = allocation.cost_layer_id
    where layer.package_id = v_joining.id
      and allocation.state <> 'released'
      and allocation.lock_state = 'fulfilment_locked'
  ) then
    raise exception 'link_inventory_fulfilment_locked';
  end if;

  update public.packages
  set inventory_is_standalone = false,
      inventory_group_id = v_group
  where id = v_source.id;

  update public.packages
  set inventory_is_standalone = false,
      inventory_group_id = v_group
  where id = v_joining.id;

  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    join public.package_cost_layers layer on layer.id = allocation.cost_layer_id
    where layer.package_id = v_joining.id
      and allocation.state <> 'released'
    order by allocation.request_key
  loop
    perform public.inventory_release_allocations(
      v_request.request_key,
      'Released so this product can share another product''s purchased stock',
      true
    );
  end loop;

  for v_layer in
    select layer.id
    from public.package_cost_layers layer
    where layer.package_id = v_joining.id
    order by layer.id
  loop
    perform public.admin_delete_cost_layer(v_layer.id);
    v_discarded_layers := v_discarded_layers + 1;
  end loop;

  update public.package_inventory
  set qty_available = v_joining_qty
  where package_id = v_joining.id;

  perform public.admin_ensure_inventory_pool_for_group(v_group);
  perform public.seed_package_day_consumption(v_source.id);
  perform public.seed_package_day_consumption(v_joining.id);

  if v_previous_group is not null and v_previous_group is distinct from v_group then
    perform public.reconcile_linked_multi_day_inventory(v_previous_group);
    perform public.reconcile_linked_inventory_holds(v_previous_group);
  end if;

  perform public.reconcile_linked_multi_day_inventory(v_group);
  perform public.reconcile_linked_inventory_holds(v_group);
  perform public.inventory_rebalance_linked_day_coverage(v_joining.id);
  perform public.inventory_rebalance_linked_day_coverage(v_source.id);

  return jsonb_build_object(
    'group_id', v_group,
    'joining_package_id', v_joining.id,
    'source_package_id', v_source.id,
    'discarded_layer_count', v_discarded_layers,
    'discarded_units', v_discarded_units,
    'source_available', v_source_qty,
    'source_has_purchase_layers', v_source_layers > 0,
    'joining_sold', v_joining_sold,
    'joining_qty', v_joining_qty
  );
end;
$$;

revoke all on function public.admin_link_package_shared_inventory(text, text) from public;
grant execute on function public.admin_link_package_shared_inventory(text, text)
  to authenticated, service_role;

comment on function public.admin_link_package_shared_inventory(text, text) is
  'Attach p_package_id to p_share_with_package_id so they share stock. Removes the attached product''s own purchases; signed deals stay and are covered from the shared ledger.';
