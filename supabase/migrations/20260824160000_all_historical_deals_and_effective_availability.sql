-- Include fulfilled historical deals that were imported without a Salesforce
-- opportunity id. Until they are reconciled, their uncovered owned demand must
-- still reduce every channel's sellable quantity.

update public.deals
set stock_reconciliation_status = 'pending',
    updated_at = timezone('utc', now())
where order_id is null
  and stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
  and coalesce(stock_reconciliation_status, 'pending') <> 'reconciled';

create or replace function public.inventory_package_unallocated_won_quantity(
  p_package_id text
)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce(sum(greatest(
    line.quantity - coalesce((
      select sum(allocation.quantity)
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id = line.id
        and allocation.state in ('reserved', 'committed')
    ), 0),
    0
  )), 0)::int
  from public.deal_line_items line
  join public.deals deal on deal.id = line.deal_id
  where deal.order_id is null
    and deal.stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
    and deal.stock_reconciliation_status = 'pending'
    and coalesce(line.sourcing_mode, 'owned') = 'owned'
    and public.resolve_cost_ledger_package_id(line.package_id)
      = public.resolve_cost_ledger_package_id(p_package_id);
$$;

create or replace function public.inventory_package_allocatable_quantity(p_package_id text)
returns int
language plpgsql
stable
set search_path = public
as $$
declare
  v_ledger_package_id text;
  v_quantity int;
begin
  v_ledger_package_id := public.resolve_cost_ledger_package_id(p_package_id);
  select coalesce(sum(
    greatest(
      layer.quantity_remaining
      - public.inventory_layer_reserved_quantity(layer.id),
      0
    )
  ), 0)::int
  into v_quantity
  from public.package_cost_layers layer
  where layer.package_id = v_ledger_package_id;
  return greatest(
    coalesce(v_quantity, 0)
      - public.inventory_package_manual_hold_quantity(p_package_id)
      - public.inventory_package_unallocated_won_quantity(p_package_id),
    0
  );
end;
$$;

alter view public.inventory_availability rename to inventory_availability_layer_base;

create or replace view public.inventory_availability as
select
  base.package_id,
  base.race_id,
  base.name,
  base.duration,
  base.inventory_group_id,
  base.inventory_pool_id,
  base.shell_parent_package_id,
  base.is_legacy_shell,
  base.ledger_package_id,
  base.layer_original_quantity,
  base.layer_quantity_remaining,
  base.reserved_quantity,
  base.manual_hold_quantity,
  base.committed_quantity,
  least(
    base.available_quantity,
    public.inventory_package_allocatable_quantity(base.package_id)
  )::int as available_quantity,
  base.historical_shortage_quantity,
  base.brokered_shortage_quantity,
  base.legacy_qty_available,
  base.legacy_qty_held
from public.inventory_availability_layer_base base;

grant select on public.inventory_availability to authenticated, service_role;

