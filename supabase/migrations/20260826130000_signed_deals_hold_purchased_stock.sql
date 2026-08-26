-- Signed, awaiting-invoice, and awaiting-payment deals must hold purchased
-- stock and accept a fulfilment supplier. Payment status stays independent:
-- an unpaid signed deal still displays as Awaiting payment.

create or replace function public.deal_stage_holds_purchased_stock(p_stage text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_stage, '') in (
    'signed',
    'awaiting_invoice',
    'awaiting_payment',
    'paid_confirmed',
    'in_fulfilment',
    'fulfilled'
  );
$$;

comment on function public.deal_stage_holds_purchased_stock(text) is
  'True once both parties have signed. These stages consume purchased stock and can be assigned a supplier; payment status is separate.';

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

  perform 1
  from public.package_cost_layers layer
  where (p_preferred_cost_layer_id is not null
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
    perform public.inventory_release_allocations(
      v_request.request_key,
      'Deal product, quantity, or supplier changed',
      true
    );
  end loop;

  update public.inventory_shortages
  set status = 'cancelled',
      resolved_at = coalesce(resolved_at, timezone('utc', now())),
      updated_at = timezone('utc', now()),
      metadata = metadata || jsonb_build_object(
        'cancel_reason', 'Deal product or quantity changed'
      )
  where deal_line_item_id = v_line.id and status = 'open';

  if coalesce(v_line.sourcing_mode, 'owned') = 'brokered'
    or not public.deal_stage_holds_purchased_stock(v_deal.stage)
  then
    update public.deal_line_items
    set supplier_id = null, fulfilment_cost_layer_id = null,
        expected_unit_cost = null, updated_at = timezone('utc', now())
    where id = v_line.id;
    return;
  end if;

  v_request_key := 'deal-line-reassign:' || v_line.id::text
    || ':' || gen_random_uuid()::text;
  perform public.inventory_allocate_quantity_from_layers(
    v_line.package_id, v_line.quantity, 'committed',
    case when p_preferred_cost_layer_id is null
      then 'deal_line_reassignment'
      else 'deal_line_supplier_reassignment' end,
    v_request_key,
    case when p_preferred_cost_layer_id is null then null
      else array[p_preferred_cost_layer_id] end,
    v_line.deal_id, v_line.id, null, null, null,
    'Signed deal inventory reassigned',
    jsonb_build_object(
      'automatic', p_preferred_cost_layer_id is null,
      'preferred_cost_layer_id', p_preferred_cost_layer_id
    )
  );
end;
$$;

create or replace function public.inventory_reassign_deal_line_to_supplier(
  p_deal_line_item_id uuid,
  p_supplier_key text
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
  v_supplier_id uuid;
  v_supplier_name text;
  v_allowed uuid[];
  v_available int;
  v_request_key text;
begin
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;

  if p_supplier_key like 'id:%' then
    v_supplier_id := substring(p_supplier_key from 4)::uuid;
    select lower(btrim(supplier.name)) into v_supplier_name
    from public.suppliers supplier where supplier.id = v_supplier_id;
    if not found then raise exception 'supplier_not_found'; end if;
  elsif p_supplier_key like 'name:%' then
    v_supplier_name := lower(btrim(substring(p_supplier_key from 6)));
    if v_supplier_name = '' then raise exception 'supplier_required'; end if;
  else
    raise exception 'invalid_supplier_key';
  end if;

  select * into v_line
  from public.deal_line_items line
  where line.id = p_deal_line_item_id
  for update;
  if not found then raise exception 'deal_line_not_found'; end if;
  select * into v_deal
  from public.deals deal where deal.id = v_line.deal_id for update;
  if not found then raise exception 'deal_not_found'; end if;
  if coalesce(v_line.sourcing_mode, 'owned') <> 'owned'
    or not public.deal_stage_holds_purchased_stock(v_deal.stage)
  then raise exception 'invalid_deal_line_assignment'; end if;

  select array_agg(layer.id order by layer.id)
  into v_allowed
  from public.package_cost_layers layer
  left join public.purchase_orders purchase on purchase.id = layer.purchase_order_id
  left join public.suppliers supplier
    on supplier.id = public.inventory_layer_effective_supplier_id(
      layer.supplier_id, purchase.supplier_id
    )
  where public.inventory_layer_is_candidate(layer.id, v_line.package_id)
    and public.inventory_layer_in_supplier_pool(
      layer.supplier_id,
      purchase.supplier_id,
      purchase.supplier,
      layer.source,
      supplier.name,
      v_supplier_id,
      v_supplier_name
    );
  if v_allowed is null then raise exception 'insufficient_supplier_stock'; end if;

  perform 1
  from public.package_cost_layers layer
  where layer.id = any(v_allowed)
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
    perform public.inventory_release_allocations(
      v_request.request_key, 'Deal supplier pool changed', true
    );
  end loop;

  select coalesce(sum(public.inventory_layer_component_available_quantity(
    layer_id, v_line.package_id
  )), 0)::int
  into v_available
  from unnest(v_allowed) layer_id;
  if v_available < v_line.quantity then
    raise exception 'insufficient_supplier_stock:%:%',
      v_line.quantity, v_available;
  end if;

  update public.inventory_shortages
  set status = 'cancelled',
      resolved_at = coalesce(resolved_at, timezone('utc', now())),
      updated_at = timezone('utc', now()),
      metadata = metadata || jsonb_build_object(
        'cancel_reason', 'Deal supplier pool changed'
      )
  where deal_line_item_id = v_line.id and status = 'open';

  v_request_key := 'deal-line-supplier-pool:' || v_line.id::text
    || ':' || gen_random_uuid()::text;
  perform public.inventory_allocate_quantity_from_layers(
    v_line.package_id, v_line.quantity, 'committed',
    'deal_line_supplier_pool_reassignment', v_request_key, v_allowed,
    v_line.deal_id, v_line.id, null, null, null,
    'Signed deal supplier reassigned by supplier pool',
    jsonb_build_object('supplier_key', p_supplier_key)
  );
end;
$$;

create or replace function public.inventory_swap_deal_line_suppliers(
  p_assignments jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment record;
  v_request record;
  v_expected_count int;
  v_actual_count int;
begin
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_assignments) is distinct from 'array'
    or jsonb_array_length(p_assignments) = 0
  then raise exception 'assignments_required'; end if;

  select count(*), count(distinct assignment.line_id)
  into v_expected_count, v_actual_count
  from (
    select (value->>'lineId')::uuid as line_id
    from jsonb_array_elements(p_assignments)
  ) assignment;
  if v_expected_count <> v_actual_count then
    raise exception 'duplicate_deal_line_assignment';
  end if;

  perform 1
  from public.deal_line_items line
  join public.deals deal on deal.id = line.deal_id
  where line.id in (
    select (value->>'lineId')::uuid
    from jsonb_array_elements(p_assignments)
  )
    and nullif(btrim((
      select value->>'supplierKey'
      from jsonb_array_elements(p_assignments)
      where (value->>'lineId')::uuid = line.id
    )), '') is not null
    and coalesce(line.sourcing_mode, 'owned') = 'owned'
    and public.deal_stage_holds_purchased_stock(deal.stage)
  order by line.id
  for update of line;
  get diagnostics v_actual_count = row_count;
  if v_actual_count <> v_expected_count then
    raise exception 'invalid_deal_line_assignment';
  end if;

  perform 1
  from public.package_cost_layers layer
  where layer.id in (
      select allocation.cost_layer_id
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id in (
        select (value->>'lineId')::uuid
        from jsonb_array_elements(p_assignments)
      )
        and allocation.state <> 'released'
    )
    or exists (
      select 1
      from public.deal_line_items line
      where line.id in (
        select (value->>'lineId')::uuid
        from jsonb_array_elements(p_assignments)
      )
        and public.inventory_layer_is_candidate(layer.id, line.package_id)
    )
  order by layer.id
  for update;

  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.deal_line_item_id in (
      select (value->>'lineId')::uuid
      from jsonb_array_elements(p_assignments)
    )
      and allocation.state <> 'released'
    order by allocation.request_key
  loop
    perform public.inventory_release_allocations(
      v_request.request_key,
      'Supplier assignments swapped as one batch',
      true
    );
  end loop;

  for v_assignment in
    select
      (value->>'lineId')::uuid as line_id,
      value->>'supplierKey' as supplier_key
    from jsonb_array_elements(p_assignments)
    order by (value->>'lineId')::uuid
  loop
    perform public.inventory_reassign_deal_line_to_supplier(
      v_assignment.line_id, v_assignment.supplier_key
    );
  end loop;
end;
$$;

create or replace function public.sync_deal_inventory_after_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_old_holds boolean;
  v_new_holds boolean;
  v_allocated int;
begin
  v_old_holds := public.deal_stage_holds_purchased_stock(old.stage);
  v_new_holds := public.deal_stage_holds_purchased_stock(new.stage);

  if not v_old_holds and not v_new_holds then
    return new;
  end if;

  for v_line in
    select line.id, line.quantity, coalesce(line.sourcing_mode, 'owned') as sourcing_mode
    from public.deal_line_items line
    where line.deal_id = new.id
    order by line.sort_order, line.id
  loop
    if v_old_holds and v_new_holds then
      if v_line.sourcing_mode <> 'owned' then
        continue;
      end if;
      select coalesce(sum(allocation.quantity), 0)::int
      into v_allocated
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id = v_line.id
        and allocation.state in ('reserved', 'committed');
      if v_allocated >= v_line.quantity then
        continue;
      end if;
      begin
        perform public.inventory_reassign_deal_line(v_line.id, null);
      exception
        when others then
          raise notice 'Could not allocate deal line % after stage %: %',
            v_line.id, new.stage, sqlerrm;
      end;
    elsif v_new_holds then
      begin
        perform public.inventory_reassign_deal_line(v_line.id, null);
      exception
        when others then
          raise notice 'Could not allocate deal line % after stage %: %',
            v_line.id, new.stage, sqlerrm;
      end;
    else
      perform public.inventory_reassign_deal_line(v_line.id, null);
    end if;
  end loop;

  return new;
end;
$$;

-- Repair existing signed / invoiced / unpaid deals that never received a
-- purchased-stock allocation. Isolate failures so one shortage cannot block
-- the rest of the backfill.
do $$
declare
  v_line record;
begin
  for v_line in
    select line.id
    from public.deal_line_items line
    join public.deals deal on deal.id = line.deal_id
    left join lateral (
      select coalesce(sum(allocation.quantity), 0)::int as quantity
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id = line.id
        and allocation.state in ('reserved', 'committed')
    ) allocated on true
    where public.deal_stage_holds_purchased_stock(deal.stage)
      and deal.order_id is null
      and coalesce(line.sourcing_mode, 'owned') = 'owned'
      and allocated.quantity < line.quantity
    order by deal.created_at desc, line.sort_order, line.id
  loop
    begin
      perform public.inventory_reassign_deal_line(v_line.id, null);
    exception
      when others then
        raise notice 'Could not automatically allocate signed deal line %: %',
          v_line.id,
          sqlerrm;
    end;
  end loop;
end;
$$;

revoke all on function public.deal_stage_holds_purchased_stock(text) from public;
grant execute on function public.deal_stage_holds_purchased_stock(text)
  to authenticated, service_role;
revoke all on function public.inventory_reassign_deal_line(uuid, uuid) from public;
grant execute on function public.inventory_reassign_deal_line(uuid, uuid)
  to authenticated, service_role;
revoke all on function public.inventory_reassign_deal_line_to_supplier(uuid, text)
  from public;
grant execute on function public.inventory_reassign_deal_line_to_supplier(uuid, text)
  to authenticated, service_role;
revoke all on function public.inventory_swap_deal_line_suppliers(jsonb)
  from public;
grant execute on function public.inventory_swap_deal_line_suppliers(jsonb)
  to authenticated, service_role;
