-- Changing a purchase order's company must move that stock into the new
-- supplier pool. Cost layers were keeping a stale supplier_id, so renamed
-- imports (e.g. BAM → abc ltd) still pooled with the original supplier and
-- reassignment FIFO-consumed the old layer.

create or replace function public.inventory_layer_effective_supplier_id(
  p_layer_supplier_id uuid,
  p_purchase_supplier_id uuid
)
returns uuid
language sql
immutable
parallel safe
set search_path = public
as $$
  select coalesce(p_purchase_supplier_id, p_layer_supplier_id);
$$;

create or replace function public.inventory_layer_in_supplier_pool(
  p_layer_supplier_id uuid,
  p_purchase_supplier_id uuid,
  p_purchase_supplier text,
  p_layer_source text,
  p_linked_supplier_name text,
  p_supplier_id uuid,
  p_supplier_name text
)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select case
    when p_supplier_id is not null then
      public.inventory_layer_effective_supplier_id(
        p_layer_supplier_id,
        p_purchase_supplier_id
      ) = p_supplier_id
    else
      lower(btrim(coalesce(p_linked_supplier_name, ''))) = p_supplier_name
      or lower(btrim(coalesce(p_purchase_supplier, ''))) = p_supplier_name
      or lower(btrim(coalesce(p_layer_source, ''))) = p_supplier_name
  end;
$$;

create or replace function public.sync_cost_layer_supplier_from_purchase_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supplier_id uuid;
  v_supplier text;
begin
  if new.purchase_order_id is null then
    return new;
  end if;
  select purchase.supplier_id, purchase.supplier
  into v_supplier_id, v_supplier
  from public.purchase_orders purchase
  where purchase.id = new.purchase_order_id;
  if not found then
    return new;
  end if;
  new.supplier_id := v_supplier_id;
  if nullif(btrim(v_supplier), '') is not null then
    new.source := btrim(v_supplier);
  end if;
  return new;
end;
$$;

drop trigger if exists package_cost_layers_sync_supplier_from_po_trg
  on public.package_cost_layers;
create trigger package_cost_layers_sync_supplier_from_po_trg
before insert or update of purchase_order_id on public.package_cost_layers
for each row execute function public.sync_cost_layer_supplier_from_purchase_order();

create or replace function public.sync_cost_layers_from_purchase_order_supplier()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and new.supplier_id is not distinct from old.supplier_id
    and new.supplier is not distinct from old.supplier
  then
    return new;
  end if;

  update public.package_cost_layers layer
  set supplier_id = new.supplier_id,
      source = coalesce(nullif(btrim(new.supplier), ''), layer.source),
      updated_at = timezone('utc', now())
  where layer.purchase_order_id = new.id
    and (
      layer.supplier_id is distinct from new.supplier_id
      or (
        nullif(btrim(new.supplier), '') is not null
        and layer.source is distinct from btrim(new.supplier)
      )
    );

  return new;
end;
$$;

drop trigger if exists purchase_orders_sync_cost_layer_supplier_trg
  on public.purchase_orders;
create trigger purchase_orders_sync_cost_layer_supplier_trg
after insert or update of supplier_id, supplier on public.purchase_orders
for each row execute function public.sync_cost_layers_from_purchase_order_supplier();

update public.package_cost_layers layer
set supplier_id = purchase.supplier_id,
    source = coalesce(nullif(btrim(purchase.supplier), ''), layer.source),
    updated_at = timezone('utc', now())
from public.purchase_orders purchase
where layer.purchase_order_id = purchase.id
  and (
    layer.supplier_id is distinct from purchase.supplier_id
    or (
      nullif(btrim(purchase.supplier), '') is not null
      and layer.source is distinct from btrim(purchase.supplier)
    )
  );

