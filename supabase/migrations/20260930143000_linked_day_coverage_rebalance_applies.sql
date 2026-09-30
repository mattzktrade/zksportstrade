-- The first repack stopped on databases that reject an update of every
-- coverage row, so a later 3-day stayed short while a single-day sale kept
-- the seat. Finish the repack from the day totals, and roll the group back
-- if a longer stay still cannot be seated. The same decision is covered by
-- planLinkedDayCoverage.

create or replace function public.inventory_allocation_is_pinned(
  p_lock_state text,
  p_source text
)
returns boolean
language sql
immutable
as $$
  select p_lock_state = 'fulfilment_locked'
    or p_source in (
      'deal_line_supplier_reassignment',
      'deal_line_supplier_pool_reassignment'
    );
$$;

create or replace function public.inventory_rebalance_release_flexible(
  p_line_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
  v_released int := 0;
begin
  if p_line_id is null then return 0; end if;
  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.deal_line_item_id = p_line_id
      and allocation.state in ('reserved', 'committed')
      and not public.inventory_allocation_is_pinned(
        allocation.lock_state, allocation.source
      )
    order by allocation.request_key
  loop
    v_released := v_released + public.inventory_release_allocations(
      v_request.request_key,
      'Rebalance shared weekend days',
      true
    );
  end loop;
  return v_released;
end;
$$;

create or replace function public.inventory_rebalance_place_line(
  p_line_id uuid,
  p_quantity int,
  p_supplier_key text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.deal_line_items%rowtype;
  v_deal public.deals%rowtype;
  v_order_line_id uuid;
  v_allowed uuid[];
  v_supplier_available int := 0;
  v_try int;
  v_attempts int := 0;
  v_available int;
begin
  if p_line_id is null or coalesce(p_quantity, 0) <= 0 then return 0; end if;
  select * into v_line from public.deal_line_items where id = p_line_id;
  if not found then return 0; end if;
  select * into v_deal from public.deals where id = v_line.deal_id;
  if not found then return 0; end if;

  select line.id into v_order_line_id
  from public.order_line_items line
  where line.deal_line_item_id = v_line.id
  order by line.sort_order, line.id
  limit 1;

  v_allowed := null;
  if nullif(btrim(p_supplier_key), '') is not null then
    select array_agg(layer.id order by layer.id)
    into v_allowed
    from public.package_cost_layers layer
    left join public.purchase_orders purchase
      on purchase.id = layer.purchase_order_id
    where public.inventory_layer_is_candidate(layer.id, v_line.package_id)
      and public.inventory_layer_supplier_key(
        layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
      ) = p_supplier_key;
    if v_allowed is not null then
      select coalesce(sum(
        public.inventory_layer_component_available_quantity(layer_id, v_line.package_id)
      ), 0)::int
      into v_supplier_available
      from unnest(v_allowed) layer_id;
      if v_supplier_available < p_quantity then
        v_allowed := null;
      end if;
    end if;
  end if;

  v_try := p_quantity;
  while v_try > 0 and v_attempts < 2 loop
    v_attempts := v_attempts + 1;
    begin
      perform public.inventory_allocate_quantity_from_layers(
        v_line.package_id, v_try, 'committed',
        'linked_day_rebalance',
        'linked-day-rebalance:' || v_line.id::text || ':' || gen_random_uuid()::text,
        v_allowed,
        v_line.deal_id, v_line.id, v_deal.order_id, v_order_line_id, null,
        'Place signed sale on the shared weekend after longer packages',
        jsonb_build_object('automatic', true, 'linked_day_rebalance', true)
      );
      return v_try;
    exception
      when others then
        if sqlerrm like 'insufficient_purchased_stock%'
          or sqlerrm like 'insufficient_purchased_day_capacity%'
          or sqlerrm like 'insufficient_canonical%'
          or sqlerrm like 'insufficient_day_slot_capacity%'
          or sqlerrm like 'allocation_incomplete%'
        then
          return 0;
        end if;
        raise;
    end;
  end loop;
  return 0;
end;
$$;

create or replace function public.inventory_rebalance_linked_day_coverage(
  p_package_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group text;
  v_standalone boolean;
  v_line record;
  v_slot record;
  v_fit int;
  v_have int;
  v_units int;
  v_excess int;
  v_chosen uuid;
  v_live int;
  v_need int;
  v_got int;
  v_shorter record;
begin
  if nullif(btrim(p_package_id), '') is null then return; end if;
  if current_setting('inventory.linked_day_rebalance', true) = 'on' then
    return;
  end if;
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;

  select
    nullif(btrim(package.inventory_group_id), ''),
    coalesce(package.inventory_is_standalone, false)
  into v_group, v_standalone
  from public.packages package
  where package.id = p_package_id;
  if v_group is null or v_standalone then return; end if;

  perform set_config('inventory.linked_day_rebalance', 'on', true);
  begin
    perform 1
    from public.packages package
    where package.inventory_group_id = v_group
    order by package.id
    for update;
    perform 1
    from public.deal_line_items line
    join public.deals deal on deal.id = line.deal_id
    join public.packages package on package.id = line.package_id
    where package.inventory_group_id = v_group
      and public.deal_stage_holds_purchased_stock(deal.stage)
    order by line.id
    for update of line;
    perform 1
    from public.package_cost_layers layer
    join public.packages source on source.id = layer.source_package_id
    where source.inventory_group_id = v_group
    order by layer.id
    for update of layer;

    drop table if exists _day_cap;
    drop table if exists _cov_lines;
    drop table if exists _cov_slots;
    create temp table _day_cap (
      day_slot text primary key,
      remaining int not null,
      original_remaining int not null
    ) on commit drop;
    create temp table _cov_lines (
      id uuid primary key,
      package_id text not null,
      flexible_qty int not null,
      pinned_qty int not null,
      older_first int not null,
      day_count int not null default 0,
      slot_key text not null default '',
      covered int not null default 0,
      covered_step1 int not null default 0,
      live_flexible int not null default 0,
      supplier_key text
    ) on commit drop;
    create temp table _cov_slots (
      line_id uuid not null,
      day_slot text not null,
      units int not null,
      primary key (line_id, day_slot)
    ) on commit drop;

    insert into _cov_lines (
      id, package_id, flexible_qty, pinned_qty, older_first, supplier_key
    )
    select
      numbered.id,
      numbered.package_id,
      greatest(numbered.quantity - numbered.pinned_qty, 0),
      numbered.pinned_qty,
      numbered.older_first,
      numbered.supplier_key
    from (
      select
        line.id,
        line.package_id,
        line.quantity,
        coalesce(pinned.qty, 0)::int as pinned_qty,
        (row_number() over (
          order by deal.created_at, line.sort_order, line.id
        ))::int as older_first,
        supplier.supplier_key
      from public.deal_line_items line
      join public.deals deal on deal.id = line.deal_id
      join public.packages package on package.id = line.package_id
      left join lateral (
        select coalesce(sum(allocation.quantity), 0)::int as qty
        from public.inventory_allocations allocation
        where allocation.deal_line_item_id = line.id
          and allocation.state in ('reserved', 'committed')
          and public.inventory_allocation_is_pinned(
            allocation.lock_state, allocation.source
          )
      ) pinned on true
      left join lateral (
        select grouped.supplier_key
        from (
          select
            public.inventory_layer_supplier_key(
              layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
            ) as supplier_key,
            sum(allocation.quantity)::int as qty
          from public.inventory_allocations allocation
          join public.package_cost_layers layer
            on layer.id = allocation.cost_layer_id
          left join public.purchase_orders purchase
            on purchase.id = layer.purchase_order_id
          where allocation.deal_line_item_id = line.id
            and allocation.state in ('reserved', 'committed')
          group by 1
        ) grouped
        order by grouped.qty desc, grouped.supplier_key
        limit 1
      ) supplier on true
      where package.inventory_group_id = v_group
        and not coalesce(package.inventory_is_standalone, false)
        and coalesce(line.sourcing_mode, 'owned') = 'owned'
        and public.deal_stage_holds_purchased_stock(deal.stage)
    ) numbered;

    insert into _cov_slots (line_id, day_slot, units)
    select line.id, slot.day_slot, greatest(slot.units_per_sale, 1)
    from _cov_lines line
    cross join lateral public.inventory_package_day_slots(line.package_id) slot;

    delete from _cov_lines line
    where not exists (
      select 1 from _cov_slots slot where slot.line_id = line.id
    );

    update _cov_lines line
    set
      day_count = tally.day_count,
      slot_key = tally.slot_key
    from (
      select
        slot.line_id,
        count(*)::int as day_count,
        string_agg(slot.day_slot, '|' order by slot.day_slot) as slot_key
      from _cov_slots slot
      group by slot.line_id
    ) tally
    where tally.line_id = line.id;

    insert into _day_cap (day_slot, remaining, original_remaining)
    select
      component.day_slot,
      greatest(sum(component.quantity_total), 0)::int,
      greatest(sum(component.quantity_total), 0)::int
    from public.package_cost_layer_day_components component
    join public.package_cost_layers layer on layer.id = component.cost_layer_id
    join public.packages source on source.id = layer.source_package_id
    where source.inventory_group_id = v_group
      and not coalesce(source.inventory_is_standalone, false)
    group by component.day_slot;

    update _day_cap cap
    set
      remaining = greatest(cap.remaining - held.units, 0),
      original_remaining = greatest(cap.original_remaining - held.units, 0)
    from (
      select
        allocation_component.day_slot,
        sum(allocation_component.consumed_units)::int as units
      from public.inventory_allocation_day_components allocation_component
      join public.inventory_allocations allocation
        on allocation.id = allocation_component.allocation_id
      left join _cov_lines line on line.id = allocation.deal_line_item_id
      where allocation.state = 'committed'
        and (
          line.id is null
          or public.inventory_allocation_is_pinned(
            allocation.lock_state, allocation.source
          )
        )
      group by allocation_component.day_slot
    ) held
    where held.day_slot = cap.day_slot;

    update _day_cap cap
    set
      remaining = greatest(cap.remaining - sticky.units, 0),
      original_remaining = greatest(cap.original_remaining - sticky.units, 0)
    from (
      select
        allocation_component.day_slot,
        sum(allocation_component.requested_units)::int as units
      from public.inventory_allocation_day_components allocation_component
      join public.inventory_allocations allocation
        on allocation.id = allocation_component.allocation_id
      where allocation.state = 'reserved'
        and (
          allocation.deal_line_item_id is null
          or not exists (
            select 1 from _cov_lines line where line.id = allocation.deal_line_item_id
          )
          or public.inventory_allocation_is_pinned(
            allocation.lock_state, allocation.source
          )
        )
      group by allocation_component.day_slot
    ) sticky
    where sticky.day_slot = cap.day_slot;

    if not exists (select 1 from _cov_lines) or not exists (select 1 from _day_cap) then
      perform set_config('inventory.linked_day_rebalance', 'off', true);
      return;
    end if;

    for v_line in
      select id, flexible_qty
      from _cov_lines
      order by day_count desc, older_first, id
    loop
      v_fit := v_line.flexible_qty;
      for v_slot in
        select day_slot, units
        from _cov_slots
        where line_id = v_line.id
      loop
        select remaining into v_have
        from _day_cap
        where day_slot = v_slot.day_slot;
        v_units := greatest(v_slot.units, 1);
        v_fit := least(v_fit, coalesce(v_have, 0) / v_units);
      end loop;
      v_fit := greatest(coalesce(v_fit, 0), 0);
      update _cov_lines
      set covered = v_fit, covered_step1 = v_fit
      where id = v_line.id;
      for v_slot in
        select day_slot, units
        from _cov_slots
        where line_id = v_line.id
      loop
        update _day_cap
        set remaining = remaining - (v_fit * greatest(v_slot.units, 1))
        where day_slot = v_slot.day_slot;
      end loop;
    end loop;

    for v_line in
      select slot_key
      from _cov_lines
      group by slot_key
    loop
      select coalesce(sum(flexible_qty - covered), 0)::int
      into v_excess
      from _cov_lines
      where slot_key = v_line.slot_key;
      if v_excess <= 0 then continue; end if;

      select id into v_chosen
      from _cov_lines
      where slot_key = v_line.slot_key
        and flexible_qty = v_excess
      order by older_first desc, id desc
      limit 1;
      if v_chosen is null then continue; end if;

      update _cov_lines
      set covered = case when id = v_chosen then 0 else flexible_qty end
      where slot_key = v_line.slot_key;

      if exists (
        select 1
        from _cov_slots slot
        join _cov_lines line on line.id = slot.line_id
        left join _day_cap cap on cap.day_slot = slot.day_slot
        group by slot.day_slot, cap.original_remaining
        having sum(line.covered * slot.units) > coalesce(cap.original_remaining, -1)
      ) then
        update _cov_lines
        set covered = covered_step1
        where slot_key = v_line.slot_key;
      end if;
    end loop;

    update _cov_lines line
    set live_flexible = coalesce((
      select sum(allocation.quantity)::int
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id = line.id
        and allocation.state in ('reserved', 'committed')
        and not public.inventory_allocation_is_pinned(
          allocation.lock_state, allocation.source
        )
    ), 0)
    where line.id is not null;

    if not exists (
      select 1 from _cov_lines where covered is distinct from live_flexible
    ) then
      perform set_config('inventory.linked_day_rebalance', 'off', true);
      return;
    end if;

    for v_line in
      select id, covered, supplier_key
      from _cov_lines
      where live_flexible > covered
      order by id
    loop
      perform public.inventory_rebalance_release_flexible(v_line.id);
      if v_line.covered > 0 then
        perform public.inventory_rebalance_place_line(
          v_line.id, v_line.covered, v_line.supplier_key
        );
      end if;
    end loop;

    update _cov_lines line
    set live_flexible = coalesce((
      select sum(allocation.quantity)::int
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id = line.id
        and allocation.state in ('reserved', 'committed')
        and not public.inventory_allocation_is_pinned(
          allocation.lock_state, allocation.source
        )
    ), 0)
    where line.id is not null;

    for v_line in
      select id, covered, supplier_key, day_count
      from _cov_lines
      where live_flexible < covered
      order by day_count desc, older_first, id
    loop
      select coalesce(sum(allocation.quantity), 0)::int
      into v_live
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id = v_line.id
        and allocation.state in ('reserved', 'committed')
        and not public.inventory_allocation_is_pinned(
          allocation.lock_state, allocation.source
        );
      v_need := v_line.covered - coalesce(v_live, 0);
      if v_need <= 0 then continue; end if;

      v_got := public.inventory_rebalance_place_line(
        v_line.id, v_need, v_line.supplier_key
      );
      if v_got >= v_need then continue; end if;

      begin
        for v_shorter in
          select id
          from _cov_lines
          where day_count < v_line.day_count
          order by id
        loop
          perform public.inventory_rebalance_release_flexible(v_shorter.id);
        end loop;
        perform public.inventory_rebalance_release_flexible(v_line.id);
        v_got := public.inventory_rebalance_place_line(
          v_line.id, v_line.covered, v_line.supplier_key
        );
        if v_got < v_line.covered then
          raise exception 'linked_day_reshuffle_failed';
        end if;
        for v_shorter in
          select id, covered, supplier_key
          from _cov_lines
          where day_count < v_line.day_count
            and covered > 0
          order by day_count desc, older_first, id
        loop
          perform public.inventory_rebalance_place_line(
            v_shorter.id, v_shorter.covered, v_shorter.supplier_key
          );
        end loop;
      exception
        when others then
          raise;
      end;
    end loop;

    for v_line in select id from _cov_lines order by id loop
      perform public.inventory_sync_deal_line_shortage(v_line.id);
    end loop;

    perform set_config('inventory.linked_day_rebalance', 'off', true);
  exception
    when others then
      perform set_config('inventory.linked_day_rebalance', 'off', true);
      raise;
  end;
end;
$$;

comment on function public.inventory_rebalance_linked_day_coverage(text) is
  'Repack a linked weekend so longer stays keep purchased seats and the extra single-day place is the uncovered sale.';

revoke all on function public.inventory_allocation_is_pinned(text, text) from public;
grant execute on function public.inventory_allocation_is_pinned(text, text)
  to service_role;
revoke all on function public.inventory_rebalance_release_flexible(uuid) from public;
grant execute on function public.inventory_rebalance_release_flexible(uuid)
  to service_role;
revoke all on function public.inventory_rebalance_place_line(uuid, int, text) from public;
grant execute on function public.inventory_rebalance_place_line(uuid, int, text)
  to service_role;
revoke all on function public.inventory_rebalance_linked_day_coverage(text) from public;
grant execute on function public.inventory_rebalance_linked_day_coverage(text)
  to authenticated, service_role;

create or replace function public.inventory_allocate_deal_line_remainder(
  p_deal_line_item_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.deal_line_items%rowtype;
  v_deal public.deals%rowtype;
  v_needed int;
  v_order_line_id uuid;
  v_allocated int := 0;
begin
  if p_deal_line_item_id is null then return 0; end if;
  if not public.inventory_caller_may_mutate()
    and session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;

  select * into v_line from public.deal_line_items
  where id = p_deal_line_item_id for update;
  if not found then return 0; end if;
  select * into v_deal from public.deals where id = v_line.deal_id for update;
  if not found then return 0; end if;
  if not public.deal_stage_holds_purchased_stock(v_deal.stage)
    or coalesce(v_line.sourcing_mode, 'owned') <> 'owned'
  then
    perform public.inventory_sync_deal_line_shortage(v_line.id);
    return 0;
  end if;

  v_needed := v_line.quantity
    - public.inventory_deal_line_live_quantity(v_line.id);
  if v_needed <= 0 then
    perform public.inventory_rebalance_linked_day_coverage(v_line.package_id);
    perform public.inventory_sync_deal_line_shortage(v_line.id);
    return 0;
  end if;

  select line.id into v_order_line_id
  from public.order_line_items line
  where line.deal_line_item_id = v_line.id
  order by line.sort_order, line.id
  limit 1;

  begin
    v_allocated := public.inventory_allocate_quantity_from_layers(
      v_line.package_id, v_needed, 'committed',
      'deal_line_remainder',
      'deal-line-remainder:' || v_line.id::text || ':' || gen_random_uuid()::text,
      null, v_line.deal_id, v_line.id, v_deal.order_id, v_order_line_id, null,
      'Fill uncovered signed deal quantity without releasing existing stock',
      jsonb_build_object('automatic', true)
    );
  exception
    when others then
      if sqlerrm like 'insufficient_purchased_stock%'
        or sqlerrm like 'insufficient_purchased_day_capacity%'
        or sqlerrm like 'insufficient_canonical%'
      then
        v_allocated := 0;
      else
        raise;
      end if;
  end;

  perform public.inventory_rebalance_linked_day_coverage(v_line.package_id);
  perform public.inventory_sync_deal_line_shortage(v_line.id);
  return coalesce(v_allocated, 0);
end;
$$;

create or replace function public.inventory_reassign_deal_line(
  p_deal_line_item_id uuid,
  p_preferred_cost_layer_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.deal_line_items%rowtype;
  v_deal public.deals%rowtype;
  v_request record;
  v_request_key text;
  v_allowed uuid[];
  v_preferred_available int := 0;
  v_released int := 0;
begin
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;

  select * into v_line from public.deal_line_items
  where id = p_deal_line_item_id for update;
  if not found then raise exception 'deal_line_not_found'; end if;
  select * into v_deal from public.deals
  where id = v_line.deal_id for update;
  if not found then raise exception 'deal_not_found'; end if;

  if p_preferred_cost_layer_id is not null
    and not public.inventory_layer_is_candidate(
      p_preferred_cost_layer_id, v_line.package_id
    )
  then raise exception 'invalid_cost_layer_for_package'; end if;

  perform 1 from public.packages package
  where package.id = v_line.package_id
  for update;
  perform 1
  from public.deal_line_items line
  join public.deals deal on deal.id = line.deal_id
  where line.package_id = v_line.package_id
    and coalesce(line.sourcing_mode, 'owned') = 'owned'
    and public.deal_stage_holds_purchased_stock(deal.stage)
  order by line.id
  for update of line;
  perform 1
  from public.package_cost_layers layer
  where public.inventory_layer_is_candidate(layer.id, v_line.package_id)
    or (p_preferred_cost_layer_id is not null
      and layer.id = p_preferred_cost_layer_id)
    or layer.id in (
      select allocation.cost_layer_id
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id = v_line.id
        and allocation.state <> 'released'
    )
  order by layer.id
  for update;

  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.deal_line_item_id = v_line.id
      and allocation.state <> 'released'
    order by allocation.request_key
  loop
    v_released := v_released + public.inventory_release_allocations(
      v_request.request_key,
      'Deal product, quantity, or supplier changed',
      true
    );
  end loop;

  if not public.deal_stage_holds_purchased_stock(v_deal.stage) then
    update public.deal_line_items
    set fulfilment_cost_layer_id = null,
        supplier_id = case
          when coalesce(v_line.sourcing_mode, 'owned') = 'brokered' then supplier_id
          else null
        end,
        expected_unit_cost = case
          when coalesce(v_line.sourcing_mode, 'owned') = 'brokered' then expected_unit_cost
          else null
        end,
        updated_at = timezone('utc', now())
    where id = v_line.id;
    perform public.inventory_sync_deal_line_shortage(v_line.id);
    -- A new enquiry has not taken any purchased seats. Repacking the weekend
    -- anyway updates every coverage row, and that is rejected, so the enquiry
    -- rolls back. Repack only when this save actually freed seats.
    if v_released > 0 then
      perform public.inventory_rebalance_linked_day_coverage(v_line.package_id);
    end if;
    return;
  end if;

  if coalesce(v_line.sourcing_mode, 'owned') = 'brokered' then
    update public.deal_line_items
    set fulfilment_cost_layer_id = null,
        updated_at = timezone('utc', now())
    where id = v_line.id;
    perform public.inventory_sync_deal_line_shortage(v_line.id);
    perform public.inventory_rebalance_linked_day_coverage(v_line.package_id);
    return;
  end if;

  if p_preferred_cost_layer_id is not null then
    v_request_key := 'deal-line-reassign:' || v_line.id::text
      || ':' || gen_random_uuid()::text;
    perform public.inventory_allocate_quantity_from_layers(
      v_line.package_id, v_line.quantity, 'committed',
      'deal_line_supplier_reassignment',
      v_request_key,
      array[p_preferred_cost_layer_id],
      v_line.deal_id, v_line.id, null, null, null,
      'Signed deal inventory reassigned',
      jsonb_build_object(
        'automatic', false,
        'preferred_cost_layer_id', p_preferred_cost_layer_id
      )
    );
    perform public.inventory_sync_deal_line_shortage(v_line.id);
    perform public.inventory_rebalance_linked_day_coverage(v_line.package_id);
    return;
  end if;

  v_allowed := null;
  if current_setting('inventory.repacking', true) is distinct from 'on' then
    select array_agg(layer.id order by layer.id)
    into v_allowed
    from public.package_cost_layers layer
    left join public.purchase_orders purchase
      on purchase.id = layer.purchase_order_id
    where public.inventory_layer_is_candidate(layer.id, v_line.package_id)
      and public.inventory_layer_supplier_key(
        layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
      ) in (
        select public.inventory_layer_supplier_key(
          used.supplier_id, used_purchase.supplier_id,
          used_purchase.supplier, used.source
        )
        from public.inventory_allocations allocation
        join public.deal_line_items other
          on other.id = allocation.deal_line_item_id
        join public.package_cost_layers used on used.id = allocation.cost_layer_id
        left join public.purchase_orders used_purchase
          on used_purchase.id = used.purchase_order_id
        where other.deal_id = v_line.deal_id
          and other.package_id = v_line.package_id
          and other.id is distinct from v_line.id
          and allocation.state in ('reserved', 'committed')
      );
    if v_allowed is not null then
      select coalesce(sum(public.inventory_layer_component_available_quantity(
        layer_id, v_line.package_id
      )), 0)::int
      into v_preferred_available
      from unnest(v_allowed) layer_id;
      v_preferred_available := greatest(
        v_preferred_available
          - public.inventory_package_manual_hold_quantity(v_line.package_id),
        0
      );
      if v_preferred_available < v_line.quantity then
        v_allowed := null;
      end if;
    end if;
  end if;

  v_request_key := 'deal-line-reassign:' || v_line.id::text
    || ':' || gen_random_uuid()::text;
  begin
    perform public.inventory_allocate_quantity_from_layers(
      v_line.package_id, v_line.quantity, 'committed',
      'deal_line_reassignment', v_request_key, v_allowed,
      v_line.deal_id, v_line.id, null, null, null,
      'Signed deal inventory reassigned',
      jsonb_build_object(
        'automatic', true,
        'preferred_existing_deal_supplier', v_allowed is not null
      )
    );
  exception
    when others then
      if sqlerrm like 'insufficient_purchased_stock%'
        or sqlerrm like 'insufficient_purchased_day_capacity%'
        or sqlerrm like 'insufficient_canonical%'
      then
        null;
      else
        raise;
      end if;
  end;

  perform public.inventory_rebalance_linked_day_coverage(v_line.package_id);
  perform public.inventory_sync_deal_line_shortage(v_line.id);
end;
$$;

comment on function public.inventory_reassign_deal_line(uuid, uuid) is
  'Release and reallocate one signed deal line, then repack the shared weekend if a longer stay should keep the seat.';

revoke all on function public.inventory_allocate_deal_line_remainder(uuid) from public;
grant execute on function public.inventory_allocate_deal_line_remainder(uuid)
  to authenticated, service_role;
revoke all on function public.inventory_reassign_deal_line(uuid, uuid) from public;
grant execute on function public.inventory_reassign_deal_line(uuid, uuid)
  to authenticated, service_role;

-- Correct groups that already have a signed place with no purchased seat.
do $rebalance$
declare
  v_group text;
  v_package text;
begin
  for v_group in
    select distinct package.inventory_group_id
    from public.deal_line_items line
    join public.deals deal on deal.id = line.deal_id
    join public.packages package on package.id = line.package_id
    where public.deal_stage_holds_purchased_stock(deal.stage)
      and coalesce(line.sourcing_mode, 'owned') = 'owned'
      and nullif(btrim(package.inventory_group_id), '') is not null
      and not coalesce(package.inventory_is_standalone, false)
      and public.inventory_deal_line_live_quantity(line.id) < line.quantity
  loop
    begin
      select package.id into v_package
      from public.packages package
      where package.inventory_group_id = v_group
        and not coalesce(package.inventory_is_standalone, false)
      order by package.id
      limit 1;
      if v_package is not null then
        perform public.inventory_rebalance_linked_day_coverage(v_package);
      end if;
    exception
      when others then
        raise warning 'linked day rebalance skipped for group %: %', v_group, sqlerrm;
    end;
  end loop;
end
$rebalance$;
