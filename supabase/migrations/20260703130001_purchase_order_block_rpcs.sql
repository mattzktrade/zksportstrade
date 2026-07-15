-- RPCs for Purchase Orders + Fulfilment Blocks, and cost-layer / allocation
-- extensions that use them.
--
-- Design:
--   * All admin_* RPCs gate on is_admin() and run SECURITY DEFINER.
--   * admin_add_cost_layer/update_cost_layer gain OPTIONAL p_purchase_order_id
--     and p_fulfilment_block_id args (defaults null); existing callers that
--     don't pass them keep working. When the layer is linked to a PO we
--     always overwrite the layer's `source` from the PO's supplier so the
--     free-text source stays in sync with the PO.
--   * admin_set_order_cost_allocations now snapshots the fulfilment block
--     into order_cost_consumptions.fulfilment_block_snapshot.

-- ---------------------------------------------------------------------------
-- Purchase Order CRUD
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_purchase_order(
  p_po_number text,
  p_supplier text,
  p_issued_at date default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_po text;
  v_supplier text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  v_po := nullif(btrim(p_po_number), '');
  v_supplier := nullif(btrim(p_supplier), '');
  if v_po is null then raise exception 'po_number_required'; end if;
  if v_supplier is null then raise exception 'supplier_required'; end if;

  insert into public.purchase_orders (po_number, supplier, issued_at, note, created_by)
  values (
    v_po,
    v_supplier,
    p_issued_at,
    nullif(btrim(p_note), ''),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.admin_create_purchase_order(text, text, date, text) from public;
grant execute on function public.admin_create_purchase_order(text, text, date, text) to authenticated;

create or replace function public.admin_update_purchase_order(
  p_id uuid,
  p_po_number text default null,
  p_supplier text default null,
  p_issued_at date default null,
  p_note text default null,
  p_clear_issued_at boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po text;
  v_supplier text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  v_po := nullif(btrim(p_po_number), '');
  v_supplier := nullif(btrim(p_supplier), '');

  update public.purchase_orders
  set po_number = coalesce(v_po, po_number),
      supplier  = coalesce(v_supplier, supplier),
      issued_at = case when p_clear_issued_at then null else coalesce(p_issued_at, issued_at) end,
      note      = case
                    when p_note is null then note
                    when btrim(p_note) = '' then null
                    else btrim(p_note)
                  end,
      updated_at = now()
  where id = p_id;

  if not found then
    raise exception 'purchase_order_not_found';
  end if;

  -- Keep cost-layer.source aligned with the PO's supplier so downstream
  -- Salesforce sync (which reads layer.source) stays coherent.
  if v_supplier is not null then
    update public.package_cost_layers
    set source = v_supplier
    where purchase_order_id = p_id;
  end if;
end;
$$;

revoke all on function public.admin_update_purchase_order(uuid, text, text, date, text, boolean) from public;
grant execute on function public.admin_update_purchase_order(uuid, text, text, date, text, boolean) to authenticated;

create or replace function public.admin_delete_purchase_order(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if exists (
    select 1 from public.package_cost_layers where purchase_order_id = p_id
  ) then
    raise exception 'purchase_order_in_use';
  end if;

  delete from public.purchase_orders where id = p_id;
  if not found then
    raise exception 'purchase_order_not_found';
  end if;
end;
$$;

revoke all on function public.admin_delete_purchase_order(uuid) from public;
grant execute on function public.admin_delete_purchase_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Fulfilment Block CRUD
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_fulfilment_block(
  p_package_id text,
  p_name text,
  p_location_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  v_name := nullif(btrim(p_name), '');
  if v_name is null then raise exception 'name_required'; end if;
  if not exists (select 1 from public.packages where id = p_package_id) then
    raise exception 'package_not_found';
  end if;

  insert into public.fulfilment_blocks (package_id, name, location_note, created_by)
  values (
    p_package_id,
    v_name,
    nullif(btrim(p_location_note), ''),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.admin_create_fulfilment_block(text, text, text) from public;
grant execute on function public.admin_create_fulfilment_block(text, text, text) to authenticated;

create or replace function public.admin_update_fulfilment_block(
  p_id uuid,
  p_name text default null,
  p_location_note text default null,
  p_salesforce_block_ref text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  v_name := nullif(btrim(p_name), '');

  update public.fulfilment_blocks
  set name = coalesce(v_name, name),
      location_note = case
                        when p_location_note is null then location_note
                        when btrim(p_location_note) = '' then null
                        else btrim(p_location_note)
                      end,
      salesforce_block_ref = case
                               when p_salesforce_block_ref is null then salesforce_block_ref
                               when btrim(p_salesforce_block_ref) = '' then null
                               else btrim(p_salesforce_block_ref)
                             end,
      updated_at = now()
  where id = p_id;

  if not found then
    raise exception 'fulfilment_block_not_found';
  end if;
end;
$$;

revoke all on function public.admin_update_fulfilment_block(uuid, text, text, text) from public;
grant execute on function public.admin_update_fulfilment_block(uuid, text, text, text) to authenticated;

create or replace function public.admin_delete_fulfilment_block(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if exists (
    select 1 from public.package_cost_layers where fulfilment_block_id = p_id
  ) then
    raise exception 'fulfilment_block_in_use';
  end if;

  delete from public.fulfilment_blocks where id = p_id;
  if not found then
    raise exception 'fulfilment_block_not_found';
  end if;
end;
$$;

revoke all on function public.admin_delete_fulfilment_block(uuid) from public;
grant execute on function public.admin_delete_fulfilment_block(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Assign a cost layer to a PO / block after the fact (existing layer editor).
-- Passing NULL leaves the value unchanged; passing an empty uuid clears it.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_cost_layer_purchase_order(
  p_layer_id uuid,
  p_purchase_order_id uuid,
  p_clear boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supplier text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if p_clear then
    update public.package_cost_layers
    set purchase_order_id = null
    where id = p_layer_id;
  else
    if p_purchase_order_id is null then
      raise exception 'purchase_order_required';
    end if;

    select supplier into v_supplier
    from public.purchase_orders
    where id = p_purchase_order_id;
    if not found then
      raise exception 'purchase_order_not_found';
    end if;

    update public.package_cost_layers
    set purchase_order_id = p_purchase_order_id,
        source = v_supplier
    where id = p_layer_id;
  end if;

  if not found then
    raise exception 'cost_layer_not_found';
  end if;
end;
$$;

revoke all on function public.admin_set_cost_layer_purchase_order(uuid, uuid, boolean) from public;
grant execute on function public.admin_set_cost_layer_purchase_order(uuid, uuid, boolean) to authenticated;

create or replace function public.admin_set_cost_layer_fulfilment_block(
  p_layer_id uuid,
  p_fulfilment_block_id uuid,
  p_clear boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer_package text;
  v_block_package text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select package_id into v_layer_package
  from public.package_cost_layers
  where id = p_layer_id;
  if not found then
    raise exception 'cost_layer_not_found';
  end if;

  if p_clear then
    update public.package_cost_layers
    set fulfilment_block_id = null
    where id = p_layer_id;
  else
    if p_fulfilment_block_id is null then
      raise exception 'fulfilment_block_required';
    end if;
    select package_id into v_block_package
    from public.fulfilment_blocks
    where id = p_fulfilment_block_id;
    if not found then
      raise exception 'fulfilment_block_not_found';
    end if;
    if v_block_package <> v_layer_package then
      raise exception 'fulfilment_block_wrong_package';
    end if;

    update public.package_cost_layers
    set fulfilment_block_id = p_fulfilment_block_id
    where id = p_layer_id;
  end if;
end;
$$;

revoke all on function public.admin_set_cost_layer_fulfilment_block(uuid, uuid, boolean) from public;
grant execute on function public.admin_set_cost_layer_fulfilment_block(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_add_cost_layer — extend with optional purchase_order_id +
-- fulfilment_block_id. Drop the old signature so we can add args and keep
-- SECURITY DEFINER + grants clean.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_add_cost_layer(text, int, numeric, text, text, timestamptz, text);

create or replace function public.admin_add_cost_layer(
  p_package_id text,
  p_quantity int,
  p_unit_cost numeric,
  p_currency text default null,
  p_note text default null,
  p_received_at timestamptz default null,
  p_source text default null,
  p_purchase_order_id uuid default null,
  p_fulfilment_block_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer_id uuid;
  v_currency text;
  v_received timestamptz;
  v_pkg_currency text;
  v_supplier text;
  v_block_package text;
  v_source text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'invalid_unit_cost';
  end if;

  select coalesce(nullif(btrim(pk.currency), ''), 'USD')
  into v_pkg_currency
  from public.packages pk
  where pk.id = p_package_id;
  if not found then
    raise exception 'package_not_found';
  end if;

  if p_purchase_order_id is not null then
    select supplier into v_supplier
    from public.purchase_orders
    where id = p_purchase_order_id;
    if not found then
      raise exception 'purchase_order_not_found';
    end if;
  end if;

  if p_fulfilment_block_id is not null then
    select package_id into v_block_package
    from public.fulfilment_blocks
    where id = p_fulfilment_block_id;
    if not found then
      raise exception 'fulfilment_block_not_found';
    end if;
    if v_block_package <> p_package_id then
      raise exception 'fulfilment_block_wrong_package';
    end if;
  end if;

  v_currency := coalesce(nullif(btrim(p_currency), ''), v_pkg_currency);
  v_received := coalesce(p_received_at, now());
  -- Prefer the PO's supplier when a PO is linked so `source` stays canonical.
  v_source := coalesce(v_supplier, nullif(btrim(p_source), ''));

  if not exists (select 1 from public.package_inventory pi where pi.package_id = p_package_id) then
    insert into public.package_inventory (package_id, qty_available, qty_held)
    values (p_package_id, 0, 0);
  end if;

  perform public.lock_package_inventory(p_package_id);

  insert into public.package_cost_layers (
    package_id, quantity, quantity_remaining, unit_cost, currency, note, source,
    received_at, created_by, purchase_order_id, fulfilment_block_id
  )
  values (
    p_package_id,
    p_quantity,
    p_quantity,
    p_unit_cost,
    v_currency,
    nullif(btrim(p_note), ''),
    v_source,
    v_received,
    auth.uid(),
    p_purchase_order_id,
    p_fulfilment_block_id
  )
  returning id into v_layer_id;

  perform public.adjust_linked_inventory_available(p_package_id, p_quantity);

  return v_layer_id;
end;
$$;

revoke all on function public.admin_add_cost_layer(text, int, numeric, text, text, timestamptz, text, uuid, uuid) from public;
grant execute on function public.admin_add_cost_layer(text, int, numeric, text, text, timestamptz, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_set_order_cost_allocations — snapshot the fulfilment block into
-- order_cost_consumptions so we retain "who is in which block" even after
-- block renames.
-- ---------------------------------------------------------------------------
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
    supplier_source_snapshot,
    fulfilment_block_snapshot
  )
  select
    p_order_id,
    a.cost_layer_id,
    v_order.package_id,
    a.quantity,
    l.unit_cost,
    l.currency,
    l.source,
    fb.name
  from pg_temp.order_cost_allocation_input a
  join public.package_cost_layers l on l.id = a.cost_layer_id
  left join public.fulfilment_blocks fb on fb.id = l.fulfilment_block_id
  order by l.received_at asc, l.id asc;

  update public.package_cost_layers l
  set quantity_remaining = l.quantity_remaining - a.quantity
  from pg_temp.order_cost_allocation_input a
  where l.id = a.cost_layer_id;
end;
$$;

revoke all on function public.admin_set_order_cost_allocations(uuid, jsonb) from public;
grant execute on function public.admin_set_order_cost_allocations(uuid, jsonb) to authenticated;
