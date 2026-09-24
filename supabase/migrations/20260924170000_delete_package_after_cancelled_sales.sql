-- Released allocation rows keep package_id, so deleting a product whose sales
-- were cancelled still violates inventory_allocations_package_id_fkey.
-- Released audit rows may outlive the product. Live sales still block deletion.

alter table public.inventory_allocations
  drop constraint if exists inventory_allocations_package_id_fkey;

alter table public.inventory_allocations
  alter column package_id drop not null;

alter table public.inventory_allocations
  add constraint inventory_allocations_package_id_fkey
  foreign key (package_id)
  references public.packages(id)
  on delete set null;

alter table public.inventory_allocations
  drop constraint if exists inventory_allocations_active_package_required;

alter table public.inventory_allocations
  add constraint inventory_allocations_active_package_required
  check (state = 'released' or package_id is not null);

create or replace function public.prevent_signed_deal_line_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_deal_id uuid;
  v_new_deal_id uuid;
  v_fulfilment_release boolean := false;
begin
  if tg_op = 'DELETE' and exists (
    select 1
    from public.deals deal
    where deal.id = old.deal_id
      and deal.stage in ('cancelled', 'closed_lost')
  ) then
    return old;
  end if;
  if tg_op <> 'INSERT' then v_old_deal_id := old.deal_id; end if;
  if tg_op <> 'DELETE' then v_new_deal_id := new.deal_id; end if;
  if tg_op = 'UPDATE'
    and new.deal_id is not distinct from old.deal_id
    and (
      new.supplier_id is distinct from old.supplier_id
      or new.expected_unit_cost is distinct from old.expected_unit_cost
    )
    and not public.deal_stage_holds_purchased_stock((
      select deal.stage from public.deals deal where deal.id = new.deal_id
    ))
  then
    v_fulfilment_release := true;
  end if;
  if tg_op = 'UPDATE'
    and new.deal_id is not distinct from old.deal_id
    and new.package_id is not distinct from old.package_id
    and new.quantity is not distinct from old.quantity
    and new.unit_sale_price is not distinct from old.unit_sale_price
    and new.currency is not distinct from old.currency
    and (
      v_fulfilment_release
      or new.supplier_id is not distinct from old.supplier_id
    )
    and (
      v_fulfilment_release
      or new.expected_unit_cost is not distinct from old.expected_unit_cost
    )
    and new.discount_reason is not distinct from old.discount_reason
    and new.sort_order is not distinct from old.sort_order
    and new.sourcing_mode is not distinct from old.sourcing_mode
    and new.supplier_quote_at is not distinct from old.supplier_quote_at
  then return new; end if;
  if exists (
    select 1 from public.booking_forms form
    where form.deal_id in (v_old_deal_id, v_new_deal_id)
      and form.status in ('sent', 'viewed', 'awaiting_zk_signature', 'zk_signed', 'completed')
  ) then raise exception 'booking_form_snapshot_locks_deal_lines'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

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
