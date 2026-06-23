-- Ops fulfillment: mark tickets delivered after payment.

alter table public.invoices drop constraint if exists invoices_status_check;

alter table public.invoices
  add constraint invoices_status_check
  check (status in ('awaiting_invoice', 'awaiting_payment', 'paid', 'delivered'));

comment on column public.invoices.status is
  'Workflow: awaiting_invoice (legacy), awaiting_payment, paid, delivered (tickets sent).';
