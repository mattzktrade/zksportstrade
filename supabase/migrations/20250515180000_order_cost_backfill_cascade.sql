-- Backfill missing order_cost_consumptions for orders placed before FIFO tracking,
-- and strengthen admin_update_cost_layer so historical COGS stays in sync.

-- ---------------------------------------------------------------------------
-- Replay FIFO consumption snapshots for orders on a package that have no rows.
-- Uses each layer's original `quantity` as the virtual pool (not
-- quantity_remaining) and walks orders oldest-first so multi-layer packages
-- allocate correctly.
-- ---------------------------------------------------------------------------
create or replace function public._backfill_package_order_costs(p_package_id text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_layer record;
  v_remaining int;
  v_take int;
  v_pool int;
  v_count int := 0;
  v_layers uuid[];
  v_pool_qty int[];
  v_layer_unit_cost numeric[];
  v_layer_currency text[];
  v_i int;
begin
  if not exists (select 1 from public.packages where id = p_package_id) then
    raise exception 'package_not_found';
  end if;

  -- Build virtual FIFO pools from layer original quantities.
  v_i := 0;
  for v_layer in
    select id, quantity, unit_cost, currency
    from public.package_cost_layers
    where package_id = p_package_id
    order by received_at asc, id asc
  loop
    v_i := v_i + 1;
    v_layers[v_i] := v_layer.id;
    v_pool_qty[v_i] := v_layer.quantity;
    v_layer_unit_cost[v_i] := v_layer.unit_cost;
    v_layer_currency[v_i] := v_layer.currency;
  end loop;

  if v_i = 0 then
    return 0;
  end if;

  for v_order in
    select o.id, o.guests, coalesce(nullif(btrim(o.currency), ''), 'USD') as order_currency
    from public.orders o
    where o.package_id = p_package_id
      and o.status <> 'cancelled'
      and not exists (
        select 1 from public.order_cost_consumptions occ where occ.order_id = o.id
      )
    order by o.created_at asc, o.id asc
  loop
    v_remaining := v_order.guests;

    if array_length(v_layers, 1) is not null then
      for v_i in 1..array_length(v_layers, 1) loop
        exit when v_remaining <= 0;
        v_pool := coalesce(v_pool_qty[v_i], 0);
        if v_pool <= 0 then
          continue;
        end if;
        v_take := least(v_pool, v_remaining);

        insert into public.order_cost_consumptions (
          order_id, cost_layer_id, package_id, quantity, unit_cost, currency
        )
        values (
          v_order.id,
          v_layers[v_i],
          p_package_id,
          v_take,
          v_layer_unit_cost[v_i],
          v_layer_currency[v_i]
        );

        v_pool_qty[v_i] := v_pool - v_take;
        v_remaining := v_remaining - v_take;
      end loop;
    end if;

    if v_remaining > 0 then
      insert into public.order_cost_consumptions (
        order_id, cost_layer_id, package_id, quantity, unit_cost, currency
      )
      values (
        v_order.id,
        null,
        p_package_id,
        v_remaining,
        null,
        v_order.order_currency
      );
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.admin_backfill_package_order_costs(p_package_id text)
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  return public._backfill_package_order_costs(p_package_id);
end;
$$;

revoke all on function public._backfill_package_order_costs(text) from public;
revoke all on function public.admin_backfill_package_order_costs(text) from public;
grant execute on function public.admin_backfill_package_order_costs(text) to authenticated;

-- One-time backfill for all packages (runs as migration owner, not via is_admin).
select public._backfill_package_order_costs(p.id)
from public.packages p;

-- ---------------------------------------------------------------------------
-- admin_update_cost_layer — cascade to all consumption rows for this layer,
-- then backfill any orders on the package still missing snapshots.
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_cost_layer(
  p_layer_id uuid,
  p_unit_cost numeric default null,
  p_currency text default null,
  p_note text default null,
  p_received_at timestamptz default null,
  p_cascade_to_consumptions boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer record;
  v_new_unit_cost numeric;
  v_new_currency text;
  v_package_id text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select id, package_id, unit_cost, currency, note, received_at
  into v_layer
  from public.package_cost_layers
  where id = p_layer_id
  for update;
  if not found then
    raise exception 'cost_layer_not_found';
  end if;

  v_package_id := v_layer.package_id;
  v_new_unit_cost := coalesce(p_unit_cost, v_layer.unit_cost);
  if v_new_unit_cost < 0 then
    raise exception 'invalid_unit_cost';
  end if;
  v_new_currency := coalesce(nullif(btrim(p_currency), ''), v_layer.currency);

  update public.package_cost_layers
  set unit_cost   = v_new_unit_cost,
      currency    = v_new_currency,
      note        = case
                      when p_note is null then note
                      when btrim(p_note) = '' then null
                      else btrim(p_note)
                    end,
      received_at = coalesce(p_received_at, received_at)
  where id = p_layer_id;

  if coalesce(p_cascade_to_consumptions, true) then
    update public.order_cost_consumptions
    set unit_cost = v_new_unit_cost,
        currency  = v_new_currency
    where cost_layer_id = p_layer_id;

    -- Orders that pre-dated FIFO may have no rows; rebuild snapshots for the package.
    perform public._backfill_package_order_costs(v_package_id);

    -- Re-apply layer cost to any rows linked to this layer (covers backfill just inserted).
    update public.order_cost_consumptions
    set unit_cost = v_new_unit_cost,
        currency  = v_new_currency
    where cost_layer_id = p_layer_id;
  end if;
end;
$$;
