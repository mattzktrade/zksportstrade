-- Complete Phase 2A deal workflow: validated transitions, atomic reservation
-- creation/release, hold overrides and cron-safe expiry.

create or replace function public.admin_release_deal_reservations(
  p_deal_id uuid,
  p_release_status text default 'released',
  p_reason text default 'Deal reservation released'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res record;
  v_released int := 0;
begin
  if auth.role() <> 'service_role'
    and not public.has_cms_permission('deals.manage')
    and not public.is_admin()
  then
    raise exception 'forbidden';
  end if;
  if p_release_status not in ('released', 'expired', 'cancelled') then
    raise exception 'invalid_release_status';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;

  if not exists (select 1 from public.deals where id = p_deal_id) then
    raise exception 'deal_not_found';
  end if;

  for v_res in
    select r.id, r.package_id, r.pool_id, r.quantity
    from public.inventory_reservations r
    where r.deal_id = p_deal_id
      and r.status = 'active'
    order by r.created_at, r.id
    for update
  loop
    perform 1
    from public.package_inventory
    where package_id = v_res.package_id
    for update;

    update public.package_inventory
    set qty_held = greatest(0, coalesce(qty_held, 0) - v_res.quantity)
    where package_id = v_res.package_id;

    update public.inventory_reservations
    set status = p_release_status,
        released_at = timezone('utc', now()),
        updated_at = timezone('utc', now()),
        note = concat_ws(E'\n', note, btrim(p_reason))
    where id = v_res.id;

    update public.deal_line_items
    set reservation_status = p_release_status,
        updated_at = timezone('utc', now())
    where reservation_id = v_res.id
      and reservation_status = 'active';

    insert into public.inventory_ledger_entries (
      package_id,
      pool_id,
      entry_type,
      quantity_delta,
      reason,
      actor_profile_id,
      source_table,
      source_id,
      reservation_id,
      deal_id,
      metadata
    ) values (
      v_res.package_id,
      v_res.pool_id,
      'reservation_release',
      v_res.quantity,
      btrim(p_reason),
      auth.uid(),
      'inventory_reservations',
      v_res.id::text,
      v_res.id,
      p_deal_id,
      jsonb_build_object('release_status', p_release_status)
    )
    on conflict (source_table, source_id, entry_type)
      where source_table is not null and source_id is not null
    do nothing;

    v_released := v_released + 1;
  end loop;

  if v_released > 0 then
    update public.deals
    set hold_expires_at = null,
        do_not_expire = false,
        updated_at = timezone('utc', now())
    where id = p_deal_id;

    insert into public.deal_activities (
      deal_id, actor_profile_id, action, summary, metadata
    ) values (
      p_deal_id,
      auth.uid(),
      'reservation_' || p_release_status,
      btrim(p_reason),
      jsonb_build_object('reservations_released', v_released)
    );
  end if;

  return v_released;
end;
$$;

revoke all on function public.admin_release_deal_reservations(uuid, text, text) from public;
grant execute on function public.admin_release_deal_reservations(uuid, text, text) to authenticated, service_role;

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
  v_expires_at timestamptz;
  v_reserved int := 0;
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if coalesce(p_hold_days, 0) < 1 or p_hold_days > 90 then
    raise exception 'invalid_hold_days';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;

  select * into v_deal
  from public.deals
  where id = p_deal_id
  for update;
  if not found then raise exception 'deal_not_found'; end if;
  if v_deal.stage in ('closed_lost', 'cancelled', 'fulfilled') then
    raise exception 'deal_not_reservable';
  end if;

  v_expires_at := case
    when v_deal.do_not_expire then null
    else timezone('utc', now()) + make_interval(days => p_hold_days)
  end;

  for v_line in
    select li.id, li.package_id, li.quantity, p.inventory_pool_id
    from public.deal_line_items li
    join public.packages p on p.id = li.package_id
    where li.deal_id = p_deal_id
      and not exists (
        select 1
        from public.inventory_reservations r
        where r.deal_id = p_deal_id
          and r.package_id = li.package_id
          and r.status = 'active'
      )
    order by li.sort_order, li.id
  loop
    select coalesce(qty_available, 0) as qty_available,
           coalesce(qty_held, 0) as qty_held
    into v_inventory
    from public.package_inventory
    where package_id = v_line.package_id
    for update;
    if not found then raise exception 'inventory_missing:%', v_line.package_id; end if;
    if (v_inventory.qty_available - v_inventory.qty_held) < v_line.quantity then
      raise exception 'insufficient_stock:%', v_line.package_id;
    end if;

    update public.package_inventory
    set qty_held = v_inventory.qty_held + v_line.quantity
    where package_id = v_line.package_id;

    insert into public.inventory_reservations (
      package_id, pool_id, kind, quantity, status, deal_id, expires_at,
      created_by, note
    ) values (
      v_line.package_id,
      v_line.inventory_pool_id,
      'deal_reservation',
      v_line.quantity,
      'active',
      p_deal_id,
      v_expires_at,
      auth.uid(),
      btrim(p_reason)
    )
    returning id into v_reservation_id;

    update public.deal_line_items
    set reservation_id = v_reservation_id,
        reservation_status = 'active',
        updated_at = timezone('utc', now())
    where id = v_line.id;

    insert into public.inventory_ledger_entries (
      package_id, pool_id, entry_type, quantity_delta, reason, actor_profile_id,
      source_table, source_id, reservation_id, deal_id, metadata
    ) values (
      v_line.package_id,
      v_line.inventory_pool_id,
      'reservation',
      -v_line.quantity,
      btrim(p_reason),
      auth.uid(),
      'inventory_reservations',
      v_reservation_id::text,
      v_reservation_id,
      p_deal_id,
      jsonb_build_object('hold_days', p_hold_days)
    );
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
    p_deal_id,
    auth.uid(),
    'reservation_created',
    btrim(p_reason),
    jsonb_build_object(
      'lines_reserved', v_reserved,
      'expires_at', v_expires_at,
      'do_not_expire', v_deal.do_not_expire
    )
  );

  return v_reserved;
