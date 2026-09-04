-- Signed sales without purchased stock must appear on the negative-stock list
-- and reduce canonical net quantity below zero. Brokered quotes must survive
-- stage changes. Booking forms can be sent without owned stock; purchasing
-- happens after both signatures.

create or replace function public.inventory_sync_deal_line_shortage(
  p_deal_line_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.deal_line_items%rowtype;
  v_deal public.deals%rowtype;
  v_allocated int := 0;
  v_uncovered int := 0;
  v_pool_id uuid;
  v_sold boolean;
  v_sourcing_status text;
  v_shortage_id uuid;
  v_note text;
begin
  if p_deal_line_item_id is null then return; end if;

  select * into v_line from public.deal_line_items where id = p_deal_line_item_id;
  if not found then return; end if;
  select * into v_deal from public.deals where id = v_line.deal_id;
  if not found then return; end if;

  select package.inventory_pool_id into v_pool_id
  from public.packages package
  where package.id = v_line.package_id;

  select coalesce(sum(allocation.quantity), 0)::int
  into v_allocated
  from public.inventory_allocations allocation
  where allocation.deal_line_item_id = v_line.id
    and allocation.state in ('reserved', 'committed');

  v_sold := public.deal_stage_holds_purchased_stock(v_deal.stage)
    and v_deal.stage not in ('closed_lost', 'cancelled');

  if v_deal.stage in ('closed_lost', 'cancelled') then
    update public.inventory_shortages
    set status = 'cancelled',
        resolved_at = coalesce(resolved_at, timezone('utc', now())),
        updated_at = timezone('utc', now()),
        metadata = metadata || jsonb_build_object('cancel_reason', v_deal.stage)
    where deal_line_item_id = v_line.id and status = 'open';
    update public.sourcing_shortages
    set status = case when status = 'purchased' then status else 'cancelled' end,
        cleared_at = case when status = 'purchased' then cleared_at else timezone('utc', now()) end,
        updated_at = timezone('utc', now())
    where deal_line_item_id = v_line.id
      and status not in ('purchased', 'cancelled');
    return;
  end if;

  if coalesce(v_line.sourcing_mode, 'owned') = 'brokered' then
    if exists (
      select 1
      from public.sourcing_shortages shortage
      where shortage.deal_line_item_id = v_line.id
        and shortage.status = 'purchased'
    ) then
      v_uncovered := 0;
    else
      v_uncovered := v_line.quantity;
    end if;

    if not v_sold then
      return;
    end if;

    if v_uncovered <= 0 then
      update public.inventory_shortages
      set status = 'resolved',
          resolved_at = coalesce(resolved_at, timezone('utc', now())),
          updated_at = timezone('utc', now())
      where deal_line_item_id = v_line.id
        and status = 'open'
        and shortage_type = 'brokered';
      return;
    end if;

    v_sourcing_status := case
      when v_line.supplier_id is not null and v_line.expected_unit_cost is not null
        then 'confirmed'
      when v_line.supplier_id is not null then 'quoted'
      else 'open'
    end;
    v_note := case
      when v_line.supplier_id is not null and v_line.expected_unit_cost is not null
        then 'Brokered signed sale waiting for purchase'
      else 'Signed sale waiting for a supplier purchase'
    end;

    insert into public.sourcing_shortages (
      package_id, pool_id, deal_id, deal_line_item_id, quantity,
      unit_cost_quoted, currency, supplier_id, supplier_quote_at,
      status, note, created_by
    ) values (
      v_line.package_id, v_pool_id, v_line.deal_id, v_line.id, v_uncovered,
      v_line.expected_unit_cost, coalesce(v_deal.currency, 'USD'),
      v_line.supplier_id, v_line.supplier_quote_at,
      v_sourcing_status, v_note, auth.uid()
    )
    on conflict (deal_line_item_id)
      where deal_line_item_id is not null and status <> 'cancelled'
    do update set
      quantity = excluded.quantity,
      unit_cost_quoted = excluded.unit_cost_quoted,
      supplier_id = excluded.supplier_id,
      supplier_quote_at = excluded.supplier_quote_at,
      status = excluded.status,
      note = excluded.note,
      updated_at = timezone('utc', now())
    returning id into v_shortage_id;

    update public.deal_line_items
    set sourcing_shortage_id = coalesce(sourcing_shortage_id, v_shortage_id),
        updated_at = timezone('utc', now())
    where id = v_line.id;

    if not exists (
      select 1
      from public.inventory_shortages shortage
      where shortage.deal_line_item_id = v_line.id
        and shortage.status = 'open'
        and shortage.shortage_type = 'brokered'
    ) then
      insert into public.inventory_shortages (
        package_id, deal_id, deal_line_item_id, sourcing_shortage_id,
        shortage_type, quantity, status, source, idempotency_key, note,
        created_by, metadata
      ) values (
        v_line.package_id, v_line.deal_id, v_line.id, v_shortage_id,
        'brokered', v_uncovered, 'open', 'uncovered_signed_deal',
        'uncovered-deal-line:' || v_line.id::text, v_note, auth.uid(),
        jsonb_build_object('sourcing_mode', 'brokered')
      )
      on conflict (idempotency_key) do update set
        quantity = excluded.quantity,
        status = 'open',
        shortage_type = 'brokered',
        sourcing_shortage_id = excluded.sourcing_shortage_id,
        resolved_at = null,
        note = excluded.note,
        updated_at = timezone('utc', now());
    end if;
    return;
  end if;

  v_uncovered := greatest(v_line.quantity - v_allocated, 0);
  if not v_sold then
    update public.inventory_shortages
    set status = 'resolved',
        resolved_at = coalesce(resolved_at, timezone('utc', now())),
        updated_at = timezone('utc', now())
    where deal_line_item_id = v_line.id
      and status = 'open'
      and shortage_type = 'historical_reconciliation'
      and idempotency_key = 'uncovered-deal-line:' || v_line.id::text;
    return;
  end if;

  if v_uncovered <= 0 then
    update public.inventory_shortages
    set status = 'resolved',
        resolved_at = coalesce(resolved_at, timezone('utc', now())),
        updated_at = timezone('utc', now())
    where deal_line_item_id = v_line.id and status = 'open';
    return;
  end if;

  update public.inventory_shortages
  set quantity = v_uncovered,
      status = 'open',
      resolved_at = null,
      updated_at = timezone('utc', now()),
      note = coalesce(note, 'Signed sale is not covered by purchased stock')
  where deal_line_item_id = v_line.id
    and status = 'open'
    and shortage_type = 'historical_reconciliation'
    and idempotency_key = 'uncovered-deal-line:' || v_line.id::text;
  if not found then
    if not exists (
      select 1
      from public.inventory_shortages shortage
      where shortage.deal_line_item_id = v_line.id
        and shortage.status = 'open'
        and shortage.shortage_type = 'historical_reconciliation'
    ) then
      insert into public.inventory_shortages (
        package_id, deal_id, deal_line_item_id, shortage_type, quantity,
        status, source, idempotency_key, note, created_by, metadata
      ) values (
        v_line.package_id, v_line.deal_id, v_line.id, 'historical_reconciliation',
        v_uncovered, 'open', 'uncovered_signed_deal',
        'uncovered-deal-line:' || v_line.id::text,
        'Signed sale is not covered by purchased stock',
        auth.uid(),
        jsonb_build_object('sourcing_mode', 'owned')
      )
      on conflict (idempotency_key) do update set
        quantity = excluded.quantity,
        status = 'open',
        shortage_type = 'historical_reconciliation',
        resolved_at = null,
        note = excluded.note,
        updated_at = timezone('utc', now());
    end if;
  end if;

  perform public.inventory_cover_historical_shortages(
    v_line.package_id,
    'uncovered-sync:' || v_line.id::text
  );
end;
$$;

revoke all on function public.inventory_sync_deal_line_shortage(uuid) from public;
grant execute on function public.inventory_sync_deal_line_shortage(uuid)
  to authenticated, service_role;

comment on function public.inventory_sync_deal_line_shortage(uuid) is
  'Records purchase-queue shortages for signed deal lines that are not covered by owned stock.';

create or replace function public.inventory_reassign_deal_line(
  p_deal_line_item_id uuid,
  p_preferred_cost_layer_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.deal_line_items%rowtype;
  v_deal public.deals%rowtype;
  v_request record;
  v_request_key text;
  v_allowed uuid[];
  v_preferred_available int := 0;
begin
  if session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;

  select * into v_line from public.deal_line_items
  where id = p_deal_line_item_id for update;
  if not found then raise exception 'deal_line_not_found'; end if;
  select * into v_deal from public.deals
  where id = v_line.deal_id for update;
  if not found then raise exception 'deal_not_found'; end if;

  if p_preferred_cost_layer_id is not null
    and not public.inventory_layer_is_candidate(
      p_preferred_cost_layer_id, v_line.package_id
    )
  then raise exception 'invalid_cost_layer_for_package'; end if;

  perform 1 from public.packages package
  where package.id = v_line.package_id
  for update;
  perform 1
  from public.deal_line_items line
  join public.deals deal on deal.id = line.deal_id
  where line.package_id = v_line.package_id
    and coalesce(line.sourcing_mode, 'owned') = 'owned'
    and public.deal_stage_holds_purchased_stock(deal.stage)
  order by line.id
  for update of line;
  perform 1
  from public.package_cost_layers layer
  where public.inventory_layer_is_candidate(layer.id, v_line.package_id)
    or (p_preferred_cost_layer_id is not null
      and layer.id = p_preferred_cost_layer_id)
    or layer.id in (
      select allocation.cost_layer_id
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id = v_line.id
        and allocation.state <> 'released'
    )
  order by layer.id
  for update;

  for v_request in
    select distinct allocation.request_key
    from public.inventory_allocations allocation
    where allocation.deal_line_item_id = v_line.id
      and allocation.state <> 'released'
    order by allocation.request_key
  loop
    perform public.inventory_release_allocations(
      v_request.request_key,
      'Deal product, quantity, or supplier changed',
      true
    );
  end loop;

  if not public.deal_stage_holds_purchased_stock(v_deal.stage) then
    update public.deal_line_items
    set fulfilment_cost_layer_id = null,
        supplier_id = case
          when coalesce(v_line.sourcing_mode, 'owned') = 'brokered' then supplier_id
          else null
        end,
        expected_unit_cost = case
          when coalesce(v_line.sourcing_mode, 'owned') = 'brokered' then expected_unit_cost
          else null
        end,
        updated_at = timezone('utc', now())
    where id = v_line.id;
    perform public.inventory_sync_deal_line_shortage(v_line.id);
    return;
  end if;

  if coalesce(v_line.sourcing_mode, 'owned') = 'brokered' then
    update public.deal_line_items
    set fulfilment_cost_layer_id = null,
        updated_at = timezone('utc', now())
    where id = v_line.id;
    perform public.inventory_sync_deal_line_shortage(v_line.id);
    return;
  end if;

  if p_preferred_cost_layer_id is not null then
    v_request_key := 'deal-line-reassign:' || v_line.id::text
      || ':' || gen_random_uuid()::text;
    perform public.inventory_allocate_quantity_from_layers(
      v_line.package_id, v_line.quantity, 'committed',
      'deal_line_supplier_reassignment',
      v_request_key,
      array[p_preferred_cost_layer_id],
      v_line.deal_id, v_line.id, null, null, null,
      'Signed deal inventory reassigned',
      jsonb_build_object(
        'automatic', false,
        'preferred_cost_layer_id', p_preferred_cost_layer_id
      )
    );
    perform public.inventory_sync_deal_line_shortage(v_line.id);
    return;
  end if;

  v_allowed := null;
  if current_setting('inventory.repacking', true) is distinct from 'on' then
    select array_agg(layer.id order by layer.id)
    into v_allowed
    from public.package_cost_layers layer
    left join public.purchase_orders purchase
      on purchase.id = layer.purchase_order_id
    where public.inventory_layer_is_candidate(layer.id, v_line.package_id)
      and public.inventory_layer_supplier_key(
        layer.supplier_id, purchase.supplier_id, purchase.supplier, layer.source
      ) in (
        select public.inventory_layer_supplier_key(
          used.supplier_id, used_purchase.supplier_id,
          used_purchase.supplier, used.source
        )
        from public.inventory_allocations allocation
        join public.deal_line_items other
          on other.id = allocation.deal_line_item_id
        join public.package_cost_layers used on used.id = allocation.cost_layer_id
        left join public.purchase_orders used_purchase
          on used_purchase.id = used.purchase_order_id
        where other.deal_id = v_line.deal_id
          and other.package_id = v_line.package_id
          and other.id is distinct from v_line.id
          and allocation.state in ('reserved', 'committed')
      );
    if v_allowed is not null then
      select coalesce(sum(public.inventory_layer_component_available_quantity(
        layer_id, v_line.package_id
      )), 0)::int
      into v_preferred_available
      from unnest(v_allowed) layer_id;
      v_preferred_available := greatest(
        v_preferred_available
          - public.inventory_package_manual_hold_quantity(v_line.package_id),
        0
      );
      if v_preferred_available < v_line.quantity then
        v_allowed := null;
      end if;
    end if;
  end if;

  v_request_key := 'deal-line-reassign:' || v_line.id::text
    || ':' || gen_random_uuid()::text;
  begin
    perform public.inventory_allocate_quantity_from_layers(
      v_line.package_id, v_line.quantity, 'committed',
      'deal_line_reassignment', v_request_key, v_allowed,
      v_line.deal_id, v_line.id, null, null, null,
      'Signed deal inventory reassigned',
      jsonb_build_object(
        'automatic', true,
        'preferred_existing_deal_supplier', v_allowed is not null
      )
    );
  exception
    when others then
      if sqlerrm like 'insufficient_purchased_stock%'
        or sqlerrm like 'insufficient_purchased_day_capacity%'
        or sqlerrm like 'insufficient_canonical%'
      then
        null;
      else
        raise;
      end if;
  end;

  perform public.inventory_sync_deal_line_shortage(v_line.id);
end;
$$;

comment on function public.inventory_reassign_deal_line(uuid, uuid) is
  'Release and reallocate one signed deal line. Uncovered remainder becomes a purchase shortage.';

revoke all on function public.inventory_reassign_deal_line(uuid, uuid) from public;
grant execute on function public.inventory_reassign_deal_line(uuid, uuid)
  to authenticated, service_role;

create or replace function public.sync_deal_inventory_after_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_old_holds boolean;
  v_new_holds boolean;
  v_allocated int;
begin
  v_old_holds := public.deal_stage_holds_purchased_stock(old.stage);
  v_new_holds := public.deal_stage_holds_purchased_stock(new.stage);

  if not v_old_holds and not v_new_holds then
    return new;
  end if;

  for v_line in
    select line.id, line.quantity, coalesce(line.sourcing_mode, 'owned') as sourcing_mode
    from public.deal_line_items line
    where line.deal_id = new.id
    order by line.sort_order, line.id
  loop
    if v_old_holds and v_new_holds then
      if v_line.sourcing_mode <> 'owned' then
        perform public.inventory_sync_deal_line_shortage(v_line.id);
        continue;
      end if;
      select coalesce(sum(allocation.quantity), 0)::int
      into v_allocated
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id = v_line.id
        and allocation.state in ('reserved', 'committed');
      if v_allocated >= v_line.quantity then
        perform public.inventory_sync_deal_line_shortage(v_line.id);
        continue;
      end if;
      begin
        perform public.inventory_reassign_deal_line(v_line.id, null);
      exception
        when others then
          perform public.inventory_sync_deal_line_shortage(v_line.id);
          raise notice 'Could not allocate deal line % after stage %: %',
            v_line.id, new.stage, sqlerrm;
      end;
    elsif v_new_holds then
      begin
        perform public.inventory_reassign_deal_line(v_line.id, null);
      exception
        when others then
          perform public.inventory_sync_deal_line_shortage(v_line.id);
          raise notice 'Could not allocate deal line % after stage %: %',
            v_line.id, new.stage, sqlerrm;
      end;
    else
      perform public.inventory_reassign_deal_line(v_line.id, null);
    end if;
  end loop;

  return new;
end;
$$;

create or replace function public.sync_inventory_reservation_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line_id uuid;
  v_request_key text;
begin
  if not public.inventory_allocation_enforcement_enabled() then return new; end if;
  v_request_key := 'reservation:' || new.id::text;

  if tg_op = 'INSERT' and new.status = 'active' then
    select line.id into v_line_id
    from public.deal_line_items line
    where line.reservation_id = new.id
    limit 1;

    if new.kind = 'deal_reservation' then
      begin
        perform public.inventory_allocate_quantity(
          new.package_id, new.quantity, 'reserved', 'inventory_reservations',
          v_request_key, new.deal_id, v_line_id, null, null, new.id,
          'Projected active deal reservation',
          jsonb_build_object('compatibility_projection', true)
        );
      exception
        when others then
          if sqlerrm like 'insufficient_purchased_stock%'
            or sqlerrm like 'insufficient_purchased_day_capacity%'
            or sqlerrm like 'insufficient_canonical%'
            or sqlerrm like 'insufficient_stock%'
          then
            null;
          else
            raise;
          end if;
      end;
    elsif new.kind = 'sourcing' then
      insert into public.inventory_shortages (
        package_id, deal_id, deal_line_item_id, shortage_type, quantity,
        status, source, idempotency_key, note, created_by, metadata
      ) values (
        new.package_id, new.deal_id, v_line_id, 'brokered', new.quantity,
        'open', 'inventory_reservations', 'brokered-reservation:' || new.id::text,
        'Brokered reservation intentionally does not consume owned inventory',
        auth.uid(), jsonb_build_object('reservation_id', new.id)
      ) on conflict (idempotency_key) do nothing;
    end if;
  elsif tg_op = 'UPDATE'
    and old.status = 'active'
    and new.status in ('released', 'converted', 'expired', 'cancelled')
  then
    if old.kind = 'deal_reservation' then
      perform public.inventory_release_allocations(
        v_request_key,
        'Reservation moved to ' || new.status,
        false
      );
      update public.inventory_shortages
      set status = 'cancelled',
          resolved_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
      where idempotency_key = 'reservation-shortage:' || new.id::text
        and status = 'open';
    else
      update public.inventory_shortages
      set status = case when new.status = 'converted' then 'open' else 'cancelled' end,
          resolved_at = case when new.status = 'converted' then null else timezone('utc', now()) end,
          updated_at = timezone('utc', now())
      where idempotency_key = 'brokered-reservation:' || new.id::text;
    end if;

    select line.id into v_line_id
    from public.deal_line_items line
    where line.reservation_id = old.id
       or line.reservation_id = new.id
    limit 1;
    if v_line_id is not null then
      perform public.inventory_sync_deal_line_shortage(v_line_id);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.admin_reserve_deal_stock(
  p_deal_id uuid,
  p_hold_days int default 7,
  p_reason text default 'Deal stock reserved'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.deals%rowtype;
  v_line record;
  v_inventory record;
  v_reservation_id uuid;
  v_shortage_id uuid;
  v_expires_at timestamptz;
  v_reserved int := 0;
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if coalesce(p_hold_days, 0) < 1 or p_hold_days > 90 then raise exception 'invalid_hold_days'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'deal_not_found'; end if;
  if v_deal.stage in ('closed_lost', 'cancelled', 'fulfilled') then raise exception 'deal_not_reservable'; end if;

  v_expires_at := case
    when v_deal.do_not_expire then null
    else timezone('utc', now()) + make_interval(days => p_hold_days)
  end;

  for v_line in
    select
      line.id,
      line.package_id,
      line.quantity,
      line.sourcing_mode,
      line.supplier_id,
      line.expected_unit_cost,
      line.supplier_quote_at,
      package.inventory_pool_id
    from public.deal_line_items line
    join public.packages package on package.id = line.package_id
    where line.deal_id = p_deal_id
      and not exists (
        select 1 from public.inventory_reservations reservation
        where reservation.id = line.reservation_id
          and reservation.status = 'active'
      )
    order by line.package_id, line.id
  loop
    if v_line.sourcing_mode = 'brokered' then
      if v_line.supplier_id is null or v_line.expected_unit_cost is null then
        raise exception 'brokered_quote_required:%', v_line.package_id;
      end if;
      if v_line.supplier_quote_at is null
        or v_line.supplier_quote_at < timezone('utc', now()) - interval '24 hours'
        or v_line.supplier_quote_at > timezone('utc', now()) + interval '5 minutes'
      then
        raise exception 'brokered_quote_expired:%', v_line.package_id;
      end if;

      insert into public.sourcing_shortages (
        package_id, pool_id, deal_id, deal_line_item_id, quantity,
        unit_cost_quoted, currency, supplier_id, supplier_quote_at,
        status, note, created_by
      ) values (
        v_line.package_id, v_line.inventory_pool_id, p_deal_id, v_line.id, v_line.quantity,
        v_line.expected_unit_cost, v_deal.currency, v_line.supplier_id, v_line.supplier_quote_at,
        'quoted', 'Brokered deal line with fresh supplier quote', auth.uid()
      )
      on conflict (deal_line_item_id) where deal_line_item_id is not null and status <> 'cancelled'
      do update set
        quantity = excluded.quantity,
        unit_cost_quoted = excluded.unit_cost_quoted,
        supplier_id = excluded.supplier_id,
        supplier_quote_at = excluded.supplier_quote_at,
        status = 'quoted',
        updated_at = timezone('utc', now())
      returning id into v_shortage_id;

      insert into public.inventory_reservations (
        package_id, pool_id, kind, quantity, status, deal_id, expires_at, created_by, note
      ) values (
        v_line.package_id, v_line.inventory_pool_id, 'sourcing', v_line.quantity,
        'active', p_deal_id, v_expires_at, auth.uid(), btrim(p_reason)
      ) returning id into v_reservation_id;

      update public.deal_line_items
      set reservation_id = v_reservation_id,
          reservation_status = 'active',
          sourcing_shortage_id = v_shortage_id,
          updated_at = timezone('utc', now())
      where id = v_line.id;
    else
      perform public.lock_package_inventory(v_line.package_id);
      select public.linked_inventory_sellable(v_line.package_id, null) as sellable
      into v_inventory;
      if v_inventory.sellable >= v_line.quantity then
        perform public.adjust_linked_inventory_held(v_line.package_id, v_line.quantity);
      end if;

      insert into public.inventory_reservations (
        package_id, pool_id, kind, quantity, status, deal_id, expires_at, created_by, note
      ) values (
        v_line.package_id, v_line.inventory_pool_id, 'deal_reservation', v_line.quantity,
        'active', p_deal_id, v_expires_at, auth.uid(), btrim(p_reason)
      ) returning id into v_reservation_id;

      update public.deal_line_items
      set reservation_id = v_reservation_id,
          reservation_status = 'active',
          updated_at = timezone('utc', now())
      where id = v_line.id;

      insert into public.inventory_ledger_entries (
        package_id, pool_id, entry_type, quantity_delta, reason, actor_profile_id,
        source_table, source_id, reservation_id, deal_id, metadata
      ) values (
        v_line.package_id, v_line.inventory_pool_id, 'reservation', -v_line.quantity,
        btrim(p_reason), auth.uid(), 'inventory_reservations', v_reservation_id::text,
        v_reservation_id, p_deal_id, jsonb_build_object('hold_days', p_hold_days)
      );
    end if;
    v_reserved := v_reserved + 1;
  end loop;

  if v_reserved = 0 then raise exception 'no_unreserved_lines'; end if;
  update public.deals
  set hold_expires_at = v_expires_at,
      stage = case when stage = 'draft' then 'proposal' else stage end,
      updated_at = timezone('utc', now())
  where id = p_deal_id;

  insert into public.deal_activities (
    deal_id, actor_profile_id, action, summary, metadata
  ) values (
    p_deal_id, auth.uid(), 'reservation_created', btrim(p_reason),
    jsonb_build_object('lines_reserved', v_reserved, 'expires_at', v_expires_at)
  );
  return v_reserved;
end;
$$;

create or replace function public.allocate_order_cost_layers(
  p_order_id uuid,
  p_order_package_id text,
  p_guests int,
  p_currency text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line_id uuid;
  v_deal_line_id uuid;
  v_channel text;
begin
  if coalesce(p_guests, 0) <= 0 then return; end if;
  perform set_config('inventory.trusted_commit', 'on', true);
  select line.id, line.deal_line_item_id into v_line_id, v_deal_line_id
  from public.order_line_items line
  where line.order_id = p_order_id
    and line.package_id = p_order_package_id
  order by line.sort_order, line.id
  limit 1;
  begin
    perform public.inventory_allocate_quantity(
      p_order_package_id, p_guests, 'committed', 'allocate_order_cost_layers',
      'order:' || p_order_id::text || ':package:' || p_order_package_id,
      (select deal.id from public.deals deal where deal.order_id = p_order_id limit 1),
      v_deal_line_id,
      p_order_id, v_line_id, null,
      'Order committed through day-slot allocator',
      jsonb_build_object('requested_currency', p_currency)
    );
  exception
    when others then
      if sqlerrm like 'insufficient_purchased_stock%'
        or sqlerrm like 'insufficient_purchased_day_capacity%'
        or sqlerrm like 'insufficient_canonical%'
      then
        select order_row.channel into v_channel
        from public.orders order_row
        where order_row.id = p_order_id;
        if v_channel = 'native_deal' and v_deal_line_id is not null then
          perform public.inventory_sync_deal_line_shortage(v_deal_line_id);
        else
          raise;
        end if;
      else
        raise;
      end if;
  end;
  perform set_config('inventory.trusted_commit', 'off', true);
end;
$$;

revoke all on function public.allocate_order_cost_layers(uuid, text, int, text)
  from public;
revoke all on function public.allocate_order_cost_layers(uuid, text, int, text)
  from authenticated;
grant execute on function public.allocate_order_cost_layers(uuid, text, int, text)
  to service_role;

create or replace view public.inventory_unallocated_won_by_ledger as
with allocation_totals as (
  select
    allocation.deal_line_item_id,
    sum(allocation.quantity)::int as quantity
  from public.inventory_allocations allocation
  where allocation.state in ('reserved', 'committed')
    and allocation.deal_line_item_id is not null
  group by allocation.deal_line_item_id
),
shortage_totals as (
  select
    shortage.deal_line_item_id,
    sum(shortage.quantity)::int as quantity
  from public.inventory_shortages shortage
  where shortage.status = 'open'
    and shortage.deal_line_item_id is not null
    and shortage.shortage_type = 'historical_reconciliation'
  group by shortage.deal_line_item_id
),
uncovered_lines as (
  select
    public.resolve_cost_ledger_package_id(line.package_id) as ledger_package_id,
    greatest(
      line.quantity
        - coalesce(allocation.quantity, 0)
        - coalesce(shortage.quantity, 0),
      0
    )::int as quantity
  from public.deal_line_items line
  join public.deals deal on deal.id = line.deal_id
  left join allocation_totals allocation
    on allocation.deal_line_item_id = line.id
  left join shortage_totals shortage
    on shortage.deal_line_item_id = line.id
  where public.deal_stage_holds_purchased_stock(deal.stage)
    and deal.stage not in ('closed_lost', 'cancelled')
    and coalesce(line.sourcing_mode, 'owned') = 'owned'
)
select
  ledger_package_id,
  coalesce(sum(quantity), 0)::int as quantity
from uncovered_lines
where quantity > 0
group by ledger_package_id;

grant select on public.inventory_unallocated_won_by_ledger
  to authenticated, service_role;

do $$
declare
  v_line record;
begin
  for v_line in
    select line.id
    from public.deal_line_items line
    join public.deals deal on deal.id = line.deal_id
    left join lateral (
      select coalesce(sum(allocation.quantity), 0)::int as quantity
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id = line.id
        and allocation.state in ('reserved', 'committed')
    ) allocated on true
    where public.deal_stage_holds_purchased_stock(deal.stage)
      and deal.stage not in ('closed_lost', 'cancelled')
      and (
        coalesce(line.sourcing_mode, 'owned') = 'brokered'
        or allocated.quantity < line.quantity
      )
    order by deal.created_at desc, line.sort_order, line.id
  loop
    begin
      perform public.inventory_sync_deal_line_shortage(v_line.id);
    exception
      when others then
        raise notice 'Could not record uncovered shortage for deal line %: %',
          v_line.id, sqlerrm;
    end;
  end loop;
end;
$$;
