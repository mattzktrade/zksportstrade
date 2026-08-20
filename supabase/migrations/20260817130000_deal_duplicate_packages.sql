-- Allow the same product on a deal more than once (split prices / quantities).

alter table public.order_line_items
  drop constraint if exists order_line_items_order_package_unique;

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
      if v_inventory.sellable < v_line.quantity then
        raise exception 'insufficient_stock:%', v_line.package_id;
      end if;
      perform public.adjust_linked_inventory_held(v_line.package_id, v_line.quantity);

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

create or replace function public.admin_create_deal_with_lines(
  p_account_id uuid,
  p_contact_id uuid,
  p_source text,
  p_notes text,
  p_lines jsonb,
  p_reserve boolean default false,
  p_hold_days int default 7
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal_id uuid;
  v_ref text;
  v_line jsonb;
  v_package record;
  v_line_id uuid;
  v_package_id text;
  v_quantity int;
  v_unit_price numeric;
  v_expected_cost numeric;
  v_supplier_id uuid;
  v_quote_at timestamptz;
  v_sourcing_mode text;
  v_total numeric := 0;
  v_currency text;
  v_sort int := 0;
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.crm_accounts where id = p_account_id and active) then raise exception 'account_not_found'; end if;
  if p_contact_id is not null and not exists (
    select 1 from public.crm_contacts where id = p_contact_id and account_id = p_account_id and active
  ) then raise exception 'contact_not_found_for_account'; end if;
  if p_source not in ('offline', 'portal', 'website', 'referral', 'other') then raise exception 'invalid_deal_source'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'deal_line_required'; end if;

  v_ref := 'D-' || to_char(timezone('utc', now()), 'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  insert into public.deals (
    reference, account_id, primary_contact_id, owner_profile_id, source, stage,
    currency, total_amount, notes, created_by
  ) values (
    v_ref, p_account_id, p_contact_id, auth.uid(), p_source,
    case when p_reserve then 'proposal' else 'draft' end,
    'USD', 0, nullif(btrim(p_notes), ''), auth.uid()
  ) returning id into v_deal_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_package_id := nullif(btrim(v_line->>'packageId'), '');
    v_quantity := nullif(v_line->>'quantity', '')::int;
    v_unit_price := nullif(v_line->>'unitPrice', '')::numeric;
    v_expected_cost := nullif(v_line->>'expectedUnitCost', '')::numeric;
    v_supplier_id := nullif(v_line->>'supplierId', '')::uuid;
    v_quote_at := nullif(v_line->>'supplierQuoteAt', '')::timestamptz;
    v_sourcing_mode := coalesce(nullif(v_line->>'sourcingMode', ''), 'owned');
    if v_package_id is null or v_quantity is null or v_quantity <= 0
      or v_unit_price is null or v_unit_price < 0
      or v_sourcing_mode not in ('owned', 'brokered')
      or (v_expected_cost is not null and v_expected_cost < 0)
    then raise exception 'invalid_deal_line'; end if;

    select id, race_id, currency, inventory_pool_id into v_package
    from public.packages
    where id = v_package_id and shell_parent_package_id is null and is_hidden = false;
    if not found then raise exception 'package_not_found:%', v_package_id; end if;
    if v_currency is null then v_currency := coalesce(v_package.currency, 'USD'); end if;
    if coalesce(v_package.currency, 'USD') <> v_currency then raise exception 'mixed_currency_deal'; end if;
    if v_sourcing_mode = 'brokered' and v_supplier_id is not null
      and not exists (select 1 from public.suppliers where id = v_supplier_id and active)
    then raise exception 'supplier_not_found'; end if;

    insert into public.deal_line_items (
      deal_id, package_id, quantity, unit_sale_price, currency, supplier_id,
      expected_unit_cost, reservation_status, sort_order, sourcing_mode, supplier_quote_at
    ) values (
      v_deal_id, v_package_id, v_quantity, v_unit_price, v_currency, v_supplier_id,
      v_expected_cost, 'none', v_sort, v_sourcing_mode, v_quote_at
    ) returning id into v_line_id;
    v_total := v_total + v_quantity * v_unit_price;
    v_sort := v_sort + 1;
  end loop;

  update public.deals
  set currency = v_currency, total_amount = v_total, updated_at = timezone('utc', now())
  where id = v_deal_id;
  if p_reserve then
    perform public.admin_reserve_deal_stock(v_deal_id, p_hold_days, 'Reserved with multi-line deal creation');
  end if;
  insert into public.deal_activities (deal_id, actor_profile_id, action, summary, metadata)
  values (
    v_deal_id, auth.uid(), 'deal_created', 'Created multi-product deal basket',
    jsonb_build_object('reference', v_ref, 'line_count', jsonb_array_length(p_lines), 'reserved', p_reserve)
  );
  return v_deal_id;
