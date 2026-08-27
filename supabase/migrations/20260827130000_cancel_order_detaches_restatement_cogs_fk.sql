-- Cancelling an order deletes compatibility COGS rows. Those rows have an
-- ON DELETE SET NULL FK into inventory_cost_restatement_events. That UPDATE
-- is not a mutation of the frozen cost numbers; it only detaches the deleted
-- COGS pointer so the append-only restatement row can survive. Without this
-- exception, unpaid order cancel fails after day-cost restatement backfill.

create or replace function public.prevent_inventory_component_audit_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'inventory_cost_restatement_events'
    and current_setting('inventory.component_stock_delete', true) = 'on'
    and tg_op = 'UPDATE'
    and new.cost_layer_id is null
    and old.cost_layer_id is not null
  then
    return new;
  end if;

  if tg_table_name = 'inventory_cost_restatement_events'
    and tg_op = 'UPDATE'
    and new.order_cost_consumption_id is null
    and old.order_cost_consumption_id is not null
    and new.allocation_id is not distinct from old.allocation_id
    and new.cost_layer_id is not distinct from old.cost_layer_id
    and new.old_unit_cost is not distinct from old.old_unit_cost
    and new.new_unit_cost is not distinct from old.new_unit_cost
    and new.old_currency is not distinct from old.old_currency
    and new.new_currency is not distinct from old.new_currency
    and new.reason is not distinct from old.reason
    and new.idempotency_key is not distinct from old.idempotency_key
    and new.metadata is not distinct from old.metadata
    and new.actor_profile_id is not distinct from old.actor_profile_id
    and new.occurred_at is not distinct from old.occurred_at
  then
    return new;
  end if;

  raise exception 'inventory_component_audit_rows_are_append_only';
end;
$$;

-- Detach frozen restatement pointers before deleting COGS, then restore
-- day remaining. Cancelling a restated order must not rewrite cost numbers.
create or replace function public.inventory_release_allocations(
  p_request_key text,
  p_reason text,
  p_allow_committed boolean default false
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allocation record;
  v_component record;
  v_released int := 0;
begin
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('operations.manage')
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;
  if nullif(btrim(p_request_key), '') is null then
    raise exception 'request_key_required';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;

  perform 1
  from public.inventory_allocations allocation
  where allocation.request_key = btrim(p_request_key)
    and allocation.state <> 'released'
  order by allocation.cost_layer_id, allocation.id
  for update;

  perform 1
  from public.package_cost_layer_day_components component
  join public.inventory_allocation_day_components allocation_component
    on allocation_component.cost_layer_day_component_id = component.id
  join public.inventory_allocations allocation
    on allocation.id = allocation_component.allocation_id
  where allocation.request_key = btrim(p_request_key)
    and allocation.state <> 'released'
  order by component.cost_layer_id, component.day_slot
  for update of component;

  for v_allocation in
    select *
    from public.inventory_allocations allocation
    where allocation.request_key = btrim(p_request_key)
      and allocation.state <> 'released'
    order by allocation.cost_layer_id, allocation.id
  loop
    if v_allocation.lock_state = 'fulfilment_locked' then
      raise exception 'allocation_fulfilment_locked:%', v_allocation.id;
    end if;
    if v_allocation.state = 'committed'
      and not coalesce(p_allow_committed, false)
    then
      raise exception 'committed_release_requires_explicit_override';
    end if;

    if v_allocation.state = 'committed' then
      for v_component in
        select
          component.id,
          component.quantity_total,
          allocation_component.consumed_units
        from public.inventory_allocation_day_components allocation_component
        join public.package_cost_layer_day_components component
          on component.id = allocation_component.cost_layer_day_component_id
        where allocation_component.allocation_id = v_allocation.id
        order by component.day_slot
      loop
        update public.package_cost_layer_day_components
        set quantity_remaining = least(
          quantity_total,
          quantity_remaining + v_component.consumed_units
        )
        where id = v_component.id;
      end loop;
      perform public.inventory_recompute_layer_remaining(
        v_allocation.cost_layer_id
      );
      if v_allocation.order_cost_consumption_id is not null then
        update public.inventory_cost_restatement_events
        set order_cost_consumption_id = null
        where order_cost_consumption_id = v_allocation.order_cost_consumption_id;
        perform set_config('inventory.canonical_write', 'on', true);
        delete from public.order_cost_consumptions
        where id = v_allocation.order_cost_consumption_id;
        perform set_config('inventory.canonical_write', 'off', true);
      end if;
    end if;

    update public.inventory_allocations
    set state = 'released',
        released_at = timezone('utc', now()),
        updated_at = timezone('utc', now()),
        metadata = metadata || jsonb_build_object('reason', btrim(p_reason))
    where id = v_allocation.id;
    v_released := v_released + v_allocation.quantity;
  end loop;
  return v_released;
end;
$$;
