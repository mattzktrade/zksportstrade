-- Hardening discovered during the Phase 3 readiness review.
-- Additive follow-up to the already-applied Phase 2C/2D migrations.

-- A moved line must remain locked when either its old or new deal has a sent/signed form.
create or replace function public.prevent_signed_deal_line_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_deal_id uuid;
  v_new_deal_id uuid;
begin
  if tg_op <> 'INSERT' then v_old_deal_id := old.deal_id; end if;
  if tg_op <> 'DELETE' then v_new_deal_id := new.deal_id; end if;
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
    from public.booking_forms form
    where form.deal_id in (v_old_deal_id, v_new_deal_id)
      and form.status in ('sent', 'viewed', 'awaiting_zk_signature', 'zk_signed', 'completed')
  ) then
    raise exception 'booking_form_snapshot_locks_deal_lines';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- A local cancellation with a Xero invoice requires service-side evidence that Xero
-- was actually voided. Authenticated users cannot write this table through RLS.
create table if not exists public.xero_void_confirmations (
  order_id uuid primary key references public.orders(id) on delete cascade,
  xero_invoice_id text not null,
  confirmed_at timestamptz not null default timezone('utc', now())
);
alter table public.xero_void_confirmations enable row level security;

create or replace function public.require_xero_void_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_xero_invoice_id text;
begin
  if new.status = 'cancelled'
    and old.status is distinct from 'cancelled'
    and new.deal_id is not null
  then
    select invoice.xero_invoice_id into v_xero_invoice_id
    from public.invoices invoice
    where invoice.order_id = new.id;
    if v_xero_invoice_id is not null then
      delete from public.xero_void_confirmations confirmation
      where confirmation.order_id = new.id
        and confirmation.xero_invoice_id = v_xero_invoice_id
        and confirmation.confirmed_at >= timezone('utc', now()) - interval '15 minutes';
      if not found then raise exception 'verified_xero_void_confirmation_required'; end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists native_order_xero_void_confirmation_trg on public.orders;
create trigger native_order_xero_void_confirmation_trg
before update of status on public.orders
for each row execute function public.require_xero_void_confirmation();

-- Reject internally inconsistent invoice lines even if a malformed snapshot reaches
-- the order conversion RPC.
create or replace function public.validate_order_line_amounts()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.quantity is null or new.quantity <= 0
    or new.unit_price is null or new.unit_price < 0
    or new.line_total is null or new.line_total < 0
    or abs(round(new.line_total, 2) - round(new.quantity * new.unit_price, 2)) > 0.01
  then
    raise exception 'invalid_order_line_amounts';
  end if;
  return new;
end;
$$;

drop trigger if exists order_line_items_amount_validation_trg on public.order_line_items;
create trigger order_line_items_amount_validation_trg
before insert or update of quantity, unit_price, line_total on public.order_line_items
for each row execute function public.validate_order_line_amounts();

-- Restrict supplier records to CMS staff; PostgreSQL combines permissive policies,
-- so the older approved-agent policies must be removed explicitly.
drop policy if exists "suppliers_approved_select" on public.suppliers;
drop policy if exists "suppliers_select_cms_staff" on public.suppliers;

drop policy if exists "invoices_update_admin" on public.invoices;
drop policy if exists "invoices_update_finance" on public.invoices;
create policy "invoices_update_finance"
  on public.invoices for update
  to authenticated
  using (public.has_cms_permission('finance.manage'))
  with check (public.has_cms_permission('finance.manage'));

-- A fulfilment's optional line must belong to the same order and package.
create or replace function public.validate_supplier_fulfilment_line()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.order_line_item_id is not null and not exists (
    select 1
    from public.order_line_items line
    where line.id = new.order_line_item_id
      and line.order_id = new.order_id
      and line.package_id = new.package_id
  ) then
    raise exception 'supplier_fulfilment_line_mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_fulfilment_line_validation_trg
  on public.order_supplier_fulfilments;
create trigger supplier_fulfilment_line_validation_trg
before insert or update of order_id, order_line_item_id, package_id
on public.order_supplier_fulfilments
for each row execute function public.validate_supplier_fulfilment_line();

drop index if exists public.order_supplier_fulfilments_line_supplier_unique_idx;
create unique index if not exists order_supplier_fulfilments_line_unique_idx
  on public.order_supplier_fulfilments (
    order_line_item_id, coalesce(supplier_id::text, '')
  )
  where order_line_item_id is not null;
create unique index if not exists order_supplier_fulfilments_package_unique_idx
  on public.order_supplier_fulfilments (
    order_id, package_id, coalesce(supplier_id::text, '')
  )
  where order_line_item_id is null;

-- Cost allocation is not evidence of supplier confirmation.
update public.order_supplier_fulfilments
set status = 'pending',
    confirmed_at = null,
    notes = 'Backfilled from cost allocation; supplier confirmation still required',
    updated_at = timezone('utc', now())
where notes = 'Backfilled from committed cost-layer allocation'
  and status = 'confirmed';

update public.order_operations operation
set supplier_status = case
      when exists (
        select 1 from public.order_supplier_fulfilments fulfilment
        where fulfilment.order_id = operation.order_id
      ) then 'pending'
      else 'unassigned'
    end,
    updated_at = timezone('utc', now())
where operation.supplier_status = 'confirmed'
  and not exists (
    select 1 from public.order_supplier_fulfilments fulfilment
    where fulfilment.order_id = operation.order_id
      and fulfilment.status in ('confirmed', 'tickets_received')
      and fulfilment.notes is distinct from
        'Backfilled from cost allocation; supplier confirmation still required'
  );

