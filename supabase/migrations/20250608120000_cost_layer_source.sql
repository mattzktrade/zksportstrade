-- Stock purchase "source" (who we bought from, e.g. "F1 Direct") on cost layers.
-- Stored per purchase (cost layer); the product sync pushes the latest source to Salesforce.

alter table public.package_cost_layers
  add column if not exists source text;

-- ---------------------------------------------------------------------------
-- Recreate admin_add_cost_layer with an optional p_source (appended, default null).
-- Existing callers that omit p_source keep working.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_add_cost_layer(text, int, numeric, text, text, timestamptz);

create or replace function public.admin_add_cost_layer(
  p_package_id text,
  p_quantity int,
  p_unit_cost numeric,
  p_currency text default null,
  p_note text default null,
  p_received_at timestamptz default null,
  p_source text default null
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

  v_currency := coalesce(nullif(btrim(p_currency), ''), v_pkg_currency);
  v_received := coalesce(p_received_at, now());

  if not exists (select 1 from public.package_inventory pi where pi.package_id = p_package_id) then
    insert into public.package_inventory (package_id, qty_available, qty_held)
    values (p_package_id, 0, 0);
  end if;

  perform public.lock_package_inventory(p_package_id);

  insert into public.package_cost_layers (
    package_id, quantity, quantity_remaining, unit_cost, currency, note, source, received_at, created_by
  )
  values (
    p_package_id,
    p_quantity,
    p_quantity,
    p_unit_cost,
    v_currency,
    nullif(btrim(p_note), ''),
    nullif(btrim(p_source), ''),
    v_received,
    auth.uid()
  )
  returning id into v_layer_id;

  perform public.adjust_linked_inventory_available(p_package_id, p_quantity);

  return v_layer_id;
end;
$$;

revoke all on function public.admin_add_cost_layer(text, int, numeric, text, text, timestamptz, text) from public;
grant execute on function public.admin_add_cost_layer(text, int, numeric, text, text, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Lightweight setter so the cost-layer editor can change the source without
-- touching the buy-price / cascade logic.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_cost_layer_source(
  p_layer_id uuid,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  update public.package_cost_layers
  set source = nullif(btrim(p_source), '')
  where id = p_layer_id;

  if not found then
    raise exception 'cost_layer_not_found';
  end if;
end;
$$;

revoke all on function public.admin_set_cost_layer_source(uuid, text) from public;
grant execute on function public.admin_set_cost_layer_source(uuid, text) to authenticated;
