-- Order headers keep package_id after cancelled sales, so deleting the
-- product still hits orders_package_id_fkey. Drop that link for withdrawn
-- orders and leave a live order blocking the delete.

alter table public.orders
  alter column package_id drop not null;

alter table public.orders
  drop constraint if exists orders_package_id_fkey;

alter table public.orders
  add constraint orders_package_id_fkey
  foreign key (package_id)
  references public.packages(id)
  on delete set null;

create or replace function public.admin_prepare_package_delete(p_package_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_package_ids text[];
  v_request record;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if nullif(btrim(p_package_id), '') is null then
    raise exception 'package_id_required';
  end if;

  select array_agg(package.id)
  into v_package_ids
  from public.packages package
  where package.id = p_package_id
     or package.shell_parent_package_id = p_package_id;
  if v_package_ids is null then
    raise exception 'package_not_found';
  end if;

  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.package_id = any(v_package_ids)
      and allocation.state <> 'released'
      and public.inventory_allocation_sale_is_withdrawn(
        allocation.deal_id,
        allocation.deal_line_item_id,
        allocation.order_id
      )
      and not exists (
        select 1
        from public.inventory_allocations sibling
        where sibling.request_key = allocation.request_key
          and sibling.state <> 'released'
          and not public.inventory_allocation_sale_is_withdrawn(
            sibling.deal_id,
            sibling.deal_line_item_id,
            sibling.order_id
          )
      )
    order by allocation.request_key
  loop
    perform public.inventory_release_allocations(
      v_request.request_key,
      'Product deleted after its sale was cancelled',
      true
    );
  end loop;

  if exists (
    select 1
    from public.inventory_allocations allocation
    where allocation.package_id = any(v_package_ids)
      and allocation.state <> 'released'
  ) then
    raise exception 'package_has_active_allocations';
  end if;

  if exists (
    select 1
    from public.deal_line_items line
    join public.deals deal on deal.id = line.deal_id
    where line.package_id = any(v_package_ids)
      and deal.stage not in ('cancelled', 'closed_lost')
  ) then
    raise exception 'package_has_active_deal_lines';
  end if;

  delete from public.deal_line_items line
  using public.deals deal
  where line.deal_id = deal.id
    and line.package_id = any(v_package_ids)
    and deal.stage in ('cancelled', 'closed_lost');

  if exists (
    select 1
    from public.order_line_items line
    join public.orders ord on ord.id = line.order_id
    left join public.deals deal
      on deal.id = ord.deal_id
      or deal.order_id = ord.id
    where line.package_id = any(v_package_ids)
      and ord.status <> 'cancelled'
      and coalesce(deal.stage, '') not in ('cancelled', 'closed_lost')
  ) then
    raise exception 'package_has_active_orders';
  end if;

  if exists (
    select 1
    from public.orders ord
    left join public.deals deal
      on deal.id = ord.deal_id
      or deal.order_id = ord.id
    where ord.package_id = any(v_package_ids)
      and ord.status <> 'cancelled'
      and coalesce(deal.stage, '') not in ('cancelled', 'closed_lost')
  ) then
    raise exception 'package_has_active_orders';
  end if;

  delete from public.order_supplier_fulfilments fulfilment
  using public.orders ord
  left join public.deals deal
    on deal.id = ord.deal_id
    or deal.order_id = ord.id
  where fulfilment.order_id = ord.id
    and fulfilment.package_id = any(v_package_ids)
    and (
      ord.status = 'cancelled'
      or deal.stage in ('cancelled', 'closed_lost')
    );

  delete from public.order_line_items line
  using public.orders ord
  left join public.deals deal
    on deal.id = ord.deal_id
    or deal.order_id = ord.id
  where line.order_id = ord.id
    and line.package_id = any(v_package_ids)
    and (
      ord.status = 'cancelled'
      or deal.stage in ('cancelled', 'closed_lost')
    );

  update public.orders
  set package_id = null
  where package_id = any(v_package_ids);

  delete from public.inventory_shortages shortage
  where shortage.package_id = any(v_package_ids)
    and (
      shortage.status <> 'open'
      or exists (
        select 1
        from public.deals deal
        where deal.id = shortage.deal_id
          and deal.stage in ('cancelled', 'closed_lost')
      )
      or public.inventory_order_sale_is_withdrawn(shortage.order_id)
    );

  if exists (
    select 1
    from public.inventory_shortages shortage
    where shortage.package_id = any(v_package_ids)
  ) then
    raise exception 'package_has_active_shortages';
  end if;

  update public.package_cost_layers
  set source_package_id = null
  where source_package_id = any(v_package_ids);
end;
$$;

revoke all on function public.admin_prepare_package_delete(text) from public;
grant execute on function public.admin_prepare_package_delete(text) to authenticated;
