-- Historical reconciliation must allocate against original purchased capacity.
-- Some legacy Salesforce fulfilment syncs already reduced quantity_remaining
-- without creating canonical allocations. Using current remaining would turn
-- valid purchased history into a false shortage (for example 42 sold / 40
-- purchased becoming a 42-place shortage instead of 40 allocated + 2 short).

create or replace function public.inventory_historical_allocatable_quantity(
  p_package_id text
)
returns int
language sql
stable
set search_path = public
as $$
  with ledger as (
    select public.resolve_cost_ledger_package_id(p_package_id) as package_id
  )
  select greatest(
    coalesce(sum(layer.quantity), 0)
      - coalesce((
          select sum(allocation.quantity)
          from public.inventory_allocations allocation
          join public.package_cost_layers allocation_layer
            on allocation_layer.id = allocation.cost_layer_id
          where allocation_layer.package_id = ledger.package_id
            and allocation.state in ('reserved', 'committed')
        ), 0),
    0
  )::int
  from ledger
  left join public.package_cost_layers layer
    on layer.package_id = ledger.package_id
  group by ledger.package_id;
$$;

create or replace function public.inventory_allocate_historical_quantity(
  p_package_id text,
  p_quantity int,
  p_request_key text,
  p_deal_id uuid,
  p_deal_line_item_id uuid,
  p_reason text default 'Applied historical won reconciliation',
  p_metadata jsonb default '{}'::jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ledger_package_id text;
  v_existing int;
  v_available int;
  v_remaining int;
  v_take int;
  v_layer record;
  v_now timestamptz := timezone('utc', now());
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if coalesce(p_quantity, 0) <= 0 then raise exception 'invalid_quantity'; end if;
  if nullif(btrim(p_request_key), '') is null then raise exception 'request_key_required'; end if;

  select coalesce(sum(allocation.quantity), 0)::int
  into v_existing
  from public.inventory_allocations allocation
  where allocation.request_key = btrim(p_request_key);
  if v_existing > 0 then
    if v_existing <> p_quantity then raise exception 'idempotency_quantity_mismatch'; end if;
    return v_existing;
  end if;

  v_ledger_package_id := public.resolve_cost_ledger_package_id(p_package_id);
  perform 1
  from public.package_inventory inventory
  where inventory.package_id in (p_package_id, v_ledger_package_id)
  order by inventory.package_id
  for update;
  perform 1
  from public.package_cost_layers layer
  where layer.package_id = v_ledger_package_id
  order by layer.received_at, layer.id
  for update;

  select coalesce(sum(allocation.quantity), 0)::int
  into v_existing
  from public.inventory_allocations allocation
  where allocation.request_key = btrim(p_request_key);
  if v_existing > 0 then
    if v_existing <> p_quantity then raise exception 'idempotency_quantity_mismatch'; end if;
    return v_existing;
  end if;

  v_available := public.inventory_historical_allocatable_quantity(p_package_id);
  if v_available < p_quantity then
    raise exception 'insufficient_historical_purchase_capacity:%:%:%',
      p_package_id, p_quantity, v_available;
  end if;

  v_remaining := p_quantity;
  for v_layer in
    select
      layer.*,
      greatest(
        layer.quantity - coalesce((
          select sum(allocation.quantity)
          from public.inventory_allocations allocation
          where allocation.cost_layer_id = layer.id
            and allocation.state in ('reserved', 'committed')
        ), 0),
        0
      )::int as allocatable
    from public.package_cost_layers layer
    where layer.package_id = v_ledger_package_id
    order by layer.received_at, layer.id
  loop
    exit when v_remaining = 0;
    v_take := least(v_layer.allocatable, v_remaining);
    if v_take <= 0 then continue; end if;

    insert into public.inventory_allocations (
      cost_layer_id, package_id, deal_id, deal_line_item_id,
      quantity, state, source, request_key, idempotency_key,
      committed_at, created_by, metadata
    ) values (
      v_layer.id, p_package_id, p_deal_id, p_deal_line_item_id,
      v_take, 'committed', 'historical_won_reconciliation',
      btrim(p_request_key),
      btrim(p_request_key) || ':layer:' || v_layer.id::text,
      v_now, auth.uid(),
      coalesce(p_metadata, '{}'::jsonb)
        || jsonb_build_object('reason', nullif(btrim(p_reason), ''))
    )
    on conflict (idempotency_key) do nothing;

    update public.package_cost_layers layer
    set quantity_remaining = least(
      layer.quantity_remaining,
      greatest(
        layer.quantity - coalesce((
          select sum(allocation.quantity)
          from public.inventory_allocations allocation
          where allocation.cost_layer_id = layer.id
            and allocation.state = 'committed'
        ), 0),
        0
      )
    )
    where layer.id = v_layer.id;
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining <> 0 then raise exception 'historical_allocation_incomplete'; end if;
  return p_quantity;
end;
$$;

create or replace function public.inventory_reconcile_historical_won(
  p_deal_id uuid,
  p_apply boolean default false,
  p_idempotency_key text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.deals%rowtype;
  v_line record;
  v_capacity int;
  v_prior_pending int;
  v_allocate int;
  v_shortage int;
  v_allocated_total int := 0;
  v_shortage_total int := 0;
  v_result jsonb := '[]'::jsonb;
  v_request_base text;
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if coalesce(p_apply, false) and nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'idempotency_key_required_for_apply';
  end if;

  select * into v_deal
  from public.deals
  where id = p_deal_id
  for update;
  if not found then raise exception 'deal_not_found'; end if;
  if v_deal.salesforce_opportunity_id is null then
    raise exception 'imported_salesforce_deal_required';
  end if;
  if v_deal.stage not in ('paid_confirmed', 'in_fulfilment', 'fulfilled') then
    raise exception 'historical_won_deal_required';
  end if;
  if v_deal.stock_reconciliation_status = 'reconciled' and coalesce(p_apply, false) then
    return jsonb_build_object(
      'deal_id', p_deal_id, 'apply', true, 'already_reconciled', true,
      'lines', '[]'::jsonb
    );
  end if;

  for v_line in
    select line.*
    from public.deal_line_items line
    where line.deal_id = p_deal_id
    order by line.sort_order, line.id
  loop
    v_request_base := coalesce(nullif(btrim(p_idempotency_key), ''), 'dry-run')
      || ':deal-line:' || v_line.id::text;

    if coalesce(v_line.sourcing_mode, 'owned') = 'brokered' then
      v_allocate := 0;
      v_shortage := v_line.quantity;
      if coalesce(p_apply, false) then
        insert into public.inventory_shortages (
          package_id, deal_id, deal_line_item_id, sourcing_shortage_id,
          shortage_type, quantity, status, source, idempotency_key,
          note, created_by, metadata
        ) values (
          v_line.package_id, p_deal_id, v_line.id, v_line.sourcing_shortage_id,
          'brokered', v_line.quantity, 'open', 'historical_won_reconciliation',
          v_request_base || ':brokered',
          coalesce(nullif(btrim(p_note), ''), 'Historical won brokered line'),
          auth.uid(), jsonb_build_object('salesforce_line_item_id', v_line.salesforce_line_item_id)
        ) on conflict (idempotency_key) do nothing;
      end if;
    else
      v_capacity := public.inventory_historical_allocatable_quantity(v_line.package_id);
      select coalesce(sum(prior_line.quantity), 0)::int
      into v_prior_pending
      from public.deal_line_items prior_line
      join public.deals prior_deal on prior_deal.id = prior_line.deal_id
      where prior_deal.salesforce_opportunity_id is not null
        and prior_deal.order_id is null
        and prior_deal.stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
        and coalesce(prior_deal.stock_reconciliation_status, 'pending') <> 'reconciled'
        and coalesce(prior_line.sourcing_mode, 'owned') = 'owned'
        and public.resolve_cost_ledger_package_id(prior_line.package_id)
          = public.resolve_cost_ledger_package_id(v_line.package_id)
        and (
          prior_deal.closed_at is null,
          coalesce(prior_deal.closed_at, 'infinity'::timestamptz),
          prior_deal.created_at,
          prior_deal.id,
          prior_line.sort_order,
          prior_line.id
        ) < (
          v_deal.closed_at is null,
          coalesce(v_deal.closed_at, 'infinity'::timestamptz),
          v_deal.created_at,
          v_deal.id,
          v_line.sort_order,
          v_line.id
        );

      v_allocate := least(
        v_line.quantity,
        greatest(v_capacity - v_prior_pending, 0)
      );
      v_shortage := v_line.quantity - v_allocate;

      if coalesce(p_apply, false) and v_allocate > 0 then
        perform public.inventory_allocate_historical_quantity(
          v_line.package_id, v_allocate, v_request_base || ':owned',
          p_deal_id, v_line.id,
          coalesce(nullif(btrim(p_note), ''), 'Applied historical won reconciliation'),
          jsonb_build_object(
            'salesforce_opportunity_id', v_deal.salesforce_opportunity_id,
            'salesforce_line_item_id', v_line.salesforce_line_item_id
          )
        );
      end if;
      if coalesce(p_apply, false) and v_shortage > 0 then
        insert into public.inventory_shortages (
          package_id, deal_id, deal_line_item_id, shortage_type, quantity,
          status, source, idempotency_key, note, created_by, metadata
        ) values (
          v_line.package_id, p_deal_id, v_line.id,
          'historical_reconciliation', v_shortage, 'open',
          'historical_won_reconciliation',
          v_request_base || ':shortage',
          coalesce(nullif(btrim(p_note), ''), 'Historical won quantity exceeds owned inventory'),
          auth.uid(), jsonb_build_object(
            'salesforce_opportunity_id', v_deal.salesforce_opportunity_id,
            'salesforce_line_item_id', v_line.salesforce_line_item_id
          )
        ) on conflict (idempotency_key) do nothing;
      end if;
    end if;

    v_allocated_total := v_allocated_total + v_allocate;
    v_shortage_total := v_shortage_total + v_shortage;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'deal_line_item_id', v_line.id,
      'package_id', v_line.package_id,
      'sourcing_mode', coalesce(v_line.sourcing_mode, 'owned'),
      'requested_quantity', v_line.quantity,
      'allocatable_quantity', v_allocate,
      'shortage_quantity', v_shortage
    ));
  end loop;

  if coalesce(p_apply, false) then
    update public.deals
    set stock_reconciliation_status = 'reconciled',
        updated_at = timezone('utc', now())
    where id = p_deal_id;

    insert into public.deal_activities (
      deal_id, actor_profile_id, action, summary, metadata
    ) values (
      p_deal_id, auth.uid(), 'inventory_reconciled',
      'Applied canonical historical won inventory reconciliation',
      jsonb_build_object(
        'idempotency_key', btrim(p_idempotency_key),
        'allocated_quantity', v_allocated_total,
        'shortage_quantity', v_shortage_total,
        'note', nullif(btrim(p_note), '')
      )
    );
  end if;

  return jsonb_build_object(
    'deal_id', p_deal_id,
    'apply', coalesce(p_apply, false),
    'allocated_quantity', v_allocated_total,
    'shortage_quantity', v_shortage_total,
    'lines', v_result
  );
end;
$$;

revoke all on function public.inventory_historical_allocatable_quantity(text) from public;
revoke all on function public.inventory_allocate_historical_quantity(
  text, int, text, uuid, uuid, text, jsonb
) from public;
grant execute on function public.inventory_historical_allocatable_quantity(text)
  to authenticated, service_role;
grant execute on function public.inventory_allocate_historical_quantity(
  text, int, text, uuid, uuid, text, jsonb
) to authenticated, service_role;

comment on function public.inventory_historical_allocatable_quantity(text) is
  'Original purchased capacity not yet represented by active canonical reservations or commitments; used only to reconstruct imported history.';
comment on function public.inventory_allocate_historical_quantity(
  text, int, text, uuid, uuid, text, jsonb
) is
  'Backfills imported historical commitments without double-decrementing cost layers already reduced by legacy fulfilment synchronization.';
