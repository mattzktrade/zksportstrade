-- Portal checkout calls place_order as an approved agent. That RPC already
-- authenticates the caller and writes the order as that agent. The canonical
-- allocator then rejected anyone who is not CMS staff, so agent checkout
-- failed with a generic 'forbidden' (shown as "another agent").
--
-- Trusted order-entry (place_order, Wix, signed-deal conversion) sets a
-- transaction-local GUC before allocating. Direct agent RPCs to the allocator
-- stay blocked. allocate_order_cost_layers is no longer executable by
-- authenticated callers so the GUC cannot be set from the portal.

create or replace function public.inventory_caller_may_mutate()
returns boolean
language sql
volatile
set search_path = public
as $$
  select coalesce(
    current_setting('inventory.trusted_commit', true) = 'on'
    or session_user in ('postgres', 'supabase_admin')
    or auth.role() is not distinct from 'service_role'
    or public.is_admin()
    or public.has_cms_permission('operations.manage')
    or public.has_cms_permission('deals.manage'),
    false
  );
$$;

comment on function public.inventory_caller_may_mutate() is
  'Staff/service inventory mutations, or a trusted order commit (inventory.trusted_commit).';

revoke all on function public.inventory_caller_may_mutate() from public;
grant execute on function public.inventory_caller_may_mutate() to authenticated, service_role;

