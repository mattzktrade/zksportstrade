-- A day package may be purchased independently rather than carved from a
-- multi-day package. Persist that choice so later detail edits never auto-link
-- it again.

alter table public.packages
  add column if not exists inventory_is_standalone boolean not null default false;

comment on column public.packages.inventory_is_standalone is
  'When true, this package owns a separate stock ledger and must not inherit an inventory group or pool.';

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

drop trigger if exists packages_enforce_standalone_inventory_insert_trg
  on public.packages;
create trigger packages_enforce_standalone_inventory_insert_trg
before insert
on public.packages
for each row execute function public.enforce_standalone_package_inventory();

drop trigger if exists packages_enforce_standalone_inventory_update_trg
  on public.packages;
create trigger packages_enforce_standalone_inventory_update_trg
before update of inventory_is_standalone, inventory_group_id, inventory_pool_id
on public.packages
for each row execute function public.enforce_standalone_package_inventory();

create or replace function public.reset_new_standalone_package_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_own_remaining int;
begin
  if coalesce(old.inventory_is_standalone, false)
    or not coalesce(new.inventory_is_standalone, false)
  then
    return new;
  end if;

  select coalesce(sum(layer.quantity_remaining), 0)::int
  into v_own_remaining
  from public.package_cost_layers layer
  where layer.package_id = new.id;

  update public.package_inventory
  set qty_available = v_own_remaining,
      qty_held = 0
  where package_id = new.id;
  return new;
end;
$$;

drop trigger if exists packages_reset_new_standalone_inventory_trg
  on public.packages;
create trigger packages_reset_new_standalone_inventory_trg
after update of inventory_is_standalone
on public.packages
for each row execute function public.reset_new_standalone_package_inventory();

-- This package was purchased independently as Sunday-only stock. It has no
-- sales, holds, allocations, or own purchase layers, so start its ledger at 0.
do $$
declare
  v_previous_group text;
begin
  select inventory_group_id
  into v_previous_group
  from public.packages
  where id = 'miami-2026-sunday-red-bull-energy-station';

  update public.packages
  set inventory_is_standalone = true
  where id = 'miami-2026-sunday-red-bull-energy-station'
    and not inventory_is_standalone;

  if v_previous_group is not null then
    perform public.reconcile_linked_multi_day_inventory(v_previous_group);
  end if;
end;
$$;