create or replace function public.inventory_apply_historical_deal(
  p_deal_id uuid,
  p_idempotency_key text,
  p_note text default 'Historical inventory batch reconciliation'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.deals%rowtype;
  v_line record;
  v_available int;
  v_existing int;
  v_needed int;
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
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'idempotency_key_required_for_apply';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'deal_not_found'; end if;
  if v_deal.stock_reconciliation_status = 'reconciled' then
    return jsonb_build_object(
      'deal_id', p_deal_id, 'apply', true, 'already_reconciled', true,
      'allocated_quantity', 0, 'shortage_quantity', 0, 'lines', '[]'::jsonb
    );
  end if;
  if v_deal.order_id is not null
    or v_deal.stage not in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
  then raise exception 'historical_won_deal_required'; end if;

  for v_line in
    select line.* from public.deal_line_items line
    where line.deal_id = p_deal_id
    order by line.sort_order, line.id
  loop
    v_request_base := btrim(p_idempotency_key) || ':deal-line:' || v_line.id::text;
    select coalesce(sum(allocation.quantity), 0)::int
    into v_existing
    from public.inventory_allocations allocation
    where allocation.deal_line_item_id = v_line.id
      and allocation.state in ('reserved', 'committed');
    v_needed := greatest(v_line.quantity - v_existing, 0);
    if coalesce(v_line.sourcing_mode, 'owned') = 'brokered' then
      v_allocate := 0;
      v_shortage := v_needed;
      if v_shortage > 0 then
        insert into public.inventory_shortages (
          package_id, deal_id, deal_line_item_id, sourcing_shortage_id,
          shortage_type, quantity, status, source, idempotency_key,
          note, created_by, metadata
        ) values (
          v_line.package_id, p_deal_id, v_line.id, v_line.sourcing_shortage_id,
          'brokered', v_shortage, 'open', 'historical_won_reconciliation',
          v_request_base || ':brokered', p_note, auth.uid(),
          jsonb_build_object('salesforce_line_item_id', v_line.salesforce_line_item_id)
        ) on conflict (idempotency_key) do nothing;
      end if;
    else
      v_available := public.inventory_historical_allocatable_quantity(v_line.package_id);
      v_allocate := least(v_needed, v_available);
      v_shortage := v_needed - v_allocate;
      if v_allocate > 0 then
        perform public.inventory_allocate_historical_quantity(
          v_line.package_id, v_allocate, v_request_base || ':owned',
          p_deal_id, v_line.id, p_note,
          jsonb_build_object(
            'salesforce_opportunity_id', v_deal.salesforce_opportunity_id,
            'salesforce_line_item_id', v_line.salesforce_line_item_id
          )
        );
      end if;
      if v_shortage > 0 then
        insert into public.inventory_shortages (
          package_id, deal_id, deal_line_item_id, shortage_type, quantity,
          status, source, idempotency_key, note, created_by, metadata
        ) values (
          v_line.package_id, p_deal_id, v_line.id,
          'historical_reconciliation', v_shortage, 'open',
          'historical_won_reconciliation', v_request_base || ':shortage',
          'Historical won quantity exceeds owned inventory', auth.uid(),
          jsonb_build_object(
            'salesforce_opportunity_id', v_deal.salesforce_opportunity_id,
            'salesforce_line_item_id', v_line.salesforce_line_item_id
          )
        ) on conflict (idempotency_key) do nothing;
      end if;
    end if;
    v_allocated_total := v_allocated_total + v_allocate;
    v_shortage_total := v_shortage_total + v_shortage;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'deal_line_item_id', v_line.id, 'package_id', v_line.package_id,
      'sourcing_mode', coalesce(v_line.sourcing_mode, 'owned'),
      'requested_quantity', v_line.quantity,
      'previously_allocated_quantity', v_existing,
      'allocatable_quantity', v_allocate, 'shortage_quantity', v_shortage
    ));
  end loop;

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
  return jsonb_build_object(
    'deal_id', p_deal_id, 'apply', true,
    'allocated_quantity', v_allocated_total,
    'shortage_quantity', v_shortage_total, 'lines', v_result
  );
end;
$$;

