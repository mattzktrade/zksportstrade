-- Phase 3: additive, reversible cutover evidence and pilot controls.
-- This migration never deletes legacy/Salesforce data and never calls external systems.

create table if not exists public.cutover_runs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft',
  pilot_race_id text references public.races(id) on delete set null,
  baseline_at timestamptz,
  baseline_metrics jsonb not null default '{}'::jsonb,
  notes text,
  rollback_notes text,
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint cutover_runs_name_nonempty check (btrim(name) <> ''),
  constraint cutover_runs_status_check check (
    status in (
      'draft', 'baselined', 'parallel_run', 'pilot_ready', 'pilot_running',
      'pilot_passed', 'rollback_required', 'rolled_back', 'approved', 'cancelled'
    )
  )
);

create table if not exists public.cutover_package_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.cutover_runs(id) on delete cascade,
  package_id text not null references public.packages(id) on delete cascade,
  race_id text references public.races(id) on delete set null,
  package_name text not null,
  is_legacy_shell boolean not null default false,
  baseline_qty_available int not null default 0,
  baseline_qty_held int not null default 0,
  baseline_sellable int not null default 0,
  baseline_layer_units int not null default 0,
  baseline_reservations int not null default 0,
  baseline_shortages int not null default 0,
  baseline_unassigned_cost_units int not null default 0,
  opening_balance_status text not null default 'pending',
  supplier_reconciliation_status text not null default 'pending',
  reconciliation_note text,
  reconciled_by uuid references public.profiles(id) on delete set null,
  reconciled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint cutover_package_snapshots_unique unique (run_id, package_id),
  constraint cutover_package_opening_status_check check (
    opening_balance_status in ('pending', 'verified', 'not_required', 'blocked')
  ),
  constraint cutover_package_supplier_status_check check (
    supplier_reconciliation_status in ('pending', 'reconciled', 'not_required', 'blocked')
  )
);

create table if not exists public.cutover_deal_reconciliations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.cutover_runs(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  reconciliation_type text not null,
  status text not null default 'pending',
  expected_quantity int not null default 0,
  reserved_quantity int not null default 0,
  reason text,
  reconciled_by uuid references public.profiles(id) on delete set null,
  reconciled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint cutover_deal_reconciliations_unique
    unique (run_id, deal_id, reconciliation_type),
  constraint cutover_deal_reconciliation_type_check check (
    reconciliation_type in ('open_pipeline', 'historical_won')
  ),
  constraint cutover_deal_reconciliation_status_check check (
    status in ('pending', 'prepared', 'reconciled', 'ignored', 'blocked', 'rolled_back')
  )
);

