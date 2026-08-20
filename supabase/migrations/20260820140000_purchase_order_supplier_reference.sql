-- Internal PO number stays on purchase_orders.po_number.
-- Supplier contract / invoice / order numbers live on supplier_reference.

alter table public.purchase_orders
  add column if not exists supplier_reference text;

comment on column public.purchase_orders.po_number is
  'Internal ZK purchase-order reference.';

comment on column public.purchase_orders.supplier_reference is
  'Supplier contract, invoice, or order number(s). Separate from the internal PO number.';

create index if not exists purchase_orders_supplier_reference_idx
  on public.purchase_orders (lower(btrim(supplier_reference)))
  where btrim(coalesce(supplier_reference, '')) <> '';

-- Existing imports stored the supplier invoice as po_number. Copy those into
-- the new column so the list can show contract/invoice separately. Leave
-- generated internal PO-* / IMP-* numbers alone.
update public.purchase_orders
set supplier_reference = btrim(po_number)
where coalesce(btrim(supplier_reference), '') = ''
  and btrim(po_number) <> ''
  and po_number !~ '^(PO-[0-9]{8}-|IMP-)';
