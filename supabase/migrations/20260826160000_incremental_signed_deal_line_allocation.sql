-- Adding or editing a signed deal line was running a full-package supplier
-- reshuffle (combinatorial search + release/reallocate every mutable deal).
-- That exceeds the hosted statement timeout, so extra places never saved.
-- Allocate only the changed line. Prefer suppliers already used by this deal
-- when they still have enough leftover stock; otherwise use normal best-fit.

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
end;
$$;

comment on function public.inventory_reassign_deal_line(uuid, uuid) is
  'Release and reallocate one signed deal line. Does not reshuffle other deals on the package.';

revoke all on function public.inventory_reassign_deal_line(uuid, uuid) from public;
grant execute on function public.inventory_reassign_deal_line(uuid, uuid)
  to authenticated, service_role;

create or replace function public.inventory_signed_deal_line_allocation_mode()
returns text
language sql
immutable
as $$
  select 'incremental-20260826';
$$;

revoke all on function public.inventory_signed_deal_line_allocation_mode() from public;
grant execute on function public.inventory_signed_deal_line_allocation_mode()
  to authenticated, service_role;
