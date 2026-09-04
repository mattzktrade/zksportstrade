-- Sales-ledger bulk update: match existing deals and store spreadsheet
-- invoice / payment fields. Applying this import never creates deals and
-- must not go through admin_apply_crm_import_batch.

alter table public.crm_import_batches
  drop constraint if exists crm_import_batches_type_check;
alter table public.crm_import_batches
  add constraint crm_import_batches_type_check check (
    import_type in ('contacts', 'opportunities', 'deal_ledger')
  );

alter table public.deals
  add column if not exists ledger_invoice_number text,
  add column if not exists ledger_payment_status text;

alter table public.deals
  drop constraint if exists deals_ledger_payment_status_check;
alter table public.deals
  add constraint deals_ledger_payment_status_check check (
    ledger_payment_status is null
    or ledger_payment_status in ('paid', 'unpaid', 'cancelled')
  );

create index if not exists deals_ledger_invoice_number_idx
  on public.deals (ledger_invoice_number)
  where ledger_invoice_number is not null and btrim(ledger_invoice_number) <> '';

comment on column public.deals.ledger_invoice_number is
  'Invoice number from the internal sales ledger spreadsheet; not a Xero document number.';
comment on column public.deals.ledger_payment_status is
  'Paid / unpaid / cancelled as recorded on the internal sales ledger spreadsheet.';
