-- Expose one canonical stock read model with both:
--   net_quantity       signed operational balance (can be negative)
--   available_quantity quantity safe to sell (never negative)

create or replace view public.inventory_availability as
with effective as (
  select
    base.*,
    (
      base.available_quantity
      - coalesce(uncovered.quantity, 0)
      - base.historical_shortage_quantity
    )::int as net_quantity
  from public.inventory_availability_layer_base base
  left join public.inventory_unallocated_won_by_ledger uncovered
    on uncovered.ledger_package_id = base.ledger_package_id
)
select
  effective.package_id,
  effective.race_id,
  effective.name,
  effective.duration,
  effective.inventory_group_id,
  effective.inventory_pool_id,
  effective.shell_parent_package_id,
  effective.is_legacy_shell,
  effective.ledger_package_id,
  effective.layer_original_quantity,
  effective.layer_quantity_remaining,
  effective.reserved_quantity,
  effective.manual_hold_quantity,
  effective.committed_quantity,
  greatest(effective.net_quantity, 0)::int as available_quantity,
  effective.historical_shortage_quantity,
  effective.brokered_shortage_quantity,
  effective.legacy_qty_available,
  effective.legacy_qty_held,
  effective.net_quantity
from effective;

grant select on public.inventory_availability
  to authenticated, service_role;
