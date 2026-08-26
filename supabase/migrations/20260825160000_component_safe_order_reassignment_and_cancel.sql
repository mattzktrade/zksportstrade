-- Route the final legacy order reassignment/cancellation paths through
-- canonical allocation release/attach. Never restore aggregate layer stock
-- before the component-aware release function runs.

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
  v_order public.orders%rowtype;
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select * into v_order
  from public.orders orders
  where orders.id = p_order_id
  for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.status = 'cancelled' then raise exception 'order_cancelled'; end if;
  if v_order.package_id is null then
    raise exception 'package_required_for_legacy_order_allocation';
  end if;

  perform public.admin_reassign_order_package_stock(
    p_order_id,
    v_order.package_id,
    p_allocations
  );
end;
$$;

create or replace function public.admin_cancel_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_request record;
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_order_id is null then raise exception 'order_id_required'; end if;

  select * into v_order
  from public.orders orders
  where orders.id = p_order_id
  for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.status = 'cancelled' then raise exception 'already_cancelled'; end if;

  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.order_id = p_order_id
      and allocation.state <> 'released'
    order by allocation.request_key
  loop
    perform public.inventory_release_allocations(
      v_request.request_key,
      'Order cancelled',
      true
    );
  end loop;

  -- Removes any pre-canonical orphan COGS rows. The compatibility delete
  -- trigger releases a matching allocation if one still exists.
  delete from public.order_cost_consumptions
  where order_id = p_order_id;

  if v_order.package_id is not null then
    perform public.lock_package_inventory(v_order.package_id);
    perform public.adjust_linked_inventory_available(
      v_order.package_id,
      coalesce(v_order.guests, 0)
    );
  end if;

  update public.orders
  set status = 'cancelled'
  where id = p_order_id;

  return jsonb_build_object(
    'order_id', p_order_id,
    'order_reference', v_order.reference,
    'package_id', v_order.package_id,
    'guests_restored', coalesce(v_order.guests, 0)
  );
end;
$$;