create or replace function public.allocate_order_cost_layers(
  p_order_id uuid,
  p_order_package_id text,
  p_guests int,
  p_currency text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line_id uuid;
begin
  if coalesce(p_guests, 0) <= 0 then return; end if;
  perform set_config('inventory.trusted_commit', 'on', true);
  select line.id into v_line_id
  from public.order_line_items line
  where line.order_id = p_order_id
    and line.package_id = p_order_package_id
  order by line.sort_order, line.id
  limit 1;
  perform public.inventory_allocate_quantity(
    p_order_package_id, p_guests, 'committed', 'allocate_order_cost_layers',
    'order:' || p_order_id::text || ':package:' || p_order_package_id,
    (select deal.id from public.deals deal where deal.order_id = p_order_id limit 1),
    (select line.deal_line_item_id from public.order_line_items line
      where line.id = v_line_id),
    p_order_id, v_line_id, null,
    'Order committed through day-slot allocator',
    jsonb_build_object('requested_currency', p_currency)
  );
  perform set_config('inventory.trusted_commit', 'off', true);
end;
$$;

revoke all on function public.allocate_order_cost_layers(uuid, text, int, text)
  from public;
revoke all on function public.allocate_order_cost_layers(uuid, text, int, text)
  from authenticated;
grant execute on function public.allocate_order_cost_layers(uuid, text, int, text)
  to service_role;

create or replace function public.inventory_allocate_quantity_from_layers(
  p_package_id text,
  p_quantity int,
  p_state text,
  p_source text,
  p_request_key text,
  p_allowed_layer_ids uuid[] default null,
  p_deal_id uuid default null,
  p_deal_line_item_id uuid default null,
  p_order_id uuid default null,
  p_order_line_item_id uuid default null,
  p_reservation_id uuid default null,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining int;
  v_available int;
  v_take int;
  v_layer record;
  v_existing int;
  v_now timestamptz := timezone('utc', now());
  v_allocation_id uuid;
  v_occ_id uuid;
  v_unit_cost numeric;
  v_currency text;
  v_preferred_key text;
begin
  if not public.inventory_caller_may_mutate() then
    raise exception 'forbidden';
  end if;
  if coalesce(p_quantity, 0) <= 0 then raise exception 'invalid_quantity'; end if;
  if p_state not in ('reserved', 'committed') then
    raise exception 'invalid_allocation_state';
  end if;
  if nullif(btrim(p_source), '') is null then raise exception 'source_required'; end if;
  if nullif(btrim(p_request_key), '') is null then
    raise exception 'request_key_required';
  end if;
  if not exists (select 1 from public.packages where id = p_package_id) then
    raise exception 'package_not_found:%', p_package_id;
  end if;

  select coalesce(sum(quantity), 0)::int into v_existing
  from public.inventory_allocations
  where request_key = btrim(p_request_key);
  if v_existing > 0 then
    if v_existing <> p_quantity then
      raise exception 'idempotency_quantity_mismatch';
    end if;
    return v_existing;
  end if;

  perform 1
  from public.packages package
  where package.id = p_package_id
  for update;
  perform 1
  from public.package_cost_layers layer
  join public.package_cost_layer_day_components component
    on component.cost_layer_id = layer.id
  where public.inventory_layer_is_candidate(layer.id, p_package_id)
    and (p_allowed_layer_ids is null or layer.id = any(p_allowed_layer_ids))
  order by layer.id, component.day_slot
  for update of layer, component;

  select coalesce(sum(
    public.inventory_layer_component_available_quantity(layer.id, p_package_id)
  ), 0)::int
  into v_available
  from public.package_cost_layers layer
  where public.inventory_layer_is_candidate(layer.id, p_package_id)
    and (p_allowed_layer_ids is null or layer.id = any(p_allowed_layer_ids));

  v_available := greatest(
    v_available - public.inventory_package_manual_hold_quantity(p_package_id),
    0
  );
  if v_available < p_quantity then
    raise exception 'insufficient_purchased_day_capacity:%:%:%',
      p_package_id, p_quantity, v_available;
  end if;

  -- Best-fit: the smallest supplier pool that can still cover the whole party.
  select public.inventory_layer_supplier_key(
    layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
  )
  into v_preferred_key
  from public.package_cost_layers layer
  left join public.purchase_orders purchase on purchase.id = layer.purchase_order_id
  where public.inventory_layer_is_candidate(layer.id, p_package_id)
    and (p_allowed_layer_ids is null or layer.id = any(p_allowed_layer_ids))
  group by 1
  having sum(public.inventory_layer_component_available_quantity(
    layer.id, p_package_id
  )) >= p_quantity
  order by
    sum(public.inventory_layer_component_available_quantity(
      layer.id, p_package_id
    )) asc,
    min(layer.received_at),
    1
  limit 1;

  v_remaining := p_quantity;
  for v_layer in
    select
      layer.*,
      public.inventory_layer_component_available_quantity(
        layer.id, p_package_id
      ) as allocatable,
      public.inventory_layer_supplier_key(
        layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
      ) as supplier_key,
      coalesce((
        select sum(public.inventory_layer_component_available_quantity(
          pool.id, p_package_id
        ))::int
        from public.package_cost_layers pool
        left join public.purchase_orders pool_purchase
          on pool_purchase.id = pool.purchase_order_id
        where public.inventory_layer_is_candidate(pool.id, p_package_id)
          and (p_allowed_layer_ids is null or pool.id = any(p_allowed_layer_ids))
          and public.inventory_layer_supplier_key(
            pool.supplier_id, pool_purchase.supplier_id,
            pool_purchase.supplier, pool.source
          ) = public.inventory_layer_supplier_key(
            layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
          )
      ), 0) as pool_qty,
      case when layer.source_package_id = p_package_id then 0
        when source.duration = '2_day' then 1
        when source.duration = '3_day' then 2
        else 3 end as source_rank
    from public.package_cost_layers layer
    join public.packages source on source.id = layer.source_package_id
    left join public.purchase_orders purchase on purchase.id = layer.purchase_order_id
    where public.inventory_layer_is_candidate(layer.id, p_package_id)
      and (p_allowed_layer_ids is null or layer.id = any(p_allowed_layer_ids))
    order by
      case when v_preferred_key is not null
        and public.inventory_layer_supplier_key(
          layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
        ) = v_preferred_key then 0 else 1 end,
      case when v_preferred_key is null then -coalesce((
        select sum(public.inventory_layer_component_available_quantity(
          pool.id, p_package_id
        ))::int
        from public.package_cost_layers pool
        left join public.purchase_orders pool_purchase
          on pool_purchase.id = pool.purchase_order_id
        where public.inventory_layer_is_candidate(pool.id, p_package_id)
          and (p_allowed_layer_ids is null or pool.id = any(p_allowed_layer_ids))
          and public.inventory_layer_supplier_key(
            pool.supplier_id, pool_purchase.supplier_id,
            pool_purchase.supplier, pool.source
          ) = public.inventory_layer_supplier_key(
            layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
          )
      ), 0) else 0 end,
      source_rank,
      layer.received_at,
      layer.id
  loop
    exit when v_remaining = 0;
    v_take := least(v_layer.allocatable, v_remaining);
    if v_take <= 0 then continue; end if;

    insert into public.inventory_allocations (
      cost_layer_id, package_id, deal_id, deal_line_item_id,
      order_id, order_line_item_id, reservation_id,
      quantity, state, source, request_key, idempotency_key,
      reserved_at, committed_at, created_by, metadata
    ) values (
      v_layer.id, p_package_id, p_deal_id, p_deal_line_item_id,
      p_order_id, p_order_line_item_id, p_reservation_id,
      v_take, p_state, btrim(p_source), btrim(p_request_key),
      btrim(p_request_key) || ':layer:' || v_layer.id::text,
      case when p_state = 'reserved' then v_now else null end,
      case when p_state = 'committed' then v_now else null end,
      auth.uid(), coalesce(p_metadata, '{}'::jsonb)
        || jsonb_build_object('reason', nullif(btrim(p_reason), ''))
    )
    returning id into v_allocation_id;

    v_unit_cost := public.inventory_attach_allocation_day_components(
      v_allocation_id
    );

    if p_state = 'committed' and p_order_id is not null then
      select cost_currency_snapshot into v_currency
      from public.inventory_allocations where id = v_allocation_id;
      perform set_config('inventory.canonical_write', 'on', true);
      insert into public.order_cost_consumptions (
        order_id, cost_layer_id, package_id, quantity, unit_cost, currency,
        supplier_source_snapshot, fulfilment_block_snapshot
      )
      select
        p_order_id, layer.id, p_package_id, v_take, v_unit_cost,
        coalesce(v_currency, layer.currency, 'USD'),
        layer.source, block.name
      from public.package_cost_layers layer
      left join public.fulfilment_blocks block
        on block.id = layer.fulfilment_block_id
      where layer.id = v_layer.id
      returning id into v_occ_id;
      update public.inventory_allocations
      set order_cost_consumption_id = v_occ_id,
          updated_at = timezone('utc', now())
      where id = v_allocation_id;
      perform set_config('inventory.canonical_write', 'off', true);
    end if;
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining <> 0 then raise exception 'allocation_incomplete'; end if;
  return p_quantity;
end;
$$;

revoke all on function public.inventory_allocate_quantity_from_layers(
  text, int, text, text, text, uuid[], uuid, uuid, uuid, uuid, uuid, text, jsonb
) from public;
grant execute on function public.inventory_allocate_quantity_from_layers(
  text, int, text, text, text, uuid[], uuid, uuid, uuid, uuid, uuid, text, jsonb
) to service_role;
