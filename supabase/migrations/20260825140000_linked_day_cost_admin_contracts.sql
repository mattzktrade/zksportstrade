-- Complete the application/database contract for linked-day costing.
-- Policy edits affect future layers only; each new layer freezes its snapshot
-- in the same transaction as the physical stock purchase.

create or replace function public.admin_set_inventory_group_cost_policy(
  p_inventory_group_id text,
  p_allocation_method text,
  p_manual_weights jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id text := nullif(btrim(p_inventory_group_id), '');
  v_method text := lower(btrim(coalesce(p_allocation_method, '')));
  v_weight_total numeric;
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if v_group_id is null then raise exception 'inventory_group_required'; end if;
  if v_method not in ('normalized_trade_price', 'manual') then
    raise exception 'invalid_allocation_method';
  end if;
  if not exists (
    select 1
    from public.packages package
    where package.inventory_group_id = v_group_id
      and not coalesce(package.inventory_is_standalone, false)
  ) then
    raise exception 'inventory_group_not_found';
  end if;

  if v_method = 'manual' then
    if p_manual_weights is null
      or jsonb_typeof(p_manual_weights) <> 'object'
      or jsonb_object_length(p_manual_weights) = 0
      or exists (
        select 1
        from jsonb_each_text(p_manual_weights) weight
        where weight.key not in ('thursday', 'friday', 'saturday', 'sunday')
          or weight.value::numeric <= 0
      )
    then
      raise exception 'invalid_manual_day_weights';
    end if;
    select coalesce(sum(weight.value::numeric), 0)
    into v_weight_total
    from jsonb_each_text(p_manual_weights) weight;
    if abs(v_weight_total - 1) > 0.000001 then
      raise exception 'manual_weights_must_total_one';
    end if;
  end if;

  insert into public.inventory_group_cost_policies (
    inventory_group_id,
    allocation_method,
    manual_weights,
    setup_required,
    setup_reason,
    updated_at,
    updated_by
  ) values (
    v_group_id,
    v_method,
    case when v_method = 'manual' then p_manual_weights else '{}'::jsonb end,
    false,
    null,
    timezone('utc', now()),
    auth.uid()
  )
  on conflict (inventory_group_id) do update
  set allocation_method = excluded.allocation_method,
      manual_weights = excluded.manual_weights,
      setup_required = false,
      setup_reason = null,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;
end;
$$;

drop function if exists public.admin_add_cost_layer(
  text, int, numeric, text, text, timestamptz, text, uuid, uuid
);

create or replace function public.admin_add_cost_layer(
  p_package_id text,
  p_quantity int,
  p_unit_cost numeric,
  p_currency text default null,
  p_note text default null,
  p_received_at timestamptz default null,
  p_source text default null,
  p_purchase_order_id uuid default null,
  p_fulfilment_block_id uuid default null,
  p_source_package_id text default null
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
  v_ledger public.packages%rowtype;
  v_source_package public.packages%rowtype;
  v_supplier text;
  v_block_package text;
  v_source_label text;
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if coalesce(p_quantity, 0) <= 0 then raise exception 'invalid_quantity'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'invalid_unit_cost';
  end if;

  select * into v_ledger
  from public.packages package
  where package.id = p_package_id
  for update;
  if not found then raise exception 'package_not_found'; end if;

  select * into v_source_package
  from public.packages package
  where package.id = coalesce(nullif(btrim(p_source_package_id), ''), p_package_id);
  if not found then raise exception 'source_package_not_found'; end if;

  if v_source_package.id <> v_ledger.id and (
    coalesce(v_source_package.inventory_is_standalone, false)
    or coalesce(v_ledger.inventory_is_standalone, false)
    or nullif(btrim(v_source_package.inventory_group_id), '') is null
    or v_source_package.inventory_group_id is distinct from v_ledger.inventory_group_id
  ) then
    raise exception 'source_package_not_compatible_with_ledger';
  end if;

  if p_purchase_order_id is not null then
    select purchase.supplier into v_supplier
    from public.purchase_orders purchase
    where purchase.id = p_purchase_order_id;
    if not found then raise exception 'purchase_order_not_found'; end if;
  end if;

  if p_fulfilment_block_id is not null then
    select block.package_id into v_block_package
    from public.fulfilment_blocks block
    where block.id = p_fulfilment_block_id;
    if not found then raise exception 'fulfilment_block_not_found'; end if;
    if v_block_package <> p_package_id then
      raise exception 'fulfilment_block_wrong_package';
    end if;
  end if;

  v_currency := coalesce(
    nullif(btrim(p_currency), ''),
    nullif(btrim(v_source_package.currency), ''),
    nullif(btrim(v_ledger.currency), ''),
    'USD'
  );
  v_received := coalesce(p_received_at, timezone('utc', now()));
  v_source_label := coalesce(v_supplier, nullif(btrim(p_source), ''));

  insert into public.package_inventory (package_id, qty_available, qty_held)
  values (p_package_id, 0, 0)
  on conflict (package_id) do nothing;

  perform public.lock_package_inventory(p_package_id);

  insert into public.package_cost_layers (
    package_id,
    source_package_id,
    source_package_origin,
    quantity,
    quantity_remaining,
    unit_cost,
    currency,
    note,
    source,
    received_at,
    created_by,
    purchase_order_id,
    fulfilment_block_id
  ) values (
    p_package_id,
    v_source_package.id,
    'explicit',
    p_quantity,
    p_quantity,
    p_unit_cost,
    v_currency,
    nullif(btrim(p_note), ''),
    v_source_label,
    v_received,
    auth.uid(),
    p_purchase_order_id,
    p_fulfilment_block_id
  )
  returning id into v_layer_id;

  -- The AFTER INSERT component-freeze trigger runs before this statement.
  -- Any missing policy/day price raises and rolls back the layer and this
  -- compatibility quantity update as one transaction.
  perform public.adjust_linked_inventory_available(p_package_id, p_quantity);
  return v_layer_id;
end;
$$;

revoke all on function public.admin_set_inventory_group_cost_policy(
  text, text, jsonb
) from public;
grant execute on function public.admin_set_inventory_group_cost_policy(
  text, text, jsonb
) to authenticated, service_role;

revoke all on function public.admin_add_cost_layer(
  text, int, numeric, text, text, timestamptz, text, uuid, uuid, text
) from public;
grant execute on function public.admin_add_cost_layer(
  text, int, numeric, text, text, timestamptz, text, uuid, uuid, text
) to authenticated, service_role;
