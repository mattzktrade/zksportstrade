-- Sunday (and other day) products can hold leftover stock of their own while
-- the booking still sits on the linked 3-day parent. Allow both.

create or replace function public.admin_reassign_order_package_stock(
  p_order_id uuid,
  p_package_id text,
  p_allocations jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_ledger text;
  v_group text;
  v_parent text;
  v_expected int;
  v_total int;
  v_item jsonb;
  v_layer_id uuid;
  v_quantity int;
  v_line_id uuid;
  v_primary_layer uuid;
  v_primary_supplier uuid;
  r record;
begin
  if not public.has_cms_permission('operations.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select id, package_id, guests, status
  into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'order_cancelled';
  end if;
  if p_package_id is null or btrim(p_package_id) = '' then
    raise exception 'package_not_on_order';
  end if;

  begin
    v_ledger := public.resolve_cost_ledger_package_id(p_package_id);
  exception when others then
    v_ledger := p_package_id;
  end;

  select nullif(btrim(inventory_group_id), '')
  into v_group
  from public.packages
  where id = p_package_id;

  v_parent := null;
  if v_group is not null then
    select p.id
    into v_parent
    from public.packages p
    where p.inventory_group_id = v_group
      and p.duration = '3_day'
      and p.shell_parent_package_id is null
    order by p.id
    limit 1;
  end if;

  if exists (
    select 1 from public.order_line_items where order_id = p_order_id
  ) then
    select coalesce(sum(quantity), 0)::int
    into v_expected
    from public.order_line_items
    where order_id = p_order_id
      and package_id = p_package_id;
    if v_expected <= 0 then
      raise exception 'package_not_on_order';
    end if;
  else
    if v_order.package_id is distinct from p_package_id then
      raise exception 'package_not_on_order';
    end if;
    v_expected := v_order.guests;
  end if;

  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'invalid_allocations';
  end if;

  create temporary table if not exists ops_reassign_allocation_input (
    cost_layer_id uuid primary key,
    quantity int not null check (quantity > 0)
  ) on commit drop;
  truncate table pg_temp.ops_reassign_allocation_input;

  for v_item in select value from jsonb_array_elements(p_allocations)
  loop
    v_layer_id := nullif(btrim(v_item->>'cost_layer_id'), '')::uuid;
    v_quantity := floor((v_item->>'quantity')::numeric)::int;
    if v_layer_id is null or v_quantity is null or v_quantity <= 0 then
      raise exception 'invalid_allocation_row';
    end if;

    insert into pg_temp.ops_reassign_allocation_input as a (cost_layer_id, quantity)
    values (v_layer_id, v_quantity)
    on conflict (cost_layer_id) do update
      set quantity = a.quantity + excluded.quantity;
  end loop;

  select coalesce(sum(quantity), 0)::int
  into v_total
  from pg_temp.ops_reassign_allocation_input;
  if v_total <> v_expected then
    raise exception 'allocation_total_must_equal_line_quantity';
  end if;

  if exists (
    select 1
    from pg_temp.ops_reassign_allocation_input a
    left join public.package_cost_layers l on l.id = a.cost_layer_id
    where l.id is null
      or not (
        l.package_id = p_package_id
        or l.package_id = v_ledger
        or (v_parent is not null and l.package_id = v_parent)
        or (
          v_group is not null
          and exists (
            select 1
            from public.packages p
            where p.id = l.package_id
              and p.inventory_group_id = v_group
          )
        )
        or exists (
          select 1
          from public.order_cost_consumptions occ
          where occ.order_id = p_order_id
            and occ.cost_layer_id = l.id
        )
      )
  ) then
    raise exception 'invalid_cost_layer_for_package';
  end if;

  update public.package_cost_layers l
  set quantity_remaining = l.quantity_remaining + old.quantity
  from (
    select occ.cost_layer_id, sum(occ.quantity)::int as quantity
    from public.order_cost_consumptions occ
    where occ.order_id = p_order_id
      and occ.package_id = p_package_id
      and occ.cost_layer_id is not null
    group by occ.cost_layer_id
  ) old
  where l.id = old.cost_layer_id;

  for r in
    select
      a.cost_layer_id,
      a.quantity,
      l.quantity_remaining
    from pg_temp.ops_reassign_allocation_input a
    join public.package_cost_layers l on l.id = a.cost_layer_id
    order by l.received_at asc, l.id asc
    for update of l
  loop
    if r.quantity > r.quantity_remaining then
      raise exception 'insufficient_layer_remaining';
    end if;
  end loop;

  delete from public.order_cost_consumptions
  where order_id = p_order_id
    and package_id = p_package_id;

  insert into public.order_cost_consumptions (
    order_id,
    cost_layer_id,
    package_id,
    quantity,
    unit_cost,
    currency,
    supplier_source_snapshot,
    fulfilment_block_snapshot
  )
  select
    p_order_id,
    a.cost_layer_id,
    p_package_id,
    a.quantity,
    l.unit_cost,
    l.currency,
    l.source,
    fb.name
  from pg_temp.ops_reassign_allocation_input a
  join public.package_cost_layers l on l.id = a.cost_layer_id
  left join public.fulfilment_blocks fb on fb.id = l.fulfilment_block_id
  order by l.received_at asc, l.id asc;

  update public.package_cost_layers l
  set quantity_remaining = l.quantity_remaining - a.quantity
  from pg_temp.ops_reassign_allocation_input a
  where l.id = a.cost_layer_id;

  select id
  into v_line_id
  from public.order_line_items
  where order_id = p_order_id
    and package_id = p_package_id
  order by sort_order, id
  limit 1;

  delete from public.order_supplier_fulfilments
  where order_id = p_order_id
    and package_id = p_package_id;

  insert into public.order_supplier_fulfilments (
    order_id, order_line_item_id, package_id, supplier_id, quantity, status, notes
  )
  select
    p_order_id,
    v_line_id,
    p_package_id,
    coalesce(l.supplier_id, po.supplier_id),
    sum(a.quantity)::int,
    'confirmed',
    'Assigned from inventory'
  from pg_temp.ops_reassign_allocation_input a
  join public.package_cost_layers l on l.id = a.cost_layer_id
  left join public.purchase_orders po on po.id = l.purchase_order_id
  group by coalesce(l.supplier_id, po.supplier_id);

  select
    a.cost_layer_id,
    coalesce(l.supplier_id, po.supplier_id)
  into v_primary_layer, v_primary_supplier
  from pg_temp.ops_reassign_allocation_input a
  join public.package_cost_layers l on l.id = a.cost_layer_id
  left join public.purchase_orders po on po.id = l.purchase_order_id
  order by a.quantity desc, l.received_at asc, a.cost_layer_id asc
  limit 1;

  update public.deal_line_items dli
  set
    supplier_id = coalesce(v_primary_supplier, dli.supplier_id),
    fulfilment_cost_layer_id = v_primary_layer,
    updated_at = timezone('utc', now())
  from public.deals d
  where d.order_id = p_order_id
    and dli.deal_id = d.id
    and dli.package_id = p_package_id
    and coalesce(dli.sourcing_mode, 'owned') = 'owned';

  update public.order_operations
  set
    supplier_status = case
      when supplier_status in ('unassigned', 'pending') then 'confirmed'
      else supplier_status
    end,
    updated_by = auth.uid(),
    updated_at = timezone('utc', now())
  where order_id = p_order_id;

  insert into public.order_operation_events (
    order_id, event_type, actor_profile_id, summary, metadata
  ) values (
    p_order_id,
    'supplier_stock_reassigned',
    auth.uid(),
    'Reassigned inventory supplier',
    jsonb_build_object('package_id', p_package_id, 'quantity', v_expected)
  );
end;
$$;

revoke all on function public.admin_reassign_order_package_stock(uuid, text, jsonb) from public;
grant execute on function public.admin_reassign_order_package_stock(uuid, text, jsonb) to authenticated;
grant execute on function public.admin_reassign_order_package_stock(uuid, text, jsonb) to service_role;