create or replace function public.inventory_reconcile_historical_inventory(
  p_apply boolean default false,
  p_idempotency_key text default null,
  p_limit int default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal record;
  v_result jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_allocated int := 0;
  v_shortage int := 0;
  v_count int := 0;
  v_remaining_deals int := 0;
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if coalesce(p_apply, false) and nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'idempotency_key_required_for_apply';
  end if;

  if not coalesce(p_apply, false) then
    with eligible_lines as (
      select
        deal.id as deal_id, line.id as line_id,
        greatest(
          line.quantity - coalesce((
            select sum(allocation.quantity)
            from public.inventory_allocations allocation
            where allocation.deal_line_item_id = line.id
              and allocation.state in ('reserved', 'committed')
          ), 0),
          0
        )::int as quantity,
        coalesce(line.sourcing_mode, 'owned') as sourcing_mode,
        public.resolve_cost_ledger_package_id(line.package_id) as ledger_package_id,
        deal.closed_at, deal.created_at as deal_created_at, line.sort_order
      from public.deals deal
      join public.deal_line_items line on line.deal_id = deal.id
      where deal.order_id is null
        and deal.stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
        and deal.stock_reconciliation_status = 'pending'
    ),
    ledger_capacities as (
      select
        ledger.package_id as ledger_package_id,
        greatest(
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
        )::int as capacity
      from (
        select distinct ledger_package_id as package_id
        from eligible_lines where sourcing_mode = 'owned'
      ) ledger
      left join public.package_cost_layers layer on layer.package_id = ledger.package_id
      group by ledger.package_id
    ),
    ordered_lines as (
      select
        line.*,
        coalesce(sum(line.quantity) over (
          partition by line.ledger_package_id
          order by line.closed_at nulls last, line.deal_created_at,
            line.deal_id, line.sort_order, line.line_id
          rows between unbounded preceding and 1 preceding
        ), 0)::int as prior_owned_quantity
      from eligible_lines line where line.sourcing_mode = 'owned'
    ),
    planned_lines as (
      select
        line.deal_id,
        least(line.quantity, greatest(capacity.capacity - line.prior_owned_quantity, 0))::int
          as allocated_quantity,
        line.quantity - least(
          line.quantity, greatest(capacity.capacity - line.prior_owned_quantity, 0)
        )::int as shortage_quantity
      from ordered_lines line
      join ledger_capacities capacity
        on capacity.ledger_package_id = line.ledger_package_id
      union all
      select line.deal_id, 0, line.quantity
      from eligible_lines line where line.sourcing_mode = 'brokered'
    )
    select
      count(distinct eligible.deal_id)::int,
      coalesce(sum(plan.allocated_quantity), 0)::int,
      coalesce(sum(plan.shortage_quantity), 0)::int
    into v_count, v_allocated, v_shortage
    from (select distinct deal_id from eligible_lines) eligible
    left join planned_lines plan on plan.deal_id = eligible.deal_id;
    return jsonb_build_object(
      'apply', false, 'deal_count', v_count,
      'allocated_quantity', v_allocated, 'shortage_quantity', v_shortage,
      'remaining_deal_count', v_count, 'deals', '[]'::jsonb
    );
  end if;

  for v_deal in
    select deal.id from public.deals deal
    where deal.order_id is null
      and deal.stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
      and deal.stock_reconciliation_status = 'pending'
    order by deal.closed_at nulls last, deal.created_at, deal.id
    limit greatest(1, least(coalesce(p_limit, 25), 25))
  loop
    v_result := public.inventory_apply_historical_deal(
      v_deal.id,
      btrim(p_idempotency_key) || ':deal:' || v_deal.id::text,
      'Historical inventory batch reconciliation'
    );
    v_rows := v_rows || jsonb_build_array(v_result);
    v_allocated := v_allocated + coalesce((v_result->>'allocated_quantity')::int, 0);
    v_shortage := v_shortage + coalesce((v_result->>'shortage_quantity')::int, 0);
    v_count := v_count + 1;
  end loop;
  select count(*)::int into v_remaining_deals
  from public.deals deal
  where deal.order_id is null
    and deal.stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
    and deal.stock_reconciliation_status = 'pending';
  return jsonb_build_object(
    'apply', true, 'deal_count', v_count,
    'allocated_quantity', v_allocated, 'shortage_quantity', v_shortage,
    'remaining_deal_count', v_remaining_deals, 'deals', v_rows
  );
end;
$$;

revoke all on function public.inventory_package_unallocated_won_quantity(text)
  from public;
grant execute on function public.inventory_package_unallocated_won_quantity(text)
  to authenticated, service_role;