create table if not exists public.cutover_reservation_links (
  run_id uuid not null references public.cutover_runs(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  reservation_id uuid not null references public.inventory_reservations(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (run_id, reservation_id)
);

create table if not exists public.cutover_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.cutover_runs(id) on delete cascade,
  event_type text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint cutover_events_summary_nonempty check (btrim(summary) <> '')
);

create index if not exists cutover_runs_status_idx
  on public.cutover_runs(status, created_at desc);
create index if not exists cutover_package_snapshots_run_idx
  on public.cutover_package_snapshots(run_id, race_id, package_name);
create index if not exists cutover_deal_reconciliations_run_idx
  on public.cutover_deal_reconciliations(run_id, reconciliation_type, status);
create index if not exists cutover_events_run_idx
  on public.cutover_events(run_id, created_at desc);

alter table public.cutover_runs enable row level security;
alter table public.cutover_package_snapshots enable row level security;
alter table public.cutover_deal_reconciliations enable row level security;
alter table public.cutover_reservation_links enable row level security;
alter table public.cutover_events enable row level security;

create policy "cutover_runs_admin_all" on public.cutover_runs
  for all using (public.is_admin()) with check (public.is_admin());
create policy "cutover_package_snapshots_admin_all" on public.cutover_package_snapshots
  for all using (public.is_admin()) with check (public.is_admin());
create policy "cutover_deal_reconciliations_admin_all" on public.cutover_deal_reconciliations
  for all using (public.is_admin()) with check (public.is_admin());
create policy "cutover_reservation_links_admin_all" on public.cutover_reservation_links
  for all using (public.is_admin()) with check (public.is_admin());
create policy "cutover_events_admin_all" on public.cutover_events
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.admin_create_cutover_baseline(
  p_name text,
  p_pilot_race_id text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_now timestamptz := timezone('utc', now());
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'name_required'; end if;
  if p_pilot_race_id is not null
    and not exists (select 1 from public.races where id = p_pilot_race_id)
  then
    raise exception 'pilot_race_not_found';
  end if;

  insert into public.cutover_runs (
    name, status, pilot_race_id, baseline_at, notes, created_by, baseline_metrics
  ) values (
    btrim(p_name), 'baselined', p_pilot_race_id, v_now,
    nullif(btrim(p_notes), ''), auth.uid(),
    jsonb_build_object(
      'orders', (select count(*) from public.orders),
      'open_deals', (
        select count(*) from public.deals
        where order_id is null and stage not in ('fulfilled', 'closed_lost', 'cancelled')
      ),
      'pending_won_reconciliation', (
        select count(*) from public.deals where stock_reconciliation_status = 'pending'
      ),
      'awaiting_payment', (
        select count(*) from public.invoices where status = 'awaiting_payment'
      ),
      'paid_invoices', (
        select count(*) from public.invoices where status in ('paid', 'delivered')
      )
    )
  )
  returning id into v_run_id;

  insert into public.cutover_package_snapshots (
    run_id, package_id, race_id, package_name, is_legacy_shell,
    baseline_qty_available, baseline_qty_held, baseline_sellable,
    baseline_layer_units, baseline_reservations, baseline_shortages,
    baseline_unassigned_cost_units, opening_balance_status,
    supplier_reconciliation_status
  )
  select
    v_run_id,
    availability.package_id,
    availability.race_id,
    availability.name,
    availability.is_legacy_shell,
    availability.qty_available,
    availability.qty_held,
    availability.legacy_sellable,
    availability.layer_units_remaining,
    availability.active_reservations,
    availability.open_shortage_qty,
    coalesce((
      select sum(layer.quantity_remaining)::int
      from public.package_cost_layers layer
      where layer.package_id = availability.package_id
        and layer.quantity_remaining > 0
        and layer.supplier_id is null
    ), 0),
    case
      when exists (
        select 1 from public.inventory_ledger_entries ledger
        where ledger.package_id = availability.package_id
          and ledger.entry_type = 'opening_balance'
      ) then 'verified'
      else 'pending'
    end,
    case
      when availability.layer_units_remaining = 0 then 'not_required'
      when not exists (
        select 1 from public.package_cost_layers layer
        where layer.package_id = availability.package_id
          and layer.quantity_remaining > 0
          and layer.supplier_id is null
      ) then 'reconciled'
      else 'pending'
    end
  from public.native_package_availability availability
  where not availability.is_legacy_shell;

  insert into public.cutover_deal_reconciliations (
    run_id, deal_id, reconciliation_type, status,
    expected_quantity, reserved_quantity, reason
  )
  select
    v_run_id,
    deal.id,
    'open_pipeline',
    case
      when coalesce(reserved.quantity, 0) >= coalesce(lines.quantity, 0)
        and coalesce(lines.quantity, 0) > 0 then 'prepared'
      when coalesce(lines.quantity, 0) = 0 then 'blocked'
      else 'pending'
    end,
    coalesce(lines.quantity, 0),
    coalesce(reserved.quantity, 0),
    case when coalesce(lines.quantity, 0) = 0 then 'No mapped deal lines' else null end
  from public.deals deal
  left join lateral (
    select sum(quantity)::int as quantity
    from public.deal_line_items where deal_id = deal.id
  ) lines on true
  left join lateral (
    select sum(quantity)::int as quantity
    from public.inventory_reservations
    where deal_id = deal.id and status = 'active'
  ) reserved on true
  where deal.salesforce_opportunity_id is not null
    and deal.order_id is null
    and deal.stage not in ('paid_confirmed', 'in_fulfilment', 'fulfilled', 'closed_lost', 'cancelled');

  insert into public.cutover_deal_reconciliations (
    run_id, deal_id, reconciliation_type, status,
    expected_quantity, reserved_quantity, reason
  )
  select
    v_run_id,
    deal.id,
    'historical_won',
    case
      when deal.stock_reconciliation_status = 'reconciled' then 'reconciled'
      when deal.stock_reconciliation_status = 'ignored' then 'ignored'
      else 'pending'
    end,
    coalesce(lines.quantity, 0),
    0,
    'Historical won import: evidence decision only; never deduct stock automatically'
  from public.deals deal
  left join lateral (
    select sum(quantity)::int as quantity
    from public.deal_line_items where deal_id = deal.id
  ) lines on true
  where deal.salesforce_opportunity_id is not null
    and deal.stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
  on conflict (run_id, deal_id, reconciliation_type) do nothing;

  insert into public.cutover_events (
    run_id, event_type, actor_profile_id, summary, metadata
  ) values (
    v_run_id, 'baseline_created', auth.uid(),
    'Captured native/legacy cutover baseline',
    jsonb_build_object('pilot_race_id', p_pilot_race_id, 'captured_at', v_now)
  );
  return v_run_id;
end;
$$;

revoke all on function public.admin_create_cutover_baseline(text, text, text) from public;
grant execute on function public.admin_create_cutover_baseline(text, text, text) to authenticated;

create or replace function public.admin_prepare_cutover_open_deal(
  p_run_id uuid,
  p_deal_id uuid,
  p_hold_days int default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.cutover_runs%rowtype;
  v_deal public.deals%rowtype;
  v_before uuid[];
  v_lines int;
  v_reserved int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into v_run from public.cutover_runs where id = p_run_id for update;
  if not found then raise exception 'cutover_run_not_found'; end if;
  if v_run.status in ('approved', 'cancelled', 'rolled_back') then
    raise exception 'cutover_run_locked';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'deal_not_found'; end if;
  if v_deal.salesforce_opportunity_id is null then
    raise exception 'imported_salesforce_deal_required';
  end if;
  if v_deal.order_id is not null
    or v_deal.stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled', 'closed_lost', 'cancelled')
  then
    raise exception 'open_deal_required';
  end if;
  if not exists (
    select 1 from public.cutover_deal_reconciliations
    where run_id = p_run_id and deal_id = p_deal_id
      and reconciliation_type = 'open_pipeline'
  ) then
    raise exception 'deal_not_in_cutover_baseline';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[]) into v_before
  from public.inventory_reservations
  where deal_id = p_deal_id;

  if exists (
    select 1
    from public.deal_line_items line
    where line.deal_id = p_deal_id
      and not exists (
        select 1 from public.inventory_reservations reservation
        where reservation.deal_id = p_deal_id
          and reservation.package_id = line.package_id
          and reservation.status = 'active'
      )
  ) then
    perform public.admin_reserve_deal_stock(
      p_deal_id,
      least(90, greatest(1, coalesce(p_hold_days, 30))),
      'Phase 3 cutover preparation ' || p_run_id::text
    );
  end if;

  insert into public.cutover_reservation_links (run_id, deal_id, reservation_id)
  select p_run_id, p_deal_id, reservation.id
  from public.inventory_reservations reservation
  where reservation.deal_id = p_deal_id
    and reservation.status = 'active'
    and not (reservation.id = any(v_before))
  on conflict do nothing;

  select coalesce(sum(quantity), 0)::int into v_lines
  from public.deal_line_items where deal_id = p_deal_id;
  select coalesce(sum(quantity), 0)::int into v_reserved
  from public.inventory_reservations
  where deal_id = p_deal_id and status = 'active';

  update public.cutover_deal_reconciliations
  set status = case when v_lines > 0 and v_reserved >= v_lines then 'prepared' else 'blocked' end,
      expected_quantity = v_lines,
      reserved_quantity = v_reserved,
      reason = case
        when v_lines = 0 then 'No mapped deal lines'
        when v_reserved < v_lines then 'Reservation quantity does not cover mapped lines'
        else 'Open imported deal reserved for native parallel run'
      end,
      reconciled_by = auth.uid(),
      reconciled_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where run_id = p_run_id and deal_id = p_deal_id
    and reconciliation_type = 'open_pipeline';

  insert into public.cutover_events (
    run_id, event_type, actor_profile_id, summary, metadata
  ) values (
    p_run_id, 'open_deal_prepared', auth.uid(),
    'Prepared imported open deal reservation',
    jsonb_build_object(
      'deal_id', p_deal_id, 'expected_quantity', v_lines, 'reserved_quantity', v_reserved
    )
  );
  return jsonb_build_object(
    'deal_id', p_deal_id, 'expected_quantity', v_lines,
    'reserved_quantity', v_reserved, 'prepared', v_lines > 0 and v_reserved >= v_lines
  );
end;
$$;

revoke all on function public.admin_prepare_cutover_open_deal(uuid, uuid, int) from public;
grant execute on function public.admin_prepare_cutover_open_deal(uuid, uuid, int) to authenticated;

create or replace function public.admin_decide_cutover_reconciliation(
  p_run_id uuid,
  p_deal_id uuid,
  p_status text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if not exists (
    select 1 from public.cutover_runs
    where id = p_run_id and status not in ('approved', 'cancelled', 'rolled_back')
    for update
  ) then
    raise exception 'cutover_run_locked';
  end if;
  if p_status not in ('reconciled', 'ignored', 'blocked') then
    raise exception 'invalid_reconciliation_status';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;
  update public.cutover_deal_reconciliations
  set status = p_status,
      reason = btrim(p_reason),
      reconciled_by = auth.uid(),
      reconciled_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where run_id = p_run_id and deal_id = p_deal_id
    and reconciliation_type = 'historical_won';
  if not found then raise exception 'reconciliation_not_found'; end if;
  update public.deals
  set stock_reconciliation_status = case when p_status = 'blocked' then 'pending' else p_status end,
      updated_at = timezone('utc', now())
  where id = p_deal_id;
  insert into public.cutover_events (
    run_id, event_type, actor_profile_id, summary, metadata
  ) values (
    p_run_id, 'won_reconciliation_decided', auth.uid(),
    'Recorded historical won stock reconciliation decision',
    jsonb_build_object('deal_id', p_deal_id, 'status', p_status, 'reason', btrim(p_reason))
  );
end;
$$;

revoke all on function public.admin_decide_cutover_reconciliation(uuid, uuid, text, text) from public;
grant execute on function public.admin_decide_cutover_reconciliation(uuid, uuid, text, text) to authenticated;

create or replace function public.admin_update_cutover_package(
  p_run_id uuid,
  p_package_id text,
  p_opening_balance_status text,
  p_supplier_status text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if not exists (
    select 1 from public.cutover_runs
    where id = p_run_id and status not in ('approved', 'cancelled', 'rolled_back')
    for update
  ) then
    raise exception 'cutover_run_locked';
  end if;
  if p_opening_balance_status not in ('pending', 'verified', 'not_required', 'blocked') then
    raise exception 'invalid_opening_balance_status';
  end if;
  if p_supplier_status not in ('pending', 'reconciled', 'not_required', 'blocked') then
    raise exception 'invalid_supplier_status';
  end if;
  update public.cutover_package_snapshots
  set opening_balance_status = p_opening_balance_status,
      supplier_reconciliation_status = p_supplier_status,
      reconciliation_note = nullif(btrim(p_note), ''),
      reconciled_by = auth.uid(),
      reconciled_at = timezone('utc', now())
  where run_id = p_run_id and package_id = p_package_id;
  if not found then raise exception 'package_snapshot_not_found'; end if;
  insert into public.cutover_events (
    run_id, event_type, actor_profile_id, summary, metadata
  ) values (
    p_run_id, 'package_reconciliation_updated', auth.uid(),
    'Updated package cutover reconciliation',
    jsonb_build_object(
      'package_id', p_package_id,
      'opening_balance_status', p_opening_balance_status,
      'supplier_status', p_supplier_status
    )
  );
end;
$$;

revoke all on function public.admin_update_cutover_package(uuid, text, text, text, text) from public;
grant execute on function public.admin_update_cutover_package(uuid, text, text, text, text) to authenticated;

create or replace function public.admin_set_cutover_pilot_race(
  p_run_id uuid,
  p_race_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select status into v_status from public.cutover_runs where id = p_run_id for update;
  if not found then raise exception 'cutover_run_not_found'; end if;
  if v_status not in ('baselined', 'parallel_run') then
    raise exception 'pilot_race_locked';
  end if;
  if not exists (select 1 from public.races where id = p_race_id) then
    raise exception 'pilot_race_not_found';
  end if;
  update public.cutover_runs
  set pilot_race_id = p_race_id, updated_at = timezone('utc', now())
  where id = p_run_id;
  insert into public.cutover_events (
    run_id, event_type, actor_profile_id, summary, metadata
  ) values (
    p_run_id, 'pilot_race_selected', auth.uid(), 'Selected pilot event',
    jsonb_build_object('race_id', p_race_id)
  );
end;
$$;

revoke all on function public.admin_set_cutover_pilot_race(uuid, text) from public;
grant execute on function public.admin_set_cutover_pilot_race(uuid, text) to authenticated;

create or replace function public.admin_set_cutover_status(
  p_run_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.cutover_runs%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into v_run from public.cutover_runs where id = p_run_id for update;
  if not found then raise exception 'cutover_run_not_found'; end if;
  if p_status not in (
    'baselined', 'parallel_run', 'pilot_ready', 'pilot_running',
    'pilot_passed', 'rollback_required', 'approved', 'cancelled'
  ) then
    raise exception 'invalid_cutover_status';
  end if;
  if p_status <> v_run.status and not (
    (v_run.status = 'baselined' and p_status in ('parallel_run', 'rollback_required', 'cancelled'))
    or (v_run.status = 'parallel_run' and p_status in ('pilot_ready', 'rollback_required', 'cancelled'))
    or (v_run.status = 'pilot_ready' and p_status in ('parallel_run', 'pilot_running', 'rollback_required'))
    or (v_run.status = 'pilot_running' and p_status in ('pilot_passed', 'rollback_required'))
    or (v_run.status = 'pilot_passed' and p_status in ('approved', 'rollback_required'))
  ) then
    raise exception 'invalid_cutover_transition:%:%', v_run.status, p_status;
  end if;
  if p_status in ('pilot_ready', 'pilot_running', 'pilot_passed')
    and v_run.pilot_race_id is null
  then
    raise exception 'pilot_race_required';
  end if;
  if p_status in ('pilot_ready', 'pilot_running', 'pilot_passed', 'approved')
    and exists (
      select 1 from public.cutover_deal_reconciliations reconciliation
      join public.deals deal on deal.id = reconciliation.deal_id
      left join public.deal_line_items line on line.deal_id = deal.id
      left join public.packages package on package.id = line.package_id
      where reconciliation.run_id = p_run_id
        and reconciliation.status in ('pending', 'blocked')
        and (
          p_status = 'approved'
          or v_run.pilot_race_id is null
          or package.race_id = v_run.pilot_race_id
          or package.id is null
        )
    )
  then
    raise exception 'unresolved_deal_reconciliations';
  end if;
  if p_status in ('pilot_ready', 'pilot_running', 'pilot_passed', 'approved')
    and exists (
      select 1
      from public.cutover_package_snapshots package
      where package.run_id = p_run_id
        and (
          package.opening_balance_status in ('pending', 'blocked')
          or package.supplier_reconciliation_status in ('pending', 'blocked')
        )
        and (
          p_status = 'approved'
          or v_run.pilot_race_id is null
          or package.race_id = v_run.pilot_race_id
        )
    )
  then
    raise exception 'unresolved_package_reconciliations';
  end if;
  update public.cutover_runs
  set status = p_status,
      notes = coalesce(nullif(btrim(p_note), ''), notes),
      approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
      approved_at = case when p_status = 'approved' then timezone('utc', now()) else approved_at end,
      updated_at = timezone('utc', now())
  where id = p_run_id;
  insert into public.cutover_events (
    run_id, event_type, actor_profile_id, summary, metadata
  ) values (
    p_run_id, 'status_changed', auth.uid(), 'Changed cutover run status',
    jsonb_build_object('from', v_run.status, 'to', p_status, 'note', nullif(btrim(p_note), ''))
  );
end;
$$;

revoke all on function public.admin_set_cutover_status(uuid, text, text) from public;
grant execute on function public.admin_set_cutover_status(uuid, text, text) to authenticated;

create or replace function public.admin_rollback_cutover_run(
  p_run_id uuid,
  p_reason text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link record;
  v_released int := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;
  if not exists (select 1 from public.cutover_runs where id = p_run_id for update) then
    raise exception 'cutover_run_not_found';
  end if;

  for v_link in
    select link.deal_id, reservation.*
    from public.cutover_reservation_links link
    join public.inventory_reservations reservation on reservation.id = link.reservation_id
    where link.run_id = p_run_id and reservation.status = 'active'
    order by reservation.created_at desc
    for update of reservation
  loop
    perform public.lock_package_inventory(v_link.package_id);
    update public.package_inventory
    set qty_held = greatest(0, coalesce(qty_held, 0) - v_link.quantity)
    where package_id = v_link.package_id;
    update public.inventory_reservations
    set status = 'cancelled',
        released_at = timezone('utc', now()),
        expires_at = null,
        note = concat_ws(E'\n', note, 'Rolled back cutover run ' || p_run_id::text),
        updated_at = timezone('utc', now())
    where id = v_link.id;
    update public.deal_line_items
    set reservation_status = 'cancelled',
        updated_at = timezone('utc', now())
    where reservation_id = v_link.id;
    insert into public.inventory_ledger_entries (
      package_id, pool_id, entry_type, quantity_delta, reason,
      actor_profile_id, source_table, source_id, reservation_id, deal_id, metadata
    ) values (
      v_link.package_id, v_link.pool_id, 'reservation_release', v_link.quantity,
      btrim(p_reason), auth.uid(), 'inventory_reservations', v_link.id::text,
      v_link.id, v_link.deal_id, jsonb_build_object('cutover_run_id', p_run_id)
    )
    on conflict (source_table, source_id, entry_type) do nothing;
    v_released := v_released + 1;
  end loop;

  update public.cutover_deal_reconciliations
  set status = 'rolled_back',
      reason = btrim(p_reason),
      reconciled_by = auth.uid(),
      reconciled_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where run_id = p_run_id
    and reconciliation_type = 'open_pipeline'
    and status = 'prepared';
  update public.deals deal
  set hold_expires_at = null,
      do_not_expire = false,
      updated_at = timezone('utc', now())
  where deal.id in (
    select distinct link.deal_id
    from public.cutover_reservation_links link
    where link.run_id = p_run_id
  )
    and not exists (
      select 1 from public.inventory_reservations reservation
      where reservation.deal_id = deal.id and reservation.status = 'active'
    );
  update public.cutover_runs
  set status = 'rolled_back',
      rollback_notes = btrim(p_reason),
      updated_at = timezone('utc', now())
  where id = p_run_id;
  insert into public.cutover_events (
    run_id, event_type, actor_profile_id, summary, metadata
  ) values (
    p_run_id, 'run_rolled_back', auth.uid(),
    'Released reservations created by cutover preparation',
    jsonb_build_object(
      'reservations_released', v_released,
      'opening_balances_automatically_reversed', false
    )
  );
  return v_released;
end;
$$;

revoke all on function public.admin_rollback_cutover_run(uuid, text) from public;
grant execute on function public.admin_rollback_cutover_run(uuid, text) to authenticated;

