-- Supplier payment tracking on purchase orders.
-- Payment due: when the supplier invoice needs to be paid.
-- Paid on: the date we paid it. Null means still unpaid.

alter table public.purchase_orders
  add column if not exists payment_due_date date;

alter table public.purchase_orders
  add column if not exists paid_at date;

comment on column public.purchase_orders.payment_due_date is
  'Date the supplier invoice is due to be paid.';

comment on column public.purchase_orders.paid_at is
  'Date we paid the supplier. Null means the purchase order is still unpaid.';
