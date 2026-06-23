-- Allow admins to manually choose which purchased stock layers fulfilled an order.

create or replace function public.admin_set_order_cost_allocations(
  p_order_id uuid,
  p_allocations jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item jsonb;
  v_layer_id uuid;
  v_quantity int;
  v_total int;
  r record;
begin
  if not public.is_admin() then
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

  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'invalid_allocations';
  end if;

  create temporary table if not exists order_cost_allocation_input (
    cost_layer_id uuid primary key,
    quantity int not null check (quantity > 0)
  ) on commit drop;
  truncate table pg_temp.order_cost_allocation_input;

  for v_item in select value from jsonb_array_elements(p_allocations)
  loop
    v_layer_id := nullif(btrim(v_item->>'cost_layer_id'), '')::uuid;
    v_quantity := floor((v_item->>'quantity')::numeric)::int;
    if v_layer_id is null or v_quantity is null or v_quantity <= 0 then
      raise exception 'invalid_allocation_row';
    end if;

    insert into pg_temp.order_cost_allocation_input as a (cost_layer_id, quantity)
    values (v_layer_id, v_quantity)
    on conflict (cost_layer_id) do update
      set quantity = a.quantity + excluded.quantity;
  end loop;

  select coalesce(sum(quantity), 0)::int
  into v_total
  from pg_temp.order_cost_allocation_input;
  if v_total <> v_order.guests then
    raise exception 'allocation_total_must_equal_order_guests';
  end if;

  if exists (
    select 1
    from pg_temp.order_cost_allocation_input a
    left join public.package_cost_layers l on l.id = a.cost_layer_id
    where l.id is null
      or l.package_id <> v_order.package_id
  ) then
    raise exception 'invalid_cost_layer_for_order_package';
  end if;

  -- Return the order's current consumed units to their original layers before reallocating.
  update public.package_cost_layers l
  set quantity_remaining = l.quantity_remaining + old.quantity
  from (
    select cost_layer_id, sum(quantity)::int as quantity
    from public.order_cost_consumptions
    where order_id = p_order_id
      and cost_layer_id is not null
    group by cost_layer_id
  ) old
  where l.id = old.cost_layer_id;

  for r in
    select
      a.cost_layer_id,
      a.quantity,
      l.quantity_remaining,
      l.unit_cost,
      l.currency,
      l.source
    from pg_temp.order_cost_allocation_input a
    join public.package_cost_layers l on l.id = a.cost_layer_id
    order by l.received_at asc, l.id asc
    for update of l
  loop
    if r.quantity > r.quantity_remaining then
      raise exception 'insufficient_layer_remaining';
    end if;
  end loop;

  delete from public.order_cost_consumptions
  where order_id = p_order_id;

  insert into public.order_cost_consumptions (
    order_id,
    cost_layer_id,
    package_id,
    quantity,
    unit_cost,
    currency,
    supplier_source_snapshot
  )
  select
    p_order_id,
    a.cost_layer_id,
    v_order.package_id,
    a.quantity,
    l.unit_cost,
    l.currency,
    l.source
  from pg_temp.order_cost_allocation_input a
  join public.package_cost_layers l on l.id = a.cost_layer_id
  order by l.received_at asc, l.id asc;

  update public.package_cost_layers l
  set quantity_remaining = l.quantity_remaining - a.quantity
  from pg_temp.order_cost_allocation_input a
  where l.id = a.cost_layer_id;
end;
$$;

revoke all on function public.admin_set_order_cost_allocations(uuid, jsonb) from public;
grant execute on function public.admin_set_order_cost_allocations(uuid, jsonb) to authenticated;
