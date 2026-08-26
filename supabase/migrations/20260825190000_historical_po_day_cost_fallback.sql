-- Lines attached now to purchase orders that predate the linked-day costing
-- rollout are historical reconciliation, not new purchasing decisions. Allow
-- the same audited equal-day fallback used by the original migration backfill.
-- New/current purchase orders still require a valid derived or manual policy.

create or replace function public.freeze_new_cost_layer_day_components()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allow_historical_fallback boolean :=
    current_setting('inventory.allow_historical_cost_fallback', true) = 'on';
begin
  perform public.inventory_freeze_cost_layer_day_components(
    new.id,
    v_allow_historical_fallback
  );
  return new;
end;
$$;

create or replace function public.admin_add_purchase_order_cost_layer(
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
  v_allow_historical_fallback boolean := false;
  v_group_id text;
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_purchase_order_id is null then
    raise exception 'purchase_order_required';
  end if;

  select
    coalesce(purchase.issued_at::timestamptz, purchase.created_at)
      < timestamptz '2026-08-25 00:00:00+00'
  into v_allow_historical_fallback
  from public.purchase_orders purchase
  where purchase.id = p_purchase_order_id;
  if not found then raise exception 'purchase_order_not_found'; end if;

  if v_allow_historical_fallback then
    perform set_config('inventory.allow_historical_cost_fallback', 'on', true);
  end if;

  v_layer_id := public.admin_add_cost_layer(
    p_package_id,
    p_quantity,
    p_unit_cost,
    p_currency,
    p_note,
    p_received_at,
    p_source,
    p_purchase_order_id,
    p_fulfilment_block_id,
    p_source_package_id
  );

  perform set_config('inventory.allow_historical_cost_fallback', 'off', true);

  if v_allow_historical_fallback and exists (
    select 1
    from public.package_cost_layer_day_components component
    where component.cost_layer_id = v_layer_id
      and component.weight_source = 'historical_equal_fallback'
  ) then
    select package.inventory_group_id
    into v_group_id
    from public.packages package
    where package.id = coalesce(
      nullif(btrim(p_source_package_id), ''),
      p_package_id
    );

    update public.inventory_group_cost_policies
    set setup_required = true,
        setup_reason = 'historical_purchase_day_prices_missing',
        updated_at = timezone('utc', now())
    where inventory_group_id = v_group_id;
  end if;

  return v_layer_id;
exception
  when others then
    perform set_config('inventory.allow_historical_cost_fallback', 'off', true);
    raise;
end;
$$;

revoke all on function public.admin_add_purchase_order_cost_layer(
  text, int, numeric, text, text, timestamptz, text, uuid, uuid, text
) from public;
grant execute on function public.admin_add_purchase_order_cost_layer(
  text, int, numeric, text, text, timestamptz, text, uuid, uuid, text
) to authenticated, service_role;
