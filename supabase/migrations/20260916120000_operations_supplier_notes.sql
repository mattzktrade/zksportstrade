-- Supplier-side fulfilment notes (collection / pickup details) on operations,
-- copied onto linked purchase orders so stock and ops see the same text.

alter table public.order_operations
  add column if not exists supplier_notes text;

alter table public.deal_operations
  add column if not exists supplier_notes text;

comment on column public.order_operations.supplier_notes is
  'Ops notes for tickets coming from the supplier, such as collection details. Copied onto linked purchase orders.';
comment on column public.deal_operations.supplier_notes is
  'Ops notes for tickets coming from the supplier, such as collection details. Copied onto linked purchase orders.';