create or replace function public.admin_cancel_native_deal_order(
  p_order_id uuid,
  p_reason text,
  p_xero_void_confirmed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_invoice public.invoices%rowtype;
  v_line record;
  v_request record;
begin
  if auth.role() is distinct from 'service_role'
    and not public.has_cms_permission('finance.manage')
    and not public.is_admin()
  then raise exception 'forbidden'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;

  select * into v_order
  from public.orders orders
  where orders.id = p_order_id
  for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.deal_id is null then raise exception 'native_deal_order_required'; end if;
  if v_order.status = 'cancelled' then
    return jsonb_build_object('order_id', v_order.id, 'already_cancelled', true);
  end if;

  select * into v_invoice
  from public.invoices invoice
  where invoice.order_id = v_order.id
  for update;
  if found and v_invoice.status in ('paid', 'delivered') then
    raise exception 'paid_or_delivered_order_cannot_be_cancelled';
  end if;
  if found
    and v_invoice.xero_invoice_id is not null
    and not coalesce(p_xero_void_confirmed, false)
  then
    raise exception 'xero_invoice_must_be_voided_first';
  end if;

  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.order_id = v_order.id
      and allocation.state <> 'released'
    order by allocation.request_key
  loop
    perform public.inventory_release_allocations(
      v_request.request_key,
      'Native deal order cancelled: ' || btrim(p_reason),
      true
    );
  end loop;

  delete from public.order_cost_consumptions
  where order_id = v_order.id;

  for v_line in
    select line.package_id, line.quantity, line.sourcing_mode,
      line.deal_line_item_id
    from public.order_line_items line
    where line.order_id = v_order.id
    order by line.sort_order, line.id
  loop
    if coalesce(v_line.sourcing_mode, 'owned') = 'owned' then
      perform public.lock_package_inventory(v_line.package_id);
      perform public.adjust_linked_inventory_available(
        v_line.package_id,
        v_line.quantity
      );
      insert into public.inventory_ledger_entries (
        package_id, entry_type, quantity_delta, reason, actor_profile_id,
        source_table, source_id, deal_id, metadata
      ) values (
        v_line.package_id, 'order_cancel', v_line.quantity, btrim(p_reason),
        auth.uid(), 'orders',
        v_order.id::text || ':' || v_line.package_id,
        v_order.deal_id, jsonb_build_object(
          'order_id', v_order.id,
          'day_component_release', true
        )
      )
      on conflict (source_table, source_id, entry_type) do nothing;
    else
      update public.sourcing_shortages
      set status = case when status = 'purchased' then status else 'cancelled' end,
          cleared_at = case
            when status = 'purchased' then cleared_at
            else timezone('utc', now())
          end,
          updated_at = timezone('utc', now()),
          note = concat_ws(E'\n', note, 'Order cancelled: ' || btrim(p_reason))
      where deal_line_item_id = v_line.deal_line_item_id;
    end if;
  end loop;

  update public.order_supplier_fulfilments
  set status = 'cancelled',
      updated_at = timezone('utc', now()),
      notes = concat_ws(E'\n', notes, 'Order cancelled: ' || btrim(p_reason))
  where order_id = v_order.id
    and status <> 'tickets_received';

  update public.orders
  set status = 'cancelled'
  where id = v_order.id;
  update public.invoices
  set status = 'cancelled',
      cancelled_at = timezone('utc', now()),
      reconciliation_note = btrim(p_reason)
  where order_id = v_order.id;
  update public.deals
  set stage = 'cancelled',
      next_action = null,
      next_action_due_at = null,
      closed_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_order.deal_id;
  insert into public.deal_activities (
    deal_id, actor_profile_id, action, summary, metadata
  ) values (
    v_order.deal_id,
    auth.uid(),
    'order_cancelled',
    btrim(p_reason),
    jsonb_build_object(
      'order_id', v_order.id,
      'xero_void_confirmed', p_xero_void_confirmed,
      'day_component_release', true
    )
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'deal_id', v_order.deal_id,
    'already_cancelled', false
  );
end;
$$;

create or replace function public._backfill_package_order_costs(
  p_package_id text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_available int;
  v_allocate int;
  v_shortage int;
  v_count int := 0;
begin
  if not exists (
    select 1 from public.packages package where package.id = p_package_id
  ) then
    raise exception 'package_not_found';
  end if;

  for v_order in
    with line_orders as (
      select
        orders.id as order_id,
        orders.deal_id,
        line.package_id,
        sum(line.quantity)::int as quantity,
        (array_agg(line.id order by line.sort_order, line.id))[1]
          as order_line_item_id
      from public.orders orders
      join public.order_line_items line on line.order_id = orders.id
      where orders.status <> 'cancelled'
        and line.package_id = p_package_id
        and coalesce(line.sourcing_mode, 'owned') = 'owned'
      group by orders.id, orders.deal_id, line.package_id
    ),
    legacy_orders as (
      select
        orders.id as order_id,
        orders.deal_id,
        orders.package_id,
        orders.guests::int as quantity,
        null::uuid as order_line_item_id
      from public.orders orders
      where orders.status <> 'cancelled'
        and orders.package_id = p_package_id
        and not exists (
          select 1 from public.order_line_items line
          where line.order_id = orders.id
        )
    )
    select candidate.*
    from (
      select * from line_orders
      union all
      select * from legacy_orders
    ) candidate
    where not exists (
      select 1
      from public.inventory_allocations allocation
      where allocation.order_id = candidate.order_id
        and allocation.package_id = candidate.package_id
        and allocation.state <> 'released'
    )
      and not exists (
        select 1
        from public.order_cost_consumptions consumption
        where consumption.order_id = candidate.order_id
          and consumption.package_id = candidate.package_id
      )
    order by candidate.order_id
  loop
    v_available :=
      public.inventory_package_allocatable_quantity(v_order.package_id);
    v_allocate := least(v_order.quantity, v_available);
    v_shortage := v_order.quantity - v_allocate;

    if v_allocate > 0 then
      perform public.inventory_allocate_quantity(
        v_order.package_id,
        v_allocate,
        'committed',
        'admin_backfill_package_order_costs',
        'order-cost-backfill:' || v_order.order_id::text
          || ':' || v_order.package_id,
        v_order.deal_id,
        (
          select line.deal_line_item_id
          from public.order_line_items line
          where line.id = v_order.order_line_item_id
        ),
        v_order.order_id,
        v_order.order_line_item_id,
        null,
        'Backfilled missing order COGS through day components',
        jsonb_build_object('historical_order_backfill', true)
      );
    end if;

    if v_shortage > 0 then
      insert into public.inventory_shortages (
        package_id,
        deal_id,
        order_id,
        order_line_item_id,
        shortage_type,
        quantity,
        status,
        source,
        idempotency_key,
        note,
        created_by,
        metadata
      ) values (
        v_order.package_id,
        v_order.deal_id,
        v_order.order_id,
        v_order.order_line_item_id,
        'historical_reconciliation',
        v_shortage,
        'open',
        'admin_backfill_package_order_costs',
        'order-cost-backfill-shortage:' || v_order.order_id::text
          || ':' || v_order.package_id,
        'Historical order did not have enough purchased day capacity',
        auth.uid(),
        jsonb_build_object(
          'requested_quantity', v_order.quantity,
          'allocated_quantity', v_allocate,
          'historical_order_backfill', true
        )
      )
      on conflict (idempotency_key) do nothing;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.admin_backfill_package_order_costs(
  p_package_id text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  return public._backfill_package_order_costs(p_package_id);
end;
$$;

revoke all on function public.admin_set_order_cost_allocations(uuid, jsonb)
  from public;
grant execute on function public.admin_set_order_cost_allocations(uuid, jsonb)
  to authenticated, service_role;
revoke all on function public.admin_cancel_order(uuid) from public;
grant execute on function public.admin_cancel_order(uuid)
  to authenticated, service_role;
revoke all on function public.admin_cancel_native_deal_order(uuid, text, boolean)
  from public;
grant execute on function public.admin_cancel_native_deal_order(
  uuid, text, boolean
) to authenticated, service_role;
revoke all on function public._backfill_package_order_costs(text) from public;
revoke all on function public.admin_backfill_package_order_costs(text)
  from public;
grant execute on function public.admin_backfill_package_order_costs(text)
  to authenticated, service_role;
