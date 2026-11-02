-- Countersigning a deal currently updates booking_forms → deals.stage = signed
-- in one statement. That fires sync_deal_inventory_after_stage_change, which
-- release/reallocates every line and then repacks the shared weekend
-- (Skybridge 3-day + Friday, etc.). On a large Abu Dhabi basket that exceeds
-- the hosted statement timeout, so the ZK signature rolls back and the deal
-- stays on "Client signed — ZK signature required".
--
-- Record the signature and move the deal to Signed without touching inventory.
-- Cost layers are still allocated when the order is created. Weekend repack
-- stays on product/quantity edits, not on this stage change.

create or replace function public.inventory_skip_weekend_rebalance()
returns boolean
language sql
stable
as $$
  select current_setting('inventory.skip_weekend_rebalance', true) = 'on';
$$;

comment on function public.inventory_skip_weekend_rebalance() is
  'True inside stage-change allocation so filling a signed line does not reshuffle the whole weekend.';

revoke all on function public.inventory_skip_weekend_rebalance() from public;
grant execute on function public.inventory_skip_weekend_rebalance()
  to authenticated, service_role;

create or replace function public.deals_skip_inventory_on_zk_countersign()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.stage = 'awaiting_zk_signature'
    and new.stage in ('signed', 'awaiting_invoice', 'awaiting_payment')
  then
    perform set_config('inventory.skip_stage_sync', 'on', true);
  end if;
  return new;
end;
$$;

drop trigger if exists deals_skip_inventory_on_zk_countersign_trg on public.deals;
create trigger deals_skip_inventory_on_zk_countersign_trg
before update of stage on public.deals
for each row
when (old.stage is distinct from new.stage)
execute function public.deals_skip_inventory_on_zk_countersign();

revoke all on function public.deals_skip_inventory_on_zk_countersign() from public;

create or replace function public.advance_deal_after_zk_signature()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('zk_signed', 'completed')
    and old.status is distinct from new.status
  then
    perform set_config('inventory.skip_stage_sync', 'on', true);
    update public.deals
    set stage = 'signed',
        next_action = 'Create and send invoice',
        next_action_due_at = timezone('utc', now()),
        do_not_expire = true,
        hold_expires_at = null,
        updated_at = timezone('utc', now())
    where id = new.deal_id
      and order_id is null
      and stage in (
        'draft',
        'sourcing',
        'proposal',
        'awaiting_booking_form_send',
        'booking_form_sent',
        'awaiting_client_signature',
        'awaiting_zk_signature',
        'form_expired'
      );
  end if;
  return new;
end;
$$;