end;
$$;

revoke all on function public.admin_reserve_deal_stock(uuid, int, text) from public;
grant execute on function public.admin_reserve_deal_stock(uuid, int, text) to authenticated;

create or replace function public.admin_set_deal_hold_policy(
  p_deal_id uuid,
  p_do_not_expire boolean,
  p_hold_until timestamptz default null,
  p_reason text default 'Deal hold policy updated'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
  v_active int;
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;
  if not exists (select 1 from public.deals where id = p_deal_id for update) then
    raise exception 'deal_not_found';
  end if;

  select count(*)::int into v_active
  from public.inventory_reservations
  where deal_id = p_deal_id and status = 'active';
  if v_active = 0 then raise exception 'no_active_reservation'; end if;

  if coalesce(p_do_not_expire, false) then
    v_until := null;
  else
    v_until := coalesce(p_hold_until, timezone('utc', now()) + interval '7 days');
    if v_until <= timezone('utc', now()) then raise exception 'hold_until_must_be_future'; end if;
  end if;

  update public.inventory_reservations
  set expires_at = v_until,
      updated_at = timezone('utc', now()),
      note = concat_ws(E'\n', note, btrim(p_reason))
  where deal_id = p_deal_id and status = 'active';

  update public.deals
  set do_not_expire = coalesce(p_do_not_expire, false),
      hold_expires_at = v_until,
      updated_at = timezone('utc', now())
  where id = p_deal_id;

  insert into public.deal_activities (
    deal_id, actor_profile_id, action, summary, metadata
  ) values (
    p_deal_id,
    auth.uid(),
    'hold_policy_updated',
    btrim(p_reason),
    jsonb_build_object(
      'do_not_expire', coalesce(p_do_not_expire, false),
      'hold_until', v_until
    )
  );
end;
$$;

revoke all on function public.admin_set_deal_hold_policy(uuid, boolean, timestamptz, text) from public;
grant execute on function public.admin_set_deal_hold_policy(uuid, boolean, timestamptz, text) to authenticated;

create or replace function public.admin_update_deal_workflow(
  p_deal_id uuid,
  p_stage text,
  p_owner_profile_id uuid default null,
  p_next_action text default null,
  p_next_action_due_at timestamptz default null,
  p_expected_close_date date default null,
  p_loss_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.deals%rowtype;
  v_transition_allowed boolean := false;
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_deal
  from public.deals
  where id = p_deal_id
  for update;
  if not found then raise exception 'deal_not_found'; end if;
  if p_owner_profile_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_owner_profile_id and p.role in ('admin', 'sales')
  ) then
    raise exception 'owner_not_found';
  end if;
  if p_stage = 'closed_lost' and nullif(btrim(p_loss_reason), '') is null then
    raise exception 'loss_reason_required';
  end if;

  v_transition_allowed :=
    p_stage = v_deal.stage
    or (p_stage in ('closed_lost', 'cancelled') and v_deal.stage not in ('fulfilled', 'closed_lost', 'cancelled'))
    or (v_deal.stage in ('closed_lost', 'cancelled') and p_stage = 'draft')
    or (v_deal.stage = 'draft' and p_stage in ('sourcing', 'proposal'))
    or (v_deal.stage = 'sourcing' and p_stage in ('draft', 'proposal'))
    or (v_deal.stage = 'proposal' and p_stage = 'booking_form_sent')
    or (v_deal.stage = 'booking_form_sent' and p_stage = 'awaiting_client_signature')
    or (v_deal.stage = 'awaiting_client_signature' and p_stage = 'awaiting_zk_signature')
    or (v_deal.stage = 'awaiting_zk_signature' and p_stage = 'signed')
    or (v_deal.stage = 'signed' and p_stage = 'awaiting_invoice')
    or (v_deal.stage = 'awaiting_invoice' and p_stage = 'awaiting_payment')
    or (v_deal.stage = 'awaiting_payment' and p_stage = 'paid_confirmed')
    or (v_deal.stage = 'paid_confirmed' and p_stage = 'in_fulfilment')
    or (v_deal.stage = 'in_fulfilment' and p_stage = 'fulfilled');

  if not v_transition_allowed then
    raise exception 'invalid_stage_transition:%->%', v_deal.stage, p_stage;
  end if;

  if p_stage in ('closed_lost', 'cancelled') and p_stage <> v_deal.stage then
    perform public.admin_release_deal_reservations(
      p_deal_id,
      'cancelled',
      case when p_stage = 'closed_lost'
        then 'Reservation released because deal was lost'
        else 'Reservation released because deal was cancelled'
      end
    );
  end if;

  update public.deals
  set stage = p_stage,
      owner_profile_id = p_owner_profile_id,
      next_action = nullif(btrim(p_next_action), ''),
      next_action_due_at = p_next_action_due_at,
      expected_close_date = p_expected_close_date,
      loss_reason = case
        when p_stage = 'closed_lost' then nullif(btrim(p_loss_reason), '')
        when p_stage not in ('closed_lost', 'cancelled') then null
        else loss_reason end,
      closed_at = case
        when p_stage in ('paid_confirmed', 'fulfilled', 'closed_lost', 'cancelled')
          then coalesce(closed_at, timezone('utc', now()))
        when p_stage = 'draft' then null
        else closed_at end,
      updated_at = timezone('utc', now())
  where id = p_deal_id;

  insert into public.deal_activities (
    deal_id, actor_profile_id, action, summary, metadata
  ) values (
    p_deal_id,
    auth.uid(),
    case when p_stage = v_deal.stage then 'workflow_updated' else 'stage_changed' end,
    case when p_stage = v_deal.stage
      then 'Deal workflow details updated'
      else 'Deal stage changed from ' || v_deal.stage || ' to ' || p_stage
    end,
    jsonb_build_object(
      'previous_stage', v_deal.stage,
      'stage', p_stage,
      'owner_profile_id', p_owner_profile_id,
      'next_action', nullif(btrim(p_next_action), ''),
      'next_action_due_at', p_next_action_due_at,
      'expected_close_date', p_expected_close_date,
      'loss_reason', nullif(btrim(p_loss_reason), '')
    )
  );
end;
$$;

revoke all on function public.admin_update_deal_workflow(
  uuid, text, uuid, text, timestamptz, date, text
) from public;
grant execute on function public.admin_update_deal_workflow(
  uuid, text, uuid, text, timestamptz, date, text
) to authenticated;

create or replace function public.admin_expire_due_deal_reservations()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal record;
  v_expired int := 0;
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  for v_deal in
    select d.id, d.stage
    from public.deals d
    where d.do_not_expire = false
      and exists (
        select 1
        from public.inventory_reservations r
        where r.deal_id = d.id
          and r.status = 'active'
          and r.expires_at is not null
          and r.expires_at <= timezone('utc', now())
      )
    order by d.id
    for update of d
  loop
    perform public.admin_release_deal_reservations(
      v_deal.id,
      'expired',
      'Deal reservation expired automatically'
    );

    update public.deals
    set stage = case
          when stage in (
            'booking_form_sent',
            'awaiting_client_signature',
            'awaiting_zk_signature'
          ) then 'proposal'
          else stage
        end,
        next_action = 'Review expired hold and follow up with client',
        next_action_due_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_deal.id;

    insert into public.deal_activities (
      deal_id, actor_profile_id, action, summary, metadata
    ) values (
      v_deal.id,
      auth.uid(),
      'hold_expired',
      'Seven-day deal hold expired and stock was released',
      jsonb_build_object('previous_stage', v_deal.stage)
    );
    v_expired := v_expired + 1;
  end loop;
  return v_expired;
end;
$$;

revoke all on function public.admin_expire_due_deal_reservations() from public;
grant execute on function public.admin_expire_due_deal_reservations() to authenticated, service_role;

comment on function public.admin_update_deal_workflow(
  uuid, text, uuid, text, timestamptz, date, text
) is 'Validated native deal state transition with owner/action audit.';

