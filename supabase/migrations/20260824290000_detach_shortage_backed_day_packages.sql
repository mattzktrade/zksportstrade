-- A historical fulfilled sale may already be represented by an explicit open
-- shortage rather than an allocation. That demand can safely move with a day
-- package to its new standalone ledger and will be covered automatically when
-- independently purchased stock is added.

create or replace function public.enforce_standalone_package_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(new.inventory_is_standalone, false) then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and not coalesce(old.inventory_is_standalone, false)
  then
    if exists (
      select 1
      from public.inventory_allocations allocation
      where allocation.package_id = new.id
        and allocation.state in ('reserved', 'committed')
    ) or exists (
      select 1
      from public.inventory_reservations reservation
      where reservation.package_id = new.id
        and reservation.status = 'active'
    ) or exists (
      select 1
      from public.deal_line_items line
      join public.deals deal on deal.id = line.deal_id
      where line.package_id = new.id
        and deal.stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
        and coalesce(line.sourcing_mode, 'owned') = 'owned'
        and coalesce((
          select sum(shortage.quantity)
          from public.inventory_shortages shortage
          where shortage.deal_line_item_id = line.id
            and shortage.package_id = new.id
            and shortage.shortage_type = 'historical_reconciliation'
            and shortage.status = 'open'
        ), 0) < line.quantity
    ) or exists (
      select 1
      from public.order_line_items line
      join public.orders orders on orders.id = line.order_id
      where line.package_id = new.id
        and orders.status <> 'cancelled'
    ) then
      raise exception 'package_inventory_in_use';
    end if;
  end if;

  new.inventory_group_id := null;
  new.inventory_pool_id := null;
  return new;
end;
$$;