create or replace function public.admin_record_zk_signature(
  p_booking_form_id uuid,
  p_signer_name text,
  p_signer_email text,
  p_signature_path text,
  p_signature_sha256 text,
  p_evidence_hash text,
  p_consent_text text,
  p_ip_address text default null,
  p_location text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form public.booking_forms%rowtype;
begin
  if not public.is_cms_operator() then raise exception 'admin_signature_required'; end if;
  perform set_config('inventory.skip_stage_sync', 'on', true);
  select * into v_form
  from public.booking_forms
  where id = p_booking_form_id
  for update;
  if not found then raise exception 'booking_form_not_found'; end if;
  if v_form.status = 'zk_signed' then
    update public.deals
    set stage = 'signed',
        next_action = 'Create and send invoice',
        next_action_due_at = timezone('utc', now()),
        do_not_expire = true,
        hold_expires_at = null,
        updated_at = timezone('utc', now())
    where id = v_form.deal_id
      and order_id is null
      and stage in (
        'draft',
        'sourcing',
        'proposal',
        'awaiting_booking_form_send',
        'booking_form_sent',
        'awaiting_client_signature',
        'awaiting_zk_signature',
        'form_expired'
      );
    return;
  end if;
  if v_form.status <> 'awaiting_zk_signature' then raise exception 'client_must_sign_first'; end if;

  insert into public.booking_form_signatures (
    booking_form_id, signer_role, signer_profile_id, signer_name, signer_email,
    signature_path, signature_sha256, evidence_hash, consent_text, ip_address, location,
    user_agent
  ) values (
    v_form.id, 'zk_admin', auth.uid(), btrim(p_signer_name),
    lower(btrim(p_signer_email)), btrim(p_signature_path),
    btrim(p_signature_sha256), btrim(p_evidence_hash), btrim(p_consent_text),
    p_ip_address, p_location, p_user_agent
  );

  update public.booking_forms
  set status = 'zk_signed',
      zk_signed_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_form.id;

  insert into public.booking_form_events (
    booking_form_id, event_type, actor_profile_id, actor_email, ip_address, location,
    user_agent, metadata
  ) values (
    v_form.id, 'zk_signed', auth.uid(), lower(btrim(p_signer_email)),
    p_ip_address, p_location, p_user_agent, jsonb_build_object('evidence_hash', p_evidence_hash)
  );
end;
$$;

create or replace function public.admin_finalize_native_booking_form(
  p_booking_form_id uuid,
  p_final_pdf_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form public.booking_forms%rowtype;
begin
  if auth.role() <> 'service_role' and not public.is_cms_operator() then
    raise exception 'forbidden';
  end if;
  perform set_config('inventory.skip_stage_sync', 'on', true);
  select * into v_form from public.booking_forms
  where id = p_booking_form_id for update;
  if not found then raise exception 'booking_form_not_found'; end if;

  if v_form.status <> 'completed' then
    if v_form.status <> 'zk_signed' then raise exception 'both_signatures_required'; end if;
    update public.booking_forms
    set status = 'completed',
        final_pdf_path = btrim(p_final_pdf_path),
        completed_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_form.id;
    insert into public.booking_form_events (
      booking_form_id, event_type, actor_profile_id, metadata
    ) values (
      v_form.id, 'completed', auth.uid(),
      jsonb_build_object('final_pdf_path', p_final_pdf_path)
    );
  end if;

  update public.deals
  set stage = 'signed',
      next_action = 'Create and send invoice',
      next_action_due_at = timezone('utc', now()),
      do_not_expire = true,
      hold_expires_at = null,
      updated_at = timezone('utc', now())
  where id = v_form.deal_id
    and order_id is null
    and stage in (
      'draft',
      'sourcing',
      'proposal',
      'awaiting_booking_form_send',
      'booking_form_sent',
      'awaiting_client_signature',
      'awaiting_zk_signature',
      'form_expired'
    );
end;
$$;

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
  if current_setting('inventory.skip_stage_sync', true) = 'on' then
    return new;
  end if;

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
      if v_allocated > v_line.quantity then
        perform public.inventory_trim_deal_line_overallocation(v_line.id);
        v_allocated := public.inventory_deal_line_live_quantity(v_line.id);
      end if;
      if v_allocated >= v_line.quantity then
        perform public.inventory_sync_deal_line_shortage(v_line.id);
        continue;
      end if;
      begin
        perform set_config('inventory.skip_weekend_rebalance', 'on', true);
        perform public.inventory_allocate_deal_line_remainder(v_line.id);
      exception
        when others then
          perform public.inventory_sync_deal_line_shortage(v_line.id);
          raise notice 'Could not allocate deal line % after stage %: %',
            v_line.id, new.stage, sqlerrm;
      end;
    elsif v_new_holds then
      begin
        perform set_config('inventory.skip_weekend_rebalance', 'on', true);
        perform public.inventory_allocate_deal_line_remainder(v_line.id);
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

create or replace function public.inventory_allocate_deal_line_remainder(
  p_deal_line_item_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.deal_line_items%rowtype;
  v_deal public.deals%rowtype;
  v_needed int;
  v_order_line_id uuid;
  v_allocated int := 0;
begin
  if p_deal_line_item_id is null then return 0; end if;
  if not public.inventory_caller_may_mutate()
    and session_user not in ('postgres', 'supabase_admin')
    and auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and not public.has_cms_permission('deals.manage')
  then raise exception 'forbidden'; end if;

  select * into v_line from public.deal_line_items
  where id = p_deal_line_item_id for update;
  if not found then return 0; end if;
  select * into v_deal from public.deals where id = v_line.deal_id for update;
  if not found then return 0; end if;
  if not public.deal_stage_holds_purchased_stock(v_deal.stage)
    or coalesce(v_line.sourcing_mode, 'owned') <> 'owned'
  then
    perform public.inventory_sync_deal_line_shortage(v_line.id);
    return 0;
  end if;

  v_needed := v_line.quantity
    - public.inventory_deal_line_live_quantity(v_line.id);
  if v_needed <= 0 then
    if not public.inventory_skip_weekend_rebalance() then
      perform public.inventory_rebalance_linked_day_coverage(v_line.package_id);
    end if;
    perform public.inventory_sync_deal_line_shortage(v_line.id);
    return 0;
  end if;

  select line.id into v_order_line_id
  from public.order_line_items line
  where line.deal_line_item_id = v_line.id
  order by line.sort_order, line.id
  limit 1;

  begin
    v_allocated := public.inventory_allocate_quantity_from_layers(
      v_line.package_id, v_needed, 'committed',
      'deal_line_remainder',
      'deal-line-remainder:' || v_line.id::text || ':' || gen_random_uuid()::text,
      null, v_line.deal_id, v_line.id, v_deal.order_id, v_order_line_id, null,
      'Fill uncovered signed deal quantity without releasing existing stock',
      jsonb_build_object('automatic', true)
    );
  exception
    when others then
      if sqlerrm like 'insufficient_purchased_stock%'
        or sqlerrm like 'insufficient_purchased_day_capacity%'
        or sqlerrm like 'insufficient_canonical%'
      then
        v_allocated := 0;
      else
        raise;
      end if;
  end;

  if not public.inventory_skip_weekend_rebalance() then
    perform public.inventory_rebalance_linked_day_coverage(v_line.package_id);
  end if;
  perform public.inventory_sync_deal_line_shortage(v_line.id);
  return coalesce(v_allocated, 0);
end;
$$;

comment on function public.inventory_allocate_deal_line_remainder(uuid) is
  'Fill uncovered signed deal quantity without releasing existing stock. Weekend repack is skipped during deal stage changes.';

revoke all on function public.inventory_allocate_deal_line_remainder(uuid) from public;
grant execute on function public.inventory_allocate_deal_line_remainder(uuid)
  to authenticated, service_role;

-- Creating the order already allocates cost layers. Do not let the
-- signed → awaiting_invoice stage change repack the weekend in the same
-- statement as converting reservations.
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
  v_order_unit_price numeric;
  v_order_line_total numeric;
  v_package_id text;
  v_description text;
  v_invoice_currency text;
  v_invoice_total numeric;
  v_order_currency text;
  v_order_total numeric;
  v_computed_total numeric := 0;
  v_sort int := 0;
  v_existing_order public.orders%rowtype;
  v_used_line_ids uuid[] := '{}'::uuid[];
  v_snapshot_line_id uuid;
  v_reporting_line jsonb;
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
  if v_account.account_type not in ('agent_company', 'direct_client', 'supplier_related')
    and not (
      coalesce(v_account.account_types, '{}'::text[]) && array[
        'concierge', 'travel_agency', 'ticket_agent', 'hospitality_agency', 'direct_client', 'supplier'
      ]::text[]
    )
  then
    raise exception 'xero_billing_requires_billable_account';
  end if;

  v_snapshot := v_form.snapshot_data;
  v_invoice_currency := upper(coalesce(nullif(v_snapshot->>'currency', ''), 'USD'));
  if v_invoice_currency not in ('USD', 'AED', 'GBP', 'EUR') then
    raise exception 'native_deal_orders_unsupported_currency';
  end if;
  v_invoice_total := (v_snapshot->>'total')::numeric;
  if v_invoice_total is null or v_invoice_total < 0 then raise exception 'invalid_snapshot_total'; end if;
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
  if abs(v_computed_total - v_invoice_total) > 0.01 then raise exception 'booking_form_total_mismatch'; end if;

  v_order_currency := upper(coalesce(
    nullif(v_snapshot#>>'{reporting,currency}', ''),
    v_deal.currency,
    'USD'
  ));
  if v_order_currency <> 'USD' then raise exception 'native_deal_orders_must_be_usd'; end if;
  if v_invoice_currency = 'USD' then
    v_order_total := v_invoice_total;
  else
    v_order_total := coalesce(
      (v_snapshot#>>'{reporting,total}')::numeric,
      v_deal.total_amount
    );
    if v_order_total is null or v_order_total < 0 then raise exception 'invalid_reporting_total'; end if;
  end if;

  v_order_ref := 'ZK-' || to_char(timezone('utc', now()), 'YYYY') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.orders (
    reference, agent_profile_id, package_id, status, guests, unit_price,
    total_amount, currency, client_name, client_email, client_phone,
    client_nationality, dietary_requirements, special_requests,
    po_number, shipping_address_line1, shipping_address_line2, shipping_city,
    shipping_postcode, shipping_country, billing_address_line1,
    billing_address_line2, billing_city, billing_postcode, billing_country,
    channel, salesforce_sync_status, crm_account_id, crm_contact_id, deal_id,
    booking_form_id
  ) values (
    v_order_ref, v_account.portal_profile_id, v_primary_package_id, 'pending',
    v_total_quantity,
    case when v_total_quantity > 0 then round(v_order_total / v_total_quantity, 2) else 0 end,
    v_order_total, v_order_currency,
    coalesce(nullif(v_snapshot#>>'{billTo,contactName}', ''), v_contact.full_name),
    lower(coalesce(nullif(v_snapshot#>>'{billTo,contactEmail}', ''), v_contact.email)),
    coalesce(v_contact.phone, ''),
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

    v_reporting_line := (
      select value
      from jsonb_array_elements(coalesce(v_snapshot->'reporting'->'lines', '[]'::jsonb)) as value
      where nullif(value->>'dealLineItemId', '') = v_deal_line.id::text
      limit 1
    );
    if v_invoice_currency = 'USD' then
      v_order_unit_price := v_unit_price;
      v_order_line_total := v_line_total;
    else
      v_order_unit_price := coalesce(
        (v_reporting_line->>'unitPrice')::numeric,
        v_deal_line.unit_sale_price
      );
      v_order_line_total := coalesce(
        (v_reporting_line->>'lineTotal')::numeric,
        round(v_deal_line.unit_sale_price * v_quantity, 2)
      );
    end if;

    insert into public.order_line_items (
      order_id, deal_line_item_id, package_id, description, quantity,
      unit_price, line_total, currency, sort_order, sourcing_mode,
      supplier_id, expected_unit_cost
    ) values (
      v_order_id, v_deal_line.id, v_package_id, v_description, v_quantity,
      v_order_unit_price, v_order_line_total, v_order_currency, v_sort, v_deal_line.sourcing_mode,
      v_deal_line.supplier_id, v_deal_line.expected_unit_cost
    ) returning id into v_order_line_id;

    if v_deal_line.sourcing_mode = 'owned' then
      perform public.allocate_order_cost_layers(v_order_id, v_package_id, v_quantity, v_order_currency);
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
  values (v_order_id, v_order_ref, v_invoice_total, v_invoice_currency, 'awaiting_invoice', null, null)
  returning id into v_invoice_id;
  perform set_config('inventory.skip_stage_sync', 'on', true);
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
      'booking_form_id', v_form.id, 'line_count', jsonb_array_length(v_snapshot->'lines'),
      'invoice_currency', v_invoice_currency
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
