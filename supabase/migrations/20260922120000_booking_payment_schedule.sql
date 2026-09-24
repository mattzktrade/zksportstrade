-- Structured booking-form payment schedules can create one invoice per installment.
-- Existing orders stay 1:1 (installment_index = 1). Portal checkout is unchanged.

alter table public.invoices
  add column if not exists installment_index integer not null default 1,
  add column if not exists installment_count integer not null default 1,
  add column if not exists installment_percent numeric(6,2) not null default 100,
  add column if not exists installment_label text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoices_installment_index_positive'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_installment_index_positive check (installment_index >= 1);
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoices_installment_count_positive'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_installment_count_positive check (installment_count >= 1);
  end if;
end
$$;

alter table public.invoices drop constraint if exists invoices_order_id_unique;

create unique index if not exists invoices_order_id_installment_index_uidx
  on public.invoices (order_id, installment_index);

comment on column public.invoices.installment_index is
  '1-based payment number on the booking-form schedule. Portal and default deals stay at 1.';
comment on column public.invoices.installment_count is
  'Total payments on the signed booking form. 1 means the historic one-invoice path.';

create or replace function public.admin_mark_finance_paid(
  p_invoice_id uuid default null,
  p_deal_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid := p_invoice_id;
  v_deal_id uuid := p_deal_id;
  v_order_id uuid;
  v_open_count int := 0;
begin
  if not public.has_cms_permission('finance.manage')
    and not public.has_cms_permission('deals.manage')
    and not public.is_admin()
  then
    raise exception 'forbidden';
  end if;

  if v_invoice_id is not null then
    select order_id into v_order_id
    from public.invoices
    where id = v_invoice_id;
  end if;

  if v_deal_id is null and v_order_id is not null then
    select coalesce(deal_id, (select id from public.deals where order_id = v_order_id limit 1))
      into v_deal_id
    from public.orders
    where id = v_order_id;
  end if;

  if v_order_id is null and v_deal_id is not null then
    select order_id into v_order_id
    from public.deals
    where id = v_deal_id;
  end if;

  if v_invoice_id is not null then
    update public.invoices
    set
      status = 'paid',
      paid_at = coalesce(paid_at, timezone('utc', now()))
    where id = v_invoice_id
      and status is distinct from 'cancelled';
  elsif v_order_id is not null then
    update public.invoices
    set
      status = 'paid',
      paid_at = coalesce(paid_at, timezone('utc', now()))
    where order_id = v_order_id
      and status is distinct from 'cancelled';
  end if;

  if v_order_id is not null then
    select count(*) into v_open_count
    from public.invoices
    where order_id = v_order_id
      and status not in ('paid', 'delivered', 'cancelled');
  end if;

  if v_deal_id is not null and v_open_count = 0 then
    update public.deals
    set
      stage = 'paid_confirmed',
      closed_at = coalesce(closed_at, timezone('utc', now())),
      next_action = null,
      next_action_due_at = null,
      updated_at = timezone('utc', now())
    where id = v_deal_id
      and stage not in ('paid_confirmed', 'in_fulfilment', 'fulfilled', 'cancelled', 'closed_lost');
  end if;
end;
$$;