create or replace view public.deal_line_inventory_fulfilment as
with allocation_detail as (
  select
    allocation.deal_line_item_id,
    allocation.cost_layer_id,
    allocation.quantity,
    allocation.effective_unit_cost_snapshot as unit_cost,
    public.inventory_layer_effective_supplier_id(
      layer.supplier_id, purchase.supplier_id
    ) as supplier_id,
    coalesce(
      supplier.name,
      nullif(btrim(purchase.supplier), ''),
      nullif(btrim(layer.source), ''),
      'Unassigned'
    ) as supplier_name,
    coalesce(
      public.inventory_layer_effective_supplier_id(
        layer.supplier_id, purchase.supplier_id
      )::text,
      'name:' || lower(coalesce(
        nullif(btrim(purchase.supplier), ''),
        nullif(btrim(layer.source), ''),
        'unassigned'
      ))
    ) as supplier_key
  from public.inventory_allocations allocation
  join public.package_cost_layers layer on layer.id = allocation.cost_layer_id
  left join public.purchase_orders purchase on purchase.id = layer.purchase_order_id
  left join public.suppliers supplier
    on supplier.id = public.inventory_layer_effective_supplier_id(
      layer.supplier_id, purchase.supplier_id
    )
  where allocation.state in ('reserved', 'committed')
    and allocation.deal_line_item_id is not null
),
allocation_summary as (
  select
    detail.deal_line_item_id,
    sum(detail.quantity)::int as allocated_quantity,
    count(distinct detail.cost_layer_id)::int as layer_count,
    (array_agg(detail.cost_layer_id order by detail.cost_layer_id))[1]
      as only_cost_layer_id,
    count(distinct detail.supplier_key)::int as supplier_count,
    (array_agg(detail.supplier_id order by detail.supplier_id)
      filter (where detail.supplier_id is not null))[1] as only_supplier_id,
    case when bool_and(detail.unit_cost is not null)
      then sum(detail.quantity * detail.unit_cost)
        / nullif(sum(detail.quantity), 0)
      else null end as weighted_unit_cost
  from allocation_detail detail
  group by detail.deal_line_item_id
),
supplier_totals as (
  select
    detail.deal_line_item_id, detail.supplier_key, detail.supplier_id,
    detail.supplier_name, sum(detail.quantity)::int as quantity
  from allocation_detail detail
  group by detail.deal_line_item_id, detail.supplier_key,
    detail.supplier_id, detail.supplier_name
),
supplier_summary as (
  select
    supplier.deal_line_item_id,
    string_agg(
      supplier.quantity::text || 'x ' || supplier.supplier_name,
      ' · ' order by supplier.supplier_name
    ) as supplier_label
  from supplier_totals supplier
  group by supplier.deal_line_item_id
)
select
  line.id as deal_line_item_id,
  line.deal_id,
  line.package_id,
  line.quantity as required_quantity,
  coalesce(summary.allocated_quantity, 0)::int as allocated_quantity,
  coalesce(summary.allocated_quantity, 0) >= line.quantity as fully_allocated,
  case when coalesce(summary.allocated_quantity, 0) >= line.quantity
    then suppliers.supplier_label else null end as supplier_label,
  case when coalesce(summary.allocated_quantity, 0) >= line.quantity
      and summary.supplier_count = 1
    then summary.only_supplier_id else null end as supplier_id,
  case when coalesce(summary.allocated_quantity, 0) >= line.quantity
      and summary.layer_count = 1
    then summary.only_cost_layer_id else null end as cost_layer_id,
  case when coalesce(summary.allocated_quantity, 0) >= line.quantity
    then summary.weighted_unit_cost else null end as weighted_unit_cost
from public.deal_line_items line
left join allocation_summary summary on summary.deal_line_item_id = line.id
left join supplier_summary suppliers on suppliers.deal_line_item_id = line.id;

grant select on public.deal_line_inventory_fulfilment
  to authenticated, service_role;

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
    or v_deal.stage not in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
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

  -- Lock all possible old/new layers before releasing either side.
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
    'Confirmed deal supplier reassigned by supplier pool',
    jsonb_build_object('supplier_key', p_supplier_key)
  );
end;
$$;

revoke all on function public.inventory_layer_effective_supplier_id(uuid, uuid)
  from public;
grant execute on function public.inventory_layer_effective_supplier_id(uuid, uuid)
  to authenticated, service_role;
revoke all on function public.inventory_layer_in_supplier_pool(
  uuid, uuid, text, text, text, uuid, text
) from public;
grant execute on function public.inventory_layer_in_supplier_pool(
  uuid, uuid, text, text, text, uuid, text
) to authenticated, service_role;
revoke all on function public.inventory_reassign_deal_line_to_supplier(uuid, text)
  from public;
grant execute on function public.inventory_reassign_deal_line_to_supplier(uuid, text)
  to authenticated, service_role;
