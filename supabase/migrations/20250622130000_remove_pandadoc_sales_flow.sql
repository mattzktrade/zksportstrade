-- Remove the PandaDoc sales-flow gate and restore immediate Xero invoicing.

delete from public.integration_outbox
where event_type = 'pandadoc.create';

update public.invoices
set
  status = case
    when xero_invoice_id is null then 'awaiting_invoice'
    else 'awaiting_payment'
  end,
  xero_sync_status = case
    when xero_invoice_id is null then 'pending'
    else xero_sync_status
  end,
  xero_sync_error = case
    when xero_invoice_id is null then null
    else xero_sync_error
  end
where status = 'awaiting_signature';

insert into public.integration_outbox (
  event_type,
  idempotency_key,
  payload,
  status,
  attempts,
  last_error,
  processed_at
)
select
  'invoice.create',
  'invoice.create:' || o.id::text,
  jsonb_build_object('order_id', o.id::text, 'triggered_at', timezone('utc', now())),
  'pending',
  0,
  null,
  null
from public.orders o
join public.invoices i on i.order_id = o.id
where coalesce(o.channel, 'trade_portal') <> 'wix'
  and i.xero_invoice_id is null
  and not exists (
    select 1
    from public.integration_outbox existing
    where existing.idempotency_key = 'invoice.create:' || o.id::text
  );

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check
  check (status in ('awaiting_invoice', 'awaiting_payment', 'paid', 'delivered'));

drop table if exists public.order_documents cascade;
