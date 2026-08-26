-- Supplier swaps must release all participating allocations before assigning
-- their replacements. This permits balanced swaps between suppliers that each
-- currently show zero remaining stock without ever overselling either layer.

create or replace function public.inventory_swap_deal_line_suppliers(
  p_assignments jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment record;
  v_request record;
  v_expected_count int;
  v_actual_count int;
begin
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('deals.manage')
  then
    raise exception 'forbidden';
  end if;

  if jsonb_typeof(p_assignments) is distinct from 'array'
    or jsonb_array_length(p_assignments) = 0
  then
    raise exception 'assignments_required';
  end if;

  select count(*), count(distinct assignment.line_id)
  into v_expected_count, v_actual_count
  from (
    select (value->>'lineId')::uuid as line_id
    from jsonb_array_elements(p_assignments)
  ) assignment;
  if v_expected_count <> v_actual_count then
    raise exception 'duplicate_deal_line_assignment';
  end if;

  -- Lock every participating deal line and validate it before releasing stock.
  perform 1
  from public.deal_line_items line
  join public.deals deal on deal.id = line.deal_id
  where line.id in (
    select (value->>'lineId')::uuid
    from jsonb_array_elements(p_assignments)
  )
    and coalesce(line.sourcing_mode, 'owned') = 'owned'
    and deal.stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
  order by line.id
  for update of line;
  get diagnostics v_actual_count = row_count;
  if v_actual_count <> v_expected_count then
    raise exception 'invalid_deal_line_assignment';
  end if;

  -- Lock current and requested layers in one deterministic order.
  perform 1
  from public.package_cost_layers layer
  where layer.id in (
    select (value->>'costLayerId')::uuid
    from jsonb_array_elements(p_assignments)
  )
    or layer.id in (
      select allocation.cost_layer_id
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id in (
        select (value->>'lineId')::uuid
        from jsonb_array_elements(p_assignments)
      )
        and allocation.state <> 'released'
        and allocation.cost_layer_id is not null
    )
  order by layer.id
  for update;

  -- Free both sides of the swap first. The enclosing function transaction
  -- guarantees that any later failure restores every original allocation.
  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.deal_line_item_id in (
      select (value->>'lineId')::uuid
      from jsonb_array_elements(p_assignments)
    )
      and allocation.state <> 'released'
    order by allocation.request_key
  loop
    perform public.inventory_release_allocations(
      v_request.request_key,
      'Supplier assignments swapped as one batch',
      true
    );
  end loop;

  for v_assignment in
    select
      (value->>'lineId')::uuid as line_id,
      (value->>'costLayerId')::uuid as cost_layer_id
    from jsonb_array_elements(p_assignments)
  loop
    perform public.inventory_reassign_deal_line(
      v_assignment.line_id,
      v_assignment.cost_layer_id
    );
  end loop;
end;
$$;

revoke all on function public.inventory_swap_deal_line_suppliers(jsonb) from public;
grant execute on function public.inventory_swap_deal_line_suppliers(jsonb)
  to authenticated, service_role;