end;
$$;

revoke all on function public.admin_create_deal_with_lines(uuid, uuid, text, text, jsonb, boolean, int) from public;
grant execute on function public.admin_create_deal_with_lines(uuid, uuid, text, text, jsonb, boolean, int) to authenticated;

create or replace function public.admin_update_deal_commercials(
  p_deal_id uuid,
  p_account_id uuid,
  p_contact_id uuid,
  p_source text,
  p_notes text,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.deals%rowtype;
  v_existing public.deal_line_items%rowtype;
  v_line jsonb;
  v_line_id uuid;
  v_package_id text;
  v_quantity int;
  v_unit_price numeric;
  v_expected_cost numeric;
  v_supplier_id uuid;
  v_quote_at timestamptz;
  v_sourcing_mode text;
  v_total numeric := 0;
  v_keep_ids uuid[] := '{}'::uuid[];
  v_sort int := 0;
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then raise exception 'forbidden'; end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'deal_not_found'; end if;
  if v_deal.order_id is not null then raise exception 'deal_with_order_is_locked'; end if;
  if exists (
    select 1 from public.booking_forms form
    where form.deal_id = p_deal_id
      and form.status in ('sent', 'viewed', 'awaiting_zk_signature', 'zk_signed', 'completed')
  ) then raise exception 'booking_form_snapshot_locks_deal_lines'; end if;
  if exists (
    select 1 from public.inventory_reservations
    where deal_id = p_deal_id and status = 'active'
  ) then raise exception 'active_reservations_must_be_released'; end if;
  if not exists (select 1 from public.crm_accounts where id = p_account_id and active) then raise exception 'account_not_found'; end if;
  if p_contact_id is not null and not exists (
    select 1 from public.crm_contacts where id = p_contact_id and account_id = p_account_id and active
  ) then raise exception 'contact_must_belong_to_account'; end if;
  if p_source not in ('offline', 'portal', 'website', 'referral', 'other') then raise exception 'invalid_deal_source'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'deal_line_required'; end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_line_id := nullif(v_line->>'id', '')::uuid;
    v_existing := null;
    if v_line_id is not null then
      select * into v_existing
      from public.deal_line_items
      where id = v_line_id and deal_id = p_deal_id;
      if not found then raise exception 'deal_line_not_found'; end if;
    end if;
    v_package_id := nullif(btrim(v_line->>'packageId'), '');
    v_quantity := nullif(v_line->>'quantity', '')::int;
    v_unit_price := nullif(v_line->>'unitPrice', '')::numeric;
    v_expected_cost := case
      when v_line ? 'expectedUnitCost' then nullif(v_line->>'expectedUnitCost', '')::numeric
      else v_existing.expected_unit_cost
    end;
    v_supplier_id := case
      when v_line ? 'supplierId' then nullif(v_line->>'supplierId', '')::uuid
      else v_existing.supplier_id
    end;
    v_quote_at := case
      when v_line ? 'supplierQuoteAt' then nullif(v_line->>'supplierQuoteAt', '')::timestamptz
      else v_existing.supplier_quote_at
    end;
    v_sourcing_mode := coalesce(
      nullif(v_line->>'sourcingMode', ''),
      v_existing.sourcing_mode,
      'owned'
    );
    if v_package_id is null or v_quantity is null or v_quantity <= 0
      or v_unit_price is null or v_unit_price < 0
      or v_sourcing_mode not in ('owned', 'brokered')
      or (v_expected_cost is not null and v_expected_cost < 0)
    then raise exception 'invalid_deal_line'; end if;
    if not exists (
      select 1 from public.packages
      where id = v_package_id and shell_parent_package_id is null
    ) then raise exception 'package_not_found:%', v_package_id; end if;

    if v_line_id is null then
      insert into public.deal_line_items (
        deal_id, package_id, quantity, unit_sale_price, currency, supplier_id,
        expected_unit_cost, reservation_status, sort_order, sourcing_mode, supplier_quote_at
      ) values (
        p_deal_id, v_package_id, v_quantity, v_unit_price, v_deal.currency, v_supplier_id,
        v_expected_cost, 'none', v_sort, v_sourcing_mode, v_quote_at
      ) returning id into v_line_id;
    else
      update public.deal_line_items
      set package_id = v_package_id,
          quantity = v_quantity,
          unit_sale_price = v_unit_price,
          currency = v_deal.currency,
          supplier_id = v_supplier_id,
          expected_unit_cost = v_expected_cost,
          sourcing_mode = v_sourcing_mode,
          supplier_quote_at = v_quote_at,
          sort_order = v_sort,
          updated_at = timezone('utc', now())
      where id = v_line_id;
    end if;
    if v_sourcing_mode = 'owned' then
      update public.sourcing_shortages
      set status = 'cancelled', cleared_at = timezone('utc', now()), updated_at = timezone('utc', now())
      where deal_line_item_id = v_line_id and status <> 'purchased';
      update public.deal_line_items set sourcing_shortage_id = null where id = v_line_id;
    end if;
    v_keep_ids := array_append(v_keep_ids, v_line_id);
    v_total := v_total + v_quantity * v_unit_price;
    v_sort := v_sort + 1;
  end loop;

  delete from public.deal_line_items
  where deal_id = p_deal_id and not (id = any(v_keep_ids));
  update public.deals
  set account_id = p_account_id,
      primary_contact_id = p_contact_id,
      source = p_source,
      notes = nullif(btrim(p_notes), ''),
      total_amount = v_total,
      stock_reconciliation_status = case
        when stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled') then 'pending'
        else stock_reconciliation_status
      end,
      updated_at = timezone('utc', now())
  where id = p_deal_id;
  insert into public.deal_activities (deal_id, actor_profile_id, action, summary, metadata)
  values (
    p_deal_id, auth.uid(), 'commercial_details_updated',
    'Updated multi-event deal products and pricing',
    jsonb_build_object('line_count', jsonb_array_length(p_lines), 'total_amount', v_total)
  );
  return jsonb_build_object('deal_id', p_deal_id, 'line_count', jsonb_array_length(p_lines), 'total_amount', v_total);
end;
$$;

create or replace function public.admin_create_order_from_signed_deal(p_deal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.deals%rowtype;
  v_form public.booking_forms%rowtype;
  v_account public.crm_accounts%rowtype;
  v_contact public.crm_contacts%rowtype;
  v_snapshot jsonb;
  v_line jsonb;
  v_deal_line public.deal_line_items%rowtype;
  v_res public.inventory_reservations%rowtype;
  v_order_id uuid;
  v_order_line_id uuid;
  v_order_ref text;
  v_invoice_id uuid;
  v_primary_package_id text;
  v_total_quantity int := 0;
  v_quantity int;
  v_unit_price numeric;
  v_line_total numeric;
  v_package_id text;
  v_description text;
  v_currency text;
  v_total numeric;
  v_computed_total numeric := 0;
  v_sort int := 0;
  v_existing_order public.orders%rowtype;
  v_used_line_ids uuid[] := '{}'::uuid[];
  v_snapshot_line_id uuid;
begin
  if auth.role() <> 'service_role'
    and not public.has_cms_permission('finance.manage')
    and not public.is_admin()
  then raise exception 'forbidden'; end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'deal_not_found'; end if;
  if v_deal.order_id is not null then
    select * into v_existing_order from public.orders where id = v_deal.order_id;
    return jsonb_build_object(
      'order_id', v_existing_order.id,
      'order_reference', v_existing_order.reference,
      'already_created', true
    );
  end if;
  if v_deal.stage not in ('signed', 'awaiting_invoice') then raise exception 'completed_signatures_required'; end if;

  select * into v_form
  from public.booking_forms
  where deal_id = v_deal.id and status = 'completed'
  order by revision desc limit 1 for update;
  if not found then raise exception 'completed_booking_form_required'; end if;
  if v_deal.account_id is null or v_deal.primary_contact_id is null then
    raise exception 'deal_account_and_contact_required';
  end if;
  select * into v_account from public.crm_accounts where id = v_deal.account_id;
  select * into v_contact from public.crm_contacts where id = v_deal.primary_contact_id;
  if v_account.id is null or v_contact.id is null then raise exception 'deal_account_or_contact_missing'; end if;
  if v_account.account_type <> 'agent_company' then raise exception 'xero_billing_requires_agent_company_account'; end if;

  v_snapshot := v_form.snapshot_data;
  v_currency := upper(coalesce(nullif(v_snapshot->>'currency', ''), v_deal.currency, 'USD'));
  if v_currency <> 'USD' then raise exception 'native_deal_orders_must_be_usd'; end if;
  v_total := (v_snapshot->>'total')::numeric;
  if v_total is null or v_total < 0 then raise exception 'invalid_snapshot_total'; end if;
  if jsonb_array_length(coalesce(v_snapshot->'lines', '[]'::jsonb)) = 0 then
    raise exception 'booking_form_line_required';
  end if;
  v_primary_package_id := (v_snapshot->'lines'->0)->>'packageId';

  for v_line in select value from jsonb_array_elements(v_snapshot->'lines')
  loop
    v_package_id := nullif(v_line->>'packageId', '');
    v_quantity := (v_line->>'quantity')::int;
    v_unit_price := (v_line->>'unitPrice')::numeric;
    v_line_total := (v_line->>'lineTotal')::numeric;
    if v_package_id is null or v_quantity <= 0 or v_unit_price < 0 then
      raise exception 'invalid_booking_form_line';
    end if;
    if not exists (select 1 from public.packages where id = v_package_id) then
      raise exception 'package_not_found:%', v_package_id;
    end if;
    v_total_quantity := v_total_quantity + v_quantity;
    v_computed_total := v_computed_total + v_line_total;
  end loop;
  if abs(v_computed_total - v_total) > 0.01 then raise exception 'booking_form_total_mismatch'; end if;

  v_order_ref := 'ZK-' || to_char(timezone('utc', now()), 'YYYY') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.orders (
    reference, agent_profile_id, package_id, status, guests, unit_price,
    total_amount, currency, client_name, client_email, client_phone,
    client_company, client_nationality, dietary_requirements, special_requests,
    po_number, shipping_address_line1, shipping_address_line2, shipping_city,
    shipping_postcode, shipping_country, billing_address_line1,
    billing_address_line2, billing_city, billing_postcode, billing_country,
    channel, salesforce_sync_status, crm_account_id, crm_contact_id, deal_id,
    booking_form_id
  ) values (
    v_order_ref, v_account.portal_profile_id, v_primary_package_id, 'pending',
    v_total_quantity,
    case when v_total_quantity > 0 then round(v_total / v_total_quantity, 2) else 0 end,
    v_total, v_currency,
    coalesce(nullif(v_snapshot#>>'{billTo,contactName}', ''), v_contact.full_name),
    lower(coalesce(nullif(v_snapshot#>>'{billTo,contactEmail}', ''), v_contact.email)),
    coalesce(v_contact.phone, ''),
    coalesce(nullif(v_snapshot#>>'{billTo,accountName}', ''), v_account.name),
    '', null, null, null,
    coalesce(v_account.billing_address_line1, ''),
    coalesce(v_account.billing_address_line2, ''),
    coalesce(v_account.billing_city, ''),
    coalesce(v_account.billing_postcode, ''),
    coalesce(v_account.billing_country, ''),
    coalesce(v_account.billing_address_line1, ''),
    coalesce(v_account.billing_address_line2, ''),
    coalesce(v_account.billing_city, ''),
    coalesce(v_account.billing_postcode, ''),
    coalesce(v_account.billing_country, ''),
    'native_deal', 'skipped', v_account.id, v_contact.id, v_deal.id, v_form.id
  ) returning id into v_order_id;

  for v_line in select value from jsonb_array_elements(v_snapshot->'lines')
  loop
    v_package_id := v_line->>'packageId';
    v_quantity := (v_line->>'quantity')::int;
    v_unit_price := (v_line->>'unitPrice')::numeric;
    v_line_total := (v_line->>'lineTotal')::numeric;
    v_description := coalesce(nullif(v_line->>'description', ''), v_line->>'packageName', 'Package');

    v_snapshot_line_id := nullif(v_line->>'dealLineItemId', '')::uuid;
    v_deal_line := null;
    if v_snapshot_line_id is not null then
      select * into v_deal_line
      from public.deal_line_items
      where id = v_snapshot_line_id and deal_id = v_deal.id
        and not (id = any(v_used_line_ids));
    end if;
    if v_deal_line.id is null then
      select * into v_deal_line
      from public.deal_line_items
      where deal_id = v_deal.id and package_id = v_package_id
        and not (id = any(v_used_line_ids))
        and quantity = v_quantity
        and unit_sale_price = v_unit_price
      order by sort_order, id limit 1;
    end if;
    if v_deal_line.id is null then
      select * into v_deal_line
      from public.deal_line_items
      where deal_id = v_deal.id and package_id = v_package_id
        and not (id = any(v_used_line_ids))
      order by sort_order, id limit 1;
    end if;
    if v_deal_line.id is null then raise exception 'deal_line_missing:%', v_package_id; end if;
    v_used_line_ids := array_append(v_used_line_ids, v_deal_line.id);

    if v_deal_line.reservation_id is null then
      raise exception 'active_reservation_required:%', v_package_id;
    end if;
    select * into v_res
    from public.inventory_reservations
    where id = v_deal_line.reservation_id and status = 'active'
    for update;
    if not found then raise exception 'active_reservation_required:%', v_package_id; end if;
    if v_res.quantity <> v_quantity then raise exception 'reservation_quantity_mismatch:%', v_package_id; end if;
    if v_deal_line.sourcing_mode = 'brokered' and v_res.kind <> 'sourcing' then
      raise exception 'brokered_sourcing_reservation_required:%', v_package_id;
    end if;
    if v_deal_line.sourcing_mode = 'owned' and v_res.kind <> 'deal_reservation' then
      raise exception 'owned_stock_reservation_required:%', v_package_id;
    end if;

    if v_deal_line.sourcing_mode = 'owned' then
      perform public.lock_package_inventory(v_package_id);
      perform public.adjust_linked_inventory_held(v_package_id, -v_quantity);
      perform public.adjust_linked_inventory_available(v_package_id, -v_quantity);
      insert into public.inventory_ledger_entries (
        package_id, pool_id, entry_type, quantity_delta, reason,
        actor_profile_id, source_table, source_id, reservation_id, deal_id, metadata
      ) values (
        v_package_id, v_res.pool_id, 'reservation_release', v_quantity,
        'Deal reservation converted to confirmed order', auth.uid(),
        'inventory_reservations', v_res.id::text, v_res.id, v_deal.id,
        jsonb_build_object('order_id', v_order_id, 'conversion', true)
      ) on conflict (source_table, source_id, entry_type) do nothing;
      insert into public.inventory_ledger_entries (
        package_id, pool_id, entry_type, quantity_delta, reason,
        actor_profile_id, source_table, source_id, reservation_id, deal_id, metadata
      ) values (
        v_package_id, v_res.pool_id, 'order_commit', -v_quantity,
        'Signed native deal committed to order', auth.uid(),
        'orders', v_order_id::text || ':' || v_deal_line.id::text, v_res.id, v_deal.id,
        jsonb_build_object('order_id', v_order_id, 'document_ref', v_form.document_ref)
      ) on conflict (source_table, source_id, entry_type) do nothing;
    else
      update public.sourcing_shortages
      set status = 'confirmed', updated_at = timezone('utc', now()),
          note = concat_ws(E'\n', note, 'Client and ZK signed; supplier purchase required for ' || v_order_ref)
      where id = v_deal_line.sourcing_shortage_id;
    end if;

    update public.inventory_reservations
    set status = 'converted', converted_at = timezone('utc', now()), expires_at = null,
        updated_at = timezone('utc', now()),
        note = concat_ws(E'\n', note, 'Converted to order ' || v_order_ref)
    where id = v_res.id;
    update public.deal_line_items
    set reservation_status = 'converted', updated_at = timezone('utc', now())
    where id = v_deal_line.id;

    insert into public.order_line_items (
      order_id, deal_line_item_id, package_id, description, quantity,
      unit_price, line_total, currency, sort_order, sourcing_mode,
      supplier_id, expected_unit_cost
    ) values (
      v_order_id, v_deal_line.id, v_package_id, v_description, v_quantity,
      v_unit_price, v_line_total, v_currency, v_sort, v_deal_line.sourcing_mode,
      v_deal_line.supplier_id, v_deal_line.expected_unit_cost
    ) returning id into v_order_line_id;

    if v_deal_line.sourcing_mode = 'owned' then
      perform public.allocate_order_cost_layers(v_order_id, v_package_id, v_quantity, v_currency);
    else
      insert into public.order_supplier_fulfilments (
        order_id, order_line_item_id, package_id, supplier_id, quantity, status, notes
      ) values (
        v_order_id, v_order_line_id, v_package_id, v_deal_line.supplier_id,
        v_quantity, 'pending', 'Brokered stock: purchase and supplier confirmation required'
      ) on conflict do nothing;
    end if;
    v_sort := v_sort + 1;
  end loop;

  insert into public.invoices (order_id, reference, amount, currency, status, issued_at, due_date)
  values (v_order_id, v_order_ref, v_total, v_currency, 'awaiting_invoice', null, null)
  returning id into v_invoice_id;
  update public.deals
  set order_id = v_order_id, stage = 'awaiting_invoice', do_not_expire = true,
      hold_expires_at = null, next_action = 'Create and send Xero invoice',
      next_action_due_at = timezone('utc', now()), updated_at = timezone('utc', now())
  where id = v_deal.id;
  update public.booking_forms set order_id = v_order_id, updated_at = timezone('utc', now())
  where id = v_form.id;
  insert into public.deal_activities (deal_id, actor_profile_id, action, summary, metadata)
  values (
    v_deal.id, auth.uid(), 'order_created',
    'Created one native multi-event order from completed booking form',
    jsonb_build_object(
      'order_id', v_order_id, 'invoice_id', v_invoice_id,
      'booking_form_id', v_form.id, 'line_count', jsonb_array_length(v_snapshot->'lines')
    )
  );
  insert into public.booking_form_events (booking_form_id, event_type, actor_profile_id, metadata)
  values (
    v_form.id, 'order_created', auth.uid(),
    jsonb_build_object('order_id', v_order_id, 'invoice_id', v_invoice_id)
  );
  return jsonb_build_object(
    'order_id', v_order_id, 'order_reference', v_order_ref,
    'invoice_id', v_invoice_id, 'already_created', false
  );
end;
$$;
