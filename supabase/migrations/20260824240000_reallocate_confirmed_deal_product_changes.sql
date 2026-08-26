-- Confirmed deal lines must never retain an allocation from a product they no
-- longer contain. Product/quantity edits and supplier selections now move the
-- canonical allocation atomically instead of editing supplier display fields.

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
  join public.deal_line_items allocation_line
    on allocation_line.id = allocation.deal_line_item_id
   and allocation_line.package_id = allocation.package_id
  join public.package_cost_layers layer
    on layer.id = allocation.cost_layer_id
  left join public.purchase_orders purchase
    on purchase.id = layer.purchase_order_id
  left join public.suppliers supplier
    on supplier.id = coalesce(layer.supplier_id, purchase.supplier_id)
  where allocation.state in ('reserved', 'committed')
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
  v_layer public.package_cost_layers%rowtype;
  v_ledger_package_id text;
  v_request_key text;
  v_request record;
  v_available int;
  v_now timestamptz := timezone('utc', now());
begin
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('deals.manage')
  then
    raise exception 'forbidden';
  end if;

  select * into v_line
  from public.deal_line_items
  where id = p_deal_line_item_id
  for update;
  if not found then raise exception 'deal_line_not_found'; end if;

  select * into v_deal
  from public.deals
  where id = v_line.deal_id
  for update;
  if not found then raise exception 'deal_not_found'; end if;

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
      resolved_at = coalesce(resolved_at, v_now),
      updated_at = v_now,
      metadata = metadata || jsonb_build_object(
        'cancel_reason',
        'Deal product or quantity changed'
      )
  where deal_line_item_id = v_line.id
    and status = 'open';

  if coalesce(v_line.sourcing_mode, 'owned') = 'brokered'
    or v_deal.stage not in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
  then
    update public.deal_line_items
    set fulfilment_cost_layer_id = null,
        updated_at = v_now
    where id = v_line.id;
    return;
  end if;

  update public.deal_line_items
  set supplier_id = null,
      fulfilment_cost_layer_id = null,
      expected_unit_cost = null,
      updated_at = v_now
  where id = v_line.id;

  v_request_key :=
    'deal-line-reassign:' || v_line.id::text || ':' || gen_random_uuid()::text;

  if p_preferred_cost_layer_id is null then
    perform public.inventory_allocate_quantity(
      v_line.package_id,
      v_line.quantity,
      'committed',
      'deal_line_reassignment',
      v_request_key,
      v_line.deal_id,
      v_line.id,
      null,
      null,
      null,
      'Confirmed deal inventory reassigned',
      jsonb_build_object('automatic', true)
    );
    return;
  end if;

  v_ledger_package_id := public.resolve_cost_ledger_package_id(v_line.package_id);

  select * into v_layer
  from public.package_cost_layers
  where id = p_preferred_cost_layer_id
  for update;
  if not found then raise exception 'cost_layer_not_found'; end if;
  if v_layer.package_id is distinct from v_ledger_package_id then
    raise exception 'invalid_cost_layer_for_package';
  end if;

  v_available := greatest(
    v_layer.quantity_remaining
      - public.inventory_layer_reserved_quantity(v_layer.id),
    0
  );
  if v_available < v_line.quantity then
    raise exception 'insufficient_supplier_stock';
  end if;

  insert into public.inventory_allocations (
    cost_layer_id,
    package_id,
    deal_id,
    deal_line_item_id,
    quantity,
    state,
    source,
    request_key,
    idempotency_key,
    committed_at,
    created_by,
    metadata
  ) values (
    v_layer.id,
    v_line.package_id,
    v_line.deal_id,
    v_line.id,
    v_line.quantity,
    'committed',
    'deal_line_supplier_reassignment',
    v_request_key,
    v_request_key || ':layer:' || v_layer.id::text,
    v_now,
    auth.uid(),
    jsonb_build_object(
      'reason',
      'Confirmed deal supplier reassigned manually'
    )
  );

  update public.package_cost_layers
  set quantity_remaining = quantity_remaining - v_line.quantity
  where id = v_layer.id
    and quantity_remaining >= v_line.quantity;
  if not found then raise exception 'concurrent_inventory_change'; end if;
end;
$$;

revoke all on function public.inventory_reassign_deal_line(uuid, uuid)
  from public;
grant execute on function public.inventory_reassign_deal_line(uuid, uuid)
  to authenticated, service_role;

create or replace function public.reallocate_confirmed_deal_line_after_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.package_id is not distinct from new.package_id
    and old.quantity is not distinct from new.quantity
    and old.sourcing_mode is not distinct from new.sourcing_mode
  then
    return new;
  end if;

  perform public.inventory_reassign_deal_line(new.id, null);
  return new;
end;
$$;

drop trigger if exists deal_line_reallocate_after_insert_trg
  on public.deal_line_items;
create trigger deal_line_reallocate_after_insert_trg
after insert on public.deal_line_items
for each row execute function public.reallocate_confirmed_deal_line_after_edit();

drop trigger if exists deal_line_reallocate_after_update_trg
  on public.deal_line_items;
create trigger deal_line_reallocate_after_update_trg
after update of package_id, quantity, sourcing_mode
on public.deal_line_items
for each row execute function public.reallocate_confirmed_deal_line_after_edit();

create or replace function public.release_deal_line_inventory_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
begin
  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.deal_line_item_id = old.id
      and allocation.state <> 'released'
    order by allocation.request_key
  loop
    perform public.inventory_release_allocations(
      v_request.request_key,
      'Deal product removed',
      true
    );
  end loop;

  update public.inventory_shortages
  set status = 'cancelled',
      resolved_at = coalesce(resolved_at, timezone('utc', now())),
      updated_at = timezone('utc', now()),
      metadata = metadata || jsonb_build_object(
        'cancel_reason',
        'Deal product removed'
      )
  where deal_line_item_id = old.id
    and status = 'open';
  return old;
end;
$$;

drop trigger if exists deal_line_release_inventory_before_delete_trg
  on public.deal_line_items;
create trigger deal_line_release_inventory_before_delete_trg
before delete on public.deal_line_items
for each row execute function public.release_deal_line_inventory_before_delete();

-- Repair the one class of stale data created before the trigger existed. Reset
-- only the target ledgers involved, then atomically move each mismatched line.
do $$
declare
  v_line record;
  v_ledger_package_id text;
begin
  for v_line in
    select distinct
      line.id,
      line.package_id
    from public.deal_line_items line
    join public.deals deal on deal.id = line.deal_id
    join public.inventory_allocations allocation
      on allocation.deal_line_item_id = line.id
     and allocation.state in ('reserved', 'committed')
    where allocation.package_id is distinct from line.package_id
      and allocation.lock_state = 'mutable'
      and coalesce(line.sourcing_mode, 'owned') = 'owned'
      and deal.stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
    order by line.id
  loop
    v_ledger_package_id :=
      public.resolve_cost_ledger_package_id(v_line.package_id);

    update public.package_cost_layers layer
    set quantity_remaining = greatest(
          layer.quantity - coalesce((
            select sum(allocation.quantity)::int
            from public.inventory_allocations allocation
            where allocation.cost_layer_id = layer.id
              and allocation.state = 'committed'
          ), 0),
          0
        ),
        updated_at = timezone('utc', now())
    where layer.package_id = v_ledger_package_id;

    perform public.inventory_reassign_deal_line(v_line.id, null);
  end loop;
end;
$$;
