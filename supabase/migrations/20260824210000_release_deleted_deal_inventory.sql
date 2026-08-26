-- Release canonical inventory when an unnecessary deal is deleted, and allow
-- an unused purchase layer to be removed after its demand has been deleted.

create or replace function public.admin_delete_deal(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.deals%rowtype;
  v_request record;
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_deal_id is null then raise exception 'deal_required'; end if;

  select * into v_deal
  from public.deals
  where id = p_deal_id
  for update;
  if not found then raise exception 'deal_not_found'; end if;

  if v_deal.order_id is not null then
    raise exception 'deal_has_order';
  end if;

  if exists (
    select 1
    from public.booking_forms
    where deal_id = p_deal_id
      and status not in ('draft', 'voided', 'declined', 'expired', 'failed')
  ) then
    raise exception 'deal_has_booking_form';
  end if;

  perform public.admin_release_deal_reservations(
    p_deal_id,
    'cancelled',
    'Deal deleted'
  );

  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.state <> 'released'
      and (
        allocation.deal_id = p_deal_id
        or allocation.deal_line_item_id in (
          select line.id
          from public.deal_line_items line
          where line.deal_id = p_deal_id
        )
      )
    order by allocation.request_key
  loop
    perform public.inventory_release_allocations(
      v_request.request_key,
      'Deal deleted',
      true
    );
  end loop;

  update public.inventory_shortages
  set status = 'cancelled',
      resolved_at = coalesce(resolved_at, timezone('utc', now())),
      updated_at = timezone('utc', now()),
      metadata = metadata || jsonb_build_object('cancel_reason', 'Deal deleted')
  where deal_id = p_deal_id
     or deal_line_item_id in (
       select line.id
       from public.deal_line_items line
       where line.deal_id = p_deal_id
     );

  update public.sourcing_shortages
  set status = case
        when status in ('open', 'quoted', 'confirmed') then 'cancelled'
        else status
      end,
      cleared_at = case
        when status in ('open', 'quoted', 'confirmed') then timezone('utc', now())
        else cleared_at
      end,
      deal_id = null,
      updated_at = timezone('utc', now())
  where deal_id = p_deal_id;

  delete from public.booking_form_events
  where booking_form_id in (
    select id from public.booking_forms where deal_id = p_deal_id
  );
  delete from public.booking_form_signatures
  where booking_form_id in (
    select id from public.booking_forms where deal_id = p_deal_id
  );
  delete from public.booking_forms where deal_id = p_deal_id;

  delete from public.deals where id = p_deal_id;
end;
$$;

revoke all on function public.admin_delete_deal(uuid) from public;
grant execute on function public.admin_delete_deal(uuid) to authenticated;

create or replace function public.admin_delete_cost_layer(p_layer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer record;
  v_request record;
  v_qty_held int;
  v_qty_available int;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  perform 1
  from public.package_cost_layers
  where id = p_layer_id
  for update;
  if not found then
    raise exception 'cost_layer_not_found';
  end if;

  -- A deleted deal/order leaves SET NULL audit references. Mutable allocations
  -- with no remaining business object are safe to release before stock removal.
  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.cost_layer_id = p_layer_id
      and allocation.state <> 'released'
      and allocation.lock_state = 'mutable'
      and allocation.deal_id is null
      and allocation.deal_line_item_id is null
      and allocation.order_id is null
      and allocation.order_line_item_id is null
      and allocation.reservation_id is null
      and allocation.order_cost_consumption_id is null
    order by allocation.request_key
  loop
    perform public.inventory_release_allocations(
      v_request.request_key,
      'Unused purchase stock deleted after its demand was removed',
      true
    );
  end loop;

  update public.inventory_shortages shortage
  set status = 'cancelled',
      resolved_at = coalesce(shortage.resolved_at, timezone('utc', now())),
      updated_at = timezone('utc', now()),
      metadata = shortage.metadata || jsonb_build_object(
        'cancel_reason',
        'Covering purchase stock deleted after demand was removed'
      )
  from public.inventory_allocations allocation
  where allocation.cost_layer_id = p_layer_id
    and allocation.source = 'historical_shortage_cover'
    and shortage.id::text = allocation.metadata->>'shortage_id'
    and allocation.state = 'released'
    and allocation.deal_id is null
    and allocation.deal_line_item_id is null
    and allocation.order_id is null
    and allocation.order_line_item_id is null;

  if exists (
    select 1
    from public.inventory_allocations allocation
    where allocation.cost_layer_id = p_layer_id
      and allocation.state <> 'released'
  ) then
    raise exception 'layer_has_active_allocations';
  end if;

  select id, package_id, quantity, quantity_remaining
  into v_layer
  from public.package_cost_layers
  where id = p_layer_id
  for update;
  if not found then
    raise exception 'cost_layer_not_found';
  end if;

  if v_layer.quantity_remaining is distinct from v_layer.quantity then
    raise exception 'layer_already_consumed';
  end if;

  if exists (
    select 1
    from public.order_cost_consumptions
    where cost_layer_id = p_layer_id
  ) then
    raise exception 'layer_already_consumed';
  end if;

  -- Hard-deleting an unused purchase also removes its now-released allocation
  -- audit rows so the cost-layer foreign key remains internally consistent.
  delete from public.inventory_allocation_events event
  using public.inventory_allocations allocation
  where event.allocation_id = allocation.id
    and allocation.cost_layer_id = p_layer_id
    and allocation.state = 'released';

  delete from public.inventory_allocations
  where cost_layer_id = p_layer_id
    and state = 'released';

  if public.package_uses_shared_three_day_ledger(v_layer.package_id) then
    delete from public.package_cost_layers where id = p_layer_id;
    return;
  end if;

  perform public.lock_package_inventory(v_layer.package_id);

  select qty_available, qty_held
  into v_qty_available, v_qty_held
  from public.package_inventory
  where package_id = v_layer.package_id;

  if found then
    if (v_qty_available - v_layer.quantity) < v_qty_held then
      raise exception 'qty_held_would_exceed_capacity';
    end if;
    perform public.adjust_linked_inventory_available(
      v_layer.package_id,
      -v_layer.quantity
    );
  end if;

  delete from public.package_cost_layers where id = p_layer_id;
end;
$$;

revoke all on function public.admin_delete_cost_layer(uuid) from public;
grant execute on function public.admin_delete_cost_layer(uuid) to authenticated;

create or replace function public.admin_delete_purchase_order(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer record;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if not exists (select 1 from public.purchase_orders where id = p_id) then
    raise exception 'purchase_order_not_found';
  end if;

  for v_layer in
    select id
    from public.package_cost_layers
    where purchase_order_id = p_id
    order by created_at, id
  loop
    perform public.admin_delete_cost_layer(v_layer.id);
  end loop;

  delete from public.purchase_orders where id = p_id;
  if not found then
    raise exception 'purchase_order_not_found';
  end if;
end;
$$;

revoke all on function public.admin_delete_purchase_order(uuid) from public;
grant execute on function public.admin_delete_purchase_order(uuid) to authenticated;
