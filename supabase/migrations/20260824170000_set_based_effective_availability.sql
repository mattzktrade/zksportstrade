-- Replace the per-package unresolved-demand lookup in the availability view
-- with one set-based aggregation. This keeps the same conservative stock
-- equation while making full catalog reads fast.

create or replace view public.inventory_unallocated_won_by_ledger as
with allocation_totals as (
  select
    allocation.deal_line_item_id,
    sum(allocation.quantity)::int as quantity
  from public.inventory_allocations allocation
  where allocation.state in ('reserved', 'committed')
    and allocation.deal_line_item_id is not null
  group by allocation.deal_line_item_id
),
uncovered_lines as (
  select
    public.resolve_cost_ledger_package_id(line.package_id) as ledger_package_id,
    greatest(line.quantity - coalesce(allocation.quantity, 0), 0)::int as quantity
  from public.deal_line_items line
  join public.deals deal on deal.id = line.deal_id
  left join allocation_totals allocation
    on allocation.deal_line_item_id = line.id
  where deal.order_id is null
    and deal.stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
    and deal.stock_reconciliation_status = 'pending'
    and coalesce(line.sourcing_mode, 'owned') = 'owned'
)
select
  ledger_package_id,
  coalesce(sum(quantity), 0)::int as quantity
from uncovered_lines
group by ledger_package_id;

create or replace view public.inventory_availability as
select
  base.package_id,
  base.race_id,
  base.name,
  base.duration,
  base.inventory_group_id,
  base.inventory_pool_id,
  base.shell_parent_package_id,
  base.is_legacy_shell,
  base.ledger_package_id,
  base.layer_original_quantity,
  base.layer_quantity_remaining,
  base.reserved_quantity,
  base.manual_hold_quantity,
  base.committed_quantity,
  greatest(
    least(
      base.available_quantity,
      base.available_quantity - coalesce(uncovered.quantity, 0)
    ),
    0
  )::int as available_quantity,
  base.historical_shortage_quantity,
  base.brokered_shortage_quantity,
  base.legacy_qty_available,
  base.legacy_qty_held
from public.inventory_availability_layer_base base
left join public.inventory_unallocated_won_by_ledger uncovered
  on uncovered.ledger_package_id = base.ledger_package_id;

grant select on public.inventory_unallocated_won_by_ledger
  to authenticated, service_role;
grant select on public.inventory_availability
  to authenticated, service_role;
