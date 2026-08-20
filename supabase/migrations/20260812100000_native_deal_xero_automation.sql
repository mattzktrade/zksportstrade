-- Phase 2C: signed native deal -> one multi-line order -> one Xero invoice.

alter table public.orders alter column agent_profile_id drop not null;
alter table public.orders
  add column if not exists crm_account_id uuid references public.crm_accounts(id) on delete set null,
  add column if not exists crm_contact_id uuid references public.crm_contacts(id) on delete set null,
  add column if not exists deal_id uuid references public.deals(id) on delete set null,
  add column if not exists booking_form_id uuid references public.booking_forms(id) on delete set null;

create unique index if not exists orders_deal_id_unique_idx
  on public.orders (deal_id)
  where deal_id is not null;
create unique index if not exists orders_booking_form_id_unique_idx
  on public.orders (booking_form_id)
  where booking_form_id is not null;

alter table public.booking_forms
  add column if not exists order_id uuid references public.orders(id) on delete set null;
create unique index if not exists booking_forms_order_id_unique_idx
  on public.booking_forms (order_id)
  where order_id is not null;

alter table public.orders drop constraint if exists orders_channel_check;
alter table public.orders
  add constraint orders_channel_check
  check (channel in ('trade_portal', 'wix', 'partner_api', 'admin', 'native_deal'));

drop policy if exists "orders_select_own_or_admin" on public.orders;
create policy "orders_select_own_or_cms"
  on public.orders for select
  using (
    agent_profile_id = auth.uid()
    or public.has_cms_permission('orders.view')
    or public.is_admin()
  );

drop policy if exists "invoices_select_via_order_or_admin" on public.invoices;
create policy "invoices_select_via_order_or_cms"
  on public.invoices for select
  using (
    public.has_cms_permission('orders.view')
    or public.has_cms_permission('finance.view')
    or public.is_admin()
    or exists (
      select 1 from public.orders o
      where o.id = invoices.order_id
        and o.agent_profile_id = auth.uid()
    )
  );

create table if not exists public.order_line_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  deal_line_item_id uuid references public.deal_line_items(id) on delete set null,
  package_id text not null references public.packages(id) on delete restrict,
  description text not null,
  quantity int not null check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0),
  line_total numeric not null check (line_total >= 0),
  currency text not null default 'USD',
  sort_order int not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  constraint order_line_items_order_package_unique unique (order_id, package_id)
);

create index if not exists order_line_items_order_idx
  on public.order_line_items (order_id, sort_order);
create index if not exists order_line_items_package_idx
  on public.order_line_items (package_id);

alter table public.order_line_items enable row level security;
create policy "order_line_items_cms_select"
  on public.order_line_items for select
  using (public.is_cms_staff());
create policy "order_line_items_agent_select"
  on public.order_line_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_line_items.order_id
        and o.agent_profile_id = auth.uid()
    )
  );

alter table public.invoices
  add column if not exists payment_reminder_count int not null default 0,
  add column if not exists last_payment_reminder_at timestamptz,
  add column if not exists payment_reminder_error text,
  add column if not exists invoice_emailed_at timestamptz,
  add column if not exists invoice_email_error text,
  add column if not exists overdue_since date,
  add column if not exists cancellation_eligible_at date,
  add column if not exists cancelled_at timestamptz,
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciled_by uuid references public.profiles(id) on delete set null,
  add column if not exists reconciliation_note text;

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check
  check (status in ('awaiting_invoice', 'awaiting_payment', 'paid', 'delivered', 'cancelled'));
alter table public.invoices
  drop constraint if exists invoices_payment_reminder_count_check;
alter table public.invoices
  add constraint invoices_payment_reminder_count_check
  check (payment_reminder_count >= 0);

create index if not exists invoices_overdue_work_idx
  on public.invoices (status, due_date, last_payment_reminder_at)
  where status = 'awaiting_payment';

create or replace function public.prevent_signed_deal_line_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_deal_id uuid;
begin
  v_deal_id := case when tg_op = 'DELETE' then old.deal_id else new.deal_id end;
  if tg_op = 'UPDATE'
    and new.deal_id is not distinct from old.deal_id
    and new.package_id is not distinct from old.package_id
    and new.quantity is not distinct from old.quantity
    and new.unit_sale_price is not distinct from old.unit_sale_price
    and new.currency is not distinct from old.currency
    and new.supplier_id is not distinct from old.supplier_id
    and new.expected_unit_cost is not distinct from old.expected_unit_cost
    and new.discount_reason is not distinct from old.discount_reason
    and new.sort_order is not distinct from old.sort_order
  then
    return new;
  end if;
  if exists (
    select 1
    from public.booking_forms bf
    where bf.deal_id = v_deal_id
      and bf.status in (
        'sent', 'viewed', 'awaiting_zk_signature', 'zk_signed', 'completed'
      )
  ) then
    raise exception 'booking_form_snapshot_locks_deal_lines';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists deal_line_items_booking_snapshot_lock_trg on public.deal_line_items;
