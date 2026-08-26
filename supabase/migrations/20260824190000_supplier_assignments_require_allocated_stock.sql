-- A supplier assignment is valid only when canonical inventory allocations
-- fully cover the deal line. Historical overflow remains unassigned until a
-- later purchase covers its shortage.

create or replace view public.deal_line_inventory_fulfilment as
with allocation_detail as (
  select
    allocation.deal_line_item_id,
    allocation.cost_layer_id,
    allocation.quantity,
    layer.unit_cost,
    coalesce(layer.supplier_id, purchase.supplier_id) as supplier_id,
    coalesce(
      supplier.name,
      nullif(btrim(purchase.supplier), ''),
      nullif(btrim(layer.source), ''),
      'Unassigned'
    ) as supplier_name,
    coalesce(
      coalesce(layer.supplier_id, purchase.supplier_id)::text,
      'name:' || lower(coalesce(
        nullif(btrim(purchase.supplier), ''),
        nullif(btrim(layer.source), ''),
        'unassigned'
      ))
    ) as supplier_key
  from public.inventory_allocations allocation
  join public.package_cost_layers layer
    on layer.id = allocation.cost_layer_id
  left join public.purchase_orders purchase
    on purchase.id = layer.purchase_order_id
  left join public.suppliers supplier
    on supplier.id = coalesce(layer.supplier_id, purchase.supplier_id)
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
    case
      when bool_and(detail.unit_cost is not null)
        then sum(detail.quantity * detail.unit_cost) / nullif(sum(detail.quantity), 0)
      else null
    end as weighted_unit_cost
  from allocation_detail detail
  group by detail.deal_line_item_id
),
supplier_totals as (
  select
    detail.deal_line_item_id,
    detail.supplier_key,
    detail.supplier_id,
    detail.supplier_name,
    sum(detail.quantity)::int as quantity
  from allocation_detail detail
  group by
    detail.deal_line_item_id,
    detail.supplier_key,
    detail.supplier_id,
    detail.supplier_name
),
supplier_summary as (
  select
    supplier.deal_line_item_id,
    string_agg(
      supplier.quantity::text || 'x ' || supplier.supplier_name,
      ' · '
      order by supplier.supplier_name
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
  case
    when coalesce(summary.allocated_quantity, 0) >= line.quantity
      then suppliers.supplier_label
    else null
  end as supplier_label,
  case
    when coalesce(summary.allocated_quantity, 0) >= line.quantity
      and summary.supplier_count = 1
      then summary.only_supplier_id
    else null
  end as supplier_id,
  case
    when coalesce(summary.allocated_quantity, 0) >= line.quantity
      and summary.layer_count = 1
      then summary.only_cost_layer_id
    else null
  end as cost_layer_id,
  case
    when coalesce(summary.allocated_quantity, 0) >= line.quantity
      then summary.weighted_unit_cost
    else null
  end as weighted_unit_cost
from public.deal_line_items line
left join allocation_summary summary
  on summary.deal_line_item_id = line.id
left join supplier_summary suppliers
  on suppliers.deal_line_item_id = line.id;

grant select on public.deal_line_inventory_fulfilment
  to authenticated, service_role;

-- Retire the legacy selector: it labelled a layer without reserving its stock,
-- allowing the same supplier quantity to be reused by later historical deals.
drop trigger if exists deal_line_items_auto_assign_supplier
  on public.deal_line_items;

create or replace function public.assign_deal_line_supplier_from_stock(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Supplier projection now comes from deal_line_inventory_fulfilment.
  return;
end;
$$;

create or replace function public.assign_deal_suppliers(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Supplier projection now comes from deal_line_inventory_fulfilment.
  return;
end;
$$;

create or replace function public.sync_deal_line_supplier_from_allocations(
  p_line_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.deal_line_items%rowtype;
  v_fulfilment public.deal_line_inventory_fulfilment%rowtype;
begin
  select * into v_line
  from public.deal_line_items
  where id = p_line_id;
  if not found or coalesce(v_line.sourcing_mode, 'owned') <> 'owned' then
    return;
  end if;
  if exists (
    select 1
    from public.booking_forms form
    where form.deal_id = v_line.deal_id
      and form.status in (
        'sent', 'viewed', 'awaiting_zk_signature', 'zk_signed', 'completed'
      )
  ) then
    return;
  end if;

  select * into v_fulfilment
  from public.deal_line_inventory_fulfilment
  where deal_line_item_id = p_line_id;

  update public.deal_line_items
  set supplier_id = case
        when v_fulfilment.fully_allocated then v_fulfilment.supplier_id
        else null
      end,
      fulfilment_cost_layer_id = case
        when v_fulfilment.fully_allocated then v_fulfilment.cost_layer_id
        else null
      end,
      expected_unit_cost = case
        when v_fulfilment.fully_allocated then v_fulfilment.weighted_unit_cost
        else null
      end,
      updated_at = timezone('utc', now())
  where id = p_line_id
    and (
      supplier_id is distinct from case
        when v_fulfilment.fully_allocated then v_fulfilment.supplier_id
        else null
      end
      or fulfilment_cost_layer_id is distinct from case
        when v_fulfilment.fully_allocated then v_fulfilment.cost_layer_id
        else null
      end
      or expected_unit_cost is distinct from case
        when v_fulfilment.fully_allocated then v_fulfilment.weighted_unit_cost
        else null
      end
    );
end;
$$;

create or replace function public.sync_deal_supplier_after_allocation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.deal_line_item_id is not null then
      perform public.sync_deal_line_supplier_from_allocations(old.deal_line_item_id);
    end if;
    return old;
  end if;
  if new.deal_line_item_id is not null then
    perform public.sync_deal_line_supplier_from_allocations(new.deal_line_item_id);
  end if;
  if tg_op = 'UPDATE'
    and old.deal_line_item_id is distinct from new.deal_line_item_id
    and old.deal_line_item_id is not null
  then
    perform public.sync_deal_line_supplier_from_allocations(old.deal_line_item_id);
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_allocations_sync_deal_supplier_trg
  on public.inventory_allocations;
create trigger inventory_allocations_sync_deal_supplier_trg
after insert or update or delete on public.inventory_allocations
for each row execute function public.sync_deal_supplier_after_allocation_change();

do $$
declare
  v_line record;
begin
  for v_line in
    select line.id
    from public.deal_line_items line
    where coalesce(line.sourcing_mode, 'owned') = 'owned'
  loop
    perform public.sync_deal_line_supplier_from_allocations(v_line.id);
  end loop;
end;
$$;

revoke all on function public.sync_deal_line_supplier_from_allocations(uuid)
  from public;
grant execute on function public.sync_deal_line_supplier_from_allocations(uuid)
  to service_role;