-- Synchronize inserts as well as updates, and never regress terminal operations state.
create or replace function public.sync_paid_invoice_to_operations()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_target text;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    v_target := case
      when new.status = 'delivered' then 'delivered'
      when new.status = 'paid' then 'confirmed'
      when new.status = 'cancelled' then 'cancelled'
      else 'awaiting_payment'
    end;
    insert into public.order_operations (order_id, fulfilment_status)
    values (new.order_id, v_target)
    on conflict (order_id) do update
      set fulfilment_status = case
            when public.order_operations.fulfilment_status in ('delivered', 'cancelled')
              then public.order_operations.fulfilment_status
            when excluded.fulfilment_status = 'cancelled' then 'cancelled'
            when excluded.fulfilment_status = 'delivered' then 'delivered'
            when excluded.fulfilment_status = 'confirmed'
              and public.order_operations.fulfilment_status = 'awaiting_payment'
              then 'confirmed'
            else public.order_operations.fulfilment_status
          end,
          updated_at = timezone('utc', now());
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_sync_order_operations_trg on public.invoices;
create trigger invoices_sync_order_operations_trg
after insert or update of status on public.invoices
for each row execute function public.sync_paid_invoice_to_operations();

-- The earlier paid_at backfill used issue/create time, not payment evidence.
update public.invoices
set paid_at = null
where xero_amount_paid is null
  and paid_at in (xero_synced_at, issued_at, created_at);

-- Allow the operations editor to genuinely clear owner and due dates.
create or replace function public.admin_update_order_operations(
  p_order_id uuid,
  p_fulfilment_status text default null,
  p_guest_details_status text default null,
  p_communication_status text default null,
  p_supplier_status text default null,
  p_delivery_status text default null,
  p_owner_profile_id uuid default null,
  p_guest_details_due_at timestamptz default null,
  p_supplier_due_at timestamptz default null,
  p_delivery_due_at timestamptz default null,
  p_internal_notes text default null
)
returns public.order_operations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.order_operations%rowtype;
begin
  if not public.has_cms_permission('operations.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order_not_found';
  end if;
  insert into public.order_operations (order_id)
  values (p_order_id)
  on conflict (order_id) do nothing;
  update public.order_operations
  set fulfilment_status = coalesce(p_fulfilment_status, fulfilment_status),
      guest_details_status = coalesce(p_guest_details_status, guest_details_status),
      communication_status = coalesce(p_communication_status, communication_status),
      supplier_status = coalesce(p_supplier_status, supplier_status),
      delivery_status = coalesce(p_delivery_status, delivery_status),
      owner_profile_id = p_owner_profile_id,
      guest_details_due_at = p_guest_details_due_at,
      supplier_due_at = p_supplier_due_at,
      delivery_due_at = p_delivery_due_at,
      internal_notes = case
        when p_internal_notes is null then internal_notes
        else nullif(btrim(p_internal_notes), '')
      end,
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where order_id = p_order_id
  returning * into v_row;
  insert into public.order_operation_events (
    order_id, event_type, actor_profile_id, summary, metadata
  ) values (
    p_order_id, 'workflow_updated', auth.uid(), 'Updated operations workflow',
    jsonb_build_object(
      'fulfilment_status', v_row.fulfilment_status,
      'guest_details_status', v_row.guest_details_status,
      'communication_status', v_row.communication_status,
      'supplier_status', v_row.supplier_status,
      'delivery_status', v_row.delivery_status
    )
  );
  return v_row;
end;
$$;

-- Normalize existing lead guests before enforcing one lead per order.
with ranked as (
  select id, row_number() over (
    partition by order_id order by sort_order, created_at, id
  ) as position
  from public.order_guests
  where is_lead_guest
)
update public.order_guests guest
set is_lead_guest = false, updated_at = timezone('utc', now())
from ranked
where guest.id = ranked.id and ranked.position > 1;

create unique index if not exists order_guests_one_lead_idx
  on public.order_guests(order_id)
  where is_lead_guest;

update public.order_guests
set details_complete = false, updated_at = timezone('utc', now())
where details_complete and nullif(btrim(full_name), '') is null;

alter table public.order_guests
  drop constraint if exists order_guests_complete_requires_name;
alter table public.order_guests
  add constraint order_guests_complete_requires_name
  check (not details_complete or nullif(btrim(full_name), '') is not null);

create or replace function public.admin_delete_order_guest(p_order_id uuid, p_guest_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected int;
  v_total int;
  v_complete int;
  v_deleted uuid;
begin
  if not public.has_cms_permission('operations.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select guests into v_expected from public.orders where id = p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  delete from public.order_guests
  where id = p_guest_id and order_id = p_order_id
  returning id into v_deleted;
  if v_deleted is null then raise exception 'guest_not_found'; end if;
  select count(*), count(*) filter (where details_complete)
  into v_total, v_complete
  from public.order_guests
  where order_id = p_order_id;
  update public.order_operations
  set guest_details_status = case
        when v_expected > 0 and v_total >= v_expected and v_complete >= v_expected then 'complete'
        when v_total > 0 then 'partial'
        else 'not_requested'
      end,
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where order_id = p_order_id;
  insert into public.order_operation_events (
    order_id, event_type, actor_profile_id, summary, metadata
  ) values (
    p_order_id, 'guest_deleted', auth.uid(), 'Removed guest details',
    jsonb_build_object('guest_id', p_guest_id)
  );
end;
$$;