create trigger deal_line_items_booking_snapshot_lock_trg
before insert or update or delete on public.deal_line_items
for each row execute function public.prevent_signed_deal_line_mutation();

create or replace function public.keep_client_signed_deal_reservations()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'awaiting_zk_signature'
    and old.status in ('sent', 'viewed')
  then
    update public.inventory_reservations
    set expires_at = null,
        updated_at = timezone('utc', now()),
        note = concat_ws(E'\n', note, 'Expiry removed after client signature')
    where deal_id = new.deal_id
      and status = 'active';
    update public.deals
    set do_not_expire = true,
        hold_expires_at = null,
        updated_at = timezone('utc', now())
    where id = new.deal_id;
  end if;
  return new;
end;
$$;

drop trigger if exists booking_forms_keep_signed_reservations_trg on public.booking_forms;
create trigger booking_forms_keep_signed_reservations_trg
after update of status on public.booking_forms
for each row execute function public.keep_client_signed_deal_reservations();

update public.inventory_reservations r
set expires_at = null,
    updated_at = timezone('utc', now()),
    note = concat_ws(E'\n', r.note, 'Expiry removed for already client-signed form')
from public.booking_forms bf
where bf.deal_id = r.deal_id
  and bf.status in ('awaiting_zk_signature', 'zk_signed', 'completed')
  and r.status = 'active'
  and r.expires_at is not null;

update public.deals d
set do_not_expire = true,
    hold_expires_at = null,
    updated_at = timezone('utc', now())
