-- Contract / invoice received flag on purchase orders.
-- NULL means follow attached files. true/false is a manual override.

alter table public.purchase_orders
  add column if not exists contract_invoice_received boolean;

comment on column public.purchase_orders.contract_invoice_received is
  'Whether a supplier contract/invoice is treated as received. NULL follows attached files; true/false is a manual override.';

-- Uploading a file should tick the box again, even if someone had unticked it.
create or replace function public.purchase_orders_clear_contract_invoice_override()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.purchase_orders
  set contract_invoice_received = null
  where id = new.purchase_order_id
    and contract_invoice_received is not null;
  return new;
end;
$$;

drop trigger if exists purchase_order_documents_clear_received_override_trg
  on public.purchase_order_documents;
create trigger purchase_order_documents_clear_received_override_trg
  after insert on public.purchase_order_documents
  for each row execute function public.purchase_orders_clear_contract_invoice_override();