where exists (
  select 1 from public.booking_forms bf
  where bf.deal_id = d.id
    and bf.status in ('awaiting_zk_signature', 'zk_signed')
);

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
  v_deal_line_id uuid;
  v_res public.inventory_reservations%rowtype;
  v_order_id uuid;
  v_order_ref text;
  v_invoice_id uuid;
  v_primary_package_id text;
  v_primary_quantity int;
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
begin
  if auth.role() <> 'service_role'
    and not public.has_cms_permission('finance.manage')
    and not public.is_admin()
  then
    raise exception 'forbidden';
  end if;

  select * into v_deal
  from public.deals
  where id = p_deal_id
  for update;
  if not found then raise exception 'deal_not_found'; end if;

  if v_deal.order_id is not null then
    select * into v_existing_order from public.orders where id = v_deal.order_id;
    return jsonb_build_object(
      'order_id', v_existing_order.id,
      'order_reference', v_existing_order.reference,
      'already_created', true
    );
  end if;
  if v_deal.stage not in ('signed', 'awaiting_invoice') then
    raise exception 'completed_signatures_required';
  end if;

  select * into v_form
  from public.booking_forms
  where deal_id = v_deal.id
    and status = 'completed'
  order by revision desc
  limit 1
  for update;
  if not found then raise exception 'completed_booking_form_required'; end if;

  if v_deal.account_id is null or v_deal.primary_contact_id is null then
    raise exception 'deal_account_and_contact_required';
  end if;
  select * into v_account from public.crm_accounts where id = v_deal.account_id;
  select * into v_contact from public.crm_contacts where id = v_deal.primary_contact_id;
  if v_account.id is null or v_contact.id is null then
    raise exception 'deal_account_or_contact_missing';
  end if;
  if v_account.account_type <> 'agent_company' then
    raise exception 'xero_billing_requires_agent_company_account';
  end if;

  v_snapshot := v_form.snapshot_data;
  v_currency := upper(coalesce(nullif(v_snapshot->>'currency', ''), v_deal.currency, 'USD'));
  if v_currency <> 'USD' then raise exception 'native_deal_orders_must_be_usd'; end if;
  v_total := (v_snapshot->>'total')::numeric;
  if v_total is null or v_total < 0 then raise exception 'invalid_snapshot_total'; end if;
  if jsonb_array_length(coalesce(v_snapshot->'lines', '[]'::jsonb)) = 0 then
    raise exception 'booking_form_line_required';
  end if;

  v_line := (v_snapshot->'lines')->0;
  v_primary_package_id := v_line->>'packageId';
  v_primary_quantity := (v_line->>'quantity')::int;

  for v_line in
    select value from jsonb_array_elements(v_snapshot->'lines')
  loop
    v_package_id := nullif(v_line->>'packageId', '');
    v_quantity := (v_line->>'quantity')::int;
    v_unit_price := (v_line->>'unitPrice')::numeric;
    v_line_total := (v_line->>'lineTotal')::numeric;
    if v_package_id is null or v_quantity <= 0 or v_unit_price < 0 then
      raise exception 'invalid_booking_form_line';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_snapshot->'lines') duplicate
      where duplicate->>'packageId' = v_package_id
      group by duplicate->>'packageId'
      having count(*) > 1
    ) then
      raise exception 'duplicate_package_lines_not_supported';
    end if;
    if not exists (select 1 from public.packages where id = v_package_id) then
      raise exception 'package_not_found:%', v_package_id;
    end if;
    v_total_quantity := v_total_quantity + v_quantity;
    v_computed_total := v_computed_total + v_line_total;
  end loop;
  if abs(v_computed_total - v_total) > 0.01 then
    raise exception 'booking_form_total_mismatch';
  end if;

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
    v_order_ref,
    v_account.portal_profile_id,
    v_primary_package_id,
    'pending',
    v_total_quantity,
    case when v_total_quantity > 0 then round(v_total / v_total_quantity, 2) else 0 end,
    v_total,
    v_currency,
    coalesce(nullif(v_snapshot#>>'{billTo,contactName}', ''), v_contact.full_name),
    lower(coalesce(nullif(v_snapshot#>>'{billTo,contactEmail}', ''), v_contact.email)),
    coalesce(v_contact.phone, ''),
    coalesce(nullif(v_snapshot#>>'{billTo,accountName}', ''), v_account.name),
    '',
    null,
    null,
    null,
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
    'native_deal',
    'skipped',
    v_account.id,
    v_contact.id,
    v_deal.id,
    v_form.id
  )
  returning id into v_order_id;

  for v_line in
    select value from jsonb_array_elements(v_snapshot->'lines')
  loop
    v_package_id := v_line->>'packageId';
    v_quantity := (v_line->>'quantity')::int;
    v_unit_price := (v_line->>'unitPrice')::numeric;
    v_line_total := (v_line->>'lineTotal')::numeric;
    v_description := coalesce(nullif(v_line->>'description', ''), v_line->>'packageName', 'Package');

    select id into v_deal_line_id
    from public.deal_line_items
    where deal_id = v_deal.id
      and package_id = v_package_id
    order by sort_order, id
    limit 1;

    select * into v_res
    from public.inventory_reservations
    where deal_id = v_deal.id
      and package_id = v_package_id
      and status = 'active'
    order by created_at, id
    limit 1
    for update;
    if v_res.id is null then raise exception 'active_reservation_required:%', v_package_id; end if;
    if v_res.quantity <> v_quantity then
      raise exception 'reservation_quantity_mismatch:%', v_package_id;
    end if;

    perform public.lock_package_inventory(v_package_id);
    update public.package_inventory
    set qty_held = greatest(0, coalesce(qty_held, 0) - v_quantity)
    where package_id = v_package_id;
    perform public.adjust_linked_inventory_available(v_package_id, -v_quantity);

    update public.inventory_reservations
    set status = 'converted',
        converted_at = timezone('utc', now()),
        expires_at = null,
        updated_at = timezone('utc', now()),
        note = concat_ws(E'\n', note, 'Converted to order ' || v_order_ref)
    where id = v_res.id;
    update public.deal_line_items
    set reservation_status = 'converted',
        updated_at = timezone('utc', now())
    where id = v_deal_line_id;

    insert into public.inventory_ledger_entries (
      package_id, pool_id, entry_type, quantity_delta, reason,
      actor_profile_id, source_table, source_id, reservation_id, deal_id, metadata
    ) values (
      v_package_id, v_res.pool_id, 'reservation_release', v_quantity,
      'Deal reservation converted to confirmed order', auth.uid(),
      'inventory_reservations', v_res.id::text, v_res.id, v_deal.id,
      jsonb_build_object('order_id', v_order_id, 'conversion', true)
    )
    on conflict (source_table, source_id, entry_type) do nothing;

    insert into public.inventory_ledger_entries (
      package_id, pool_id, entry_type, quantity_delta, reason,
      actor_profile_id, source_table, source_id, reservation_id, deal_id, metadata
    ) values (
      v_package_id, v_res.pool_id, 'order_commit', -v_quantity,
      'Signed native deal committed to order', auth.uid(),
      'orders', v_order_id::text || ':' || v_package_id, v_res.id, v_deal.id,
      jsonb_build_object('order_id', v_order_id, 'document_ref', v_form.document_ref)
    )
    on conflict (source_table, source_id, entry_type) do nothing;

    insert into public.order_line_items (
      order_id, deal_line_item_id, package_id, description, quantity,
      unit_price, line_total, currency, sort_order
    ) values (
      v_order_id, v_deal_line_id, v_package_id, v_description, v_quantity,
      v_unit_price, v_line_total, v_currency, v_sort
    );
    perform public.allocate_order_cost_layers(v_order_id, v_package_id, v_quantity, v_currency);
    v_sort := v_sort + 1;
  end loop;

  insert into public.invoices (
    order_id, reference, amount, currency, status, issued_at, due_date
  ) values (
    v_order_id, v_order_ref, v_total, v_currency, 'awaiting_invoice', null, null
  )
  returning id into v_invoice_id;

  update public.deals
  set order_id = v_order_id,
      stage = 'awaiting_invoice',
      do_not_expire = true,
      hold_expires_at = null,
      next_action = 'Create and send Xero invoice',
      next_action_due_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_deal.id;
  update public.booking_forms
  set order_id = v_order_id,
      updated_at = timezone('utc', now())
  where id = v_form.id;

  insert into public.deal_activities (
    deal_id, actor_profile_id, action, summary, metadata
  ) values (
    v_deal.id, auth.uid(), 'order_created',
    'Created one native order from completed booking form',
    jsonb_build_object(
      'order_id', v_order_id,
      'invoice_id', v_invoice_id,
      'booking_form_id', v_form.id,
      'line_count', jsonb_array_length(v_snapshot->'lines')
    )
  );
  insert into public.booking_form_events (
    booking_form_id, event_type, actor_profile_id, metadata
  ) values (
    v_form.id, 'order_created', auth.uid(),
    jsonb_build_object('order_id', v_order_id, 'invoice_id', v_invoice_id)
  );

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_reference', v_order_ref,
    'invoice_id', v_invoice_id,
    'already_created', false
  );
end;
$$;

revoke all on function public.admin_create_order_from_signed_deal(uuid) from public;
grant execute on function public.admin_create_order_from_signed_deal(uuid) to authenticated, service_role;

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
  v_cons record;
begin
  if not public.has_cms_permission('finance.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.deal_id is null then raise exception 'native_deal_order_required'; end if;
  if v_order.status = 'cancelled' then
    return jsonb_build_object('order_id', v_order.id, 'already_cancelled', true);
  end if;

  select * into v_invoice from public.invoices where order_id = v_order.id for update;
  if v_invoice.status in ('paid', 'delivered') then
    raise exception 'paid_or_delivered_order_cannot_be_cancelled';
  end if;
  if v_invoice.xero_invoice_id is not null and not coalesce(p_xero_void_confirmed, false) then
    raise exception 'xero_invoice_must_be_voided_first';
  end if;

  for v_cons in
    select cost_layer_id, quantity
    from public.order_cost_consumptions
    where order_id = v_order.id
  loop
    if v_cons.cost_layer_id is not null then
      update public.package_cost_layers
      set quantity_remaining = quantity_remaining + v_cons.quantity
      where id = v_cons.cost_layer_id;
    end if;
  end loop;
  delete from public.order_cost_consumptions where order_id = v_order.id;

  for v_line in
    select package_id, quantity
    from public.order_line_items
    where order_id = v_order.id
    order by sort_order, id
  loop
    perform public.lock_package_inventory(v_line.package_id);
    perform public.adjust_linked_inventory_available(v_line.package_id, v_line.quantity);
    insert into public.inventory_ledger_entries (
      package_id, entry_type, quantity_delta, reason, actor_profile_id,
      source_table, source_id, deal_id, metadata
    ) values (
      v_line.package_id, 'order_cancel', v_line.quantity, btrim(p_reason), auth.uid(),
      'orders', v_order.id::text || ':' || v_line.package_id,
      v_order.deal_id, jsonb_build_object('order_id', v_order.id)
    )
    on conflict (source_table, source_id, entry_type) do nothing;
  end loop;

  update public.orders set status = 'cancelled' where id = v_order.id;
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
    v_order.deal_id, auth.uid(), 'order_cancelled', btrim(p_reason),
    jsonb_build_object('order_id', v_order.id, 'xero_void_confirmed', p_xero_void_confirmed)
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'deal_id', v_order.deal_id,
    'already_cancelled', false
  );
end;
$$;

revoke all on function public.admin_cancel_native_deal_order(uuid, text, boolean) from public;
grant execute on function public.admin_cancel_native_deal_order(uuid, text, boolean) to authenticated;

