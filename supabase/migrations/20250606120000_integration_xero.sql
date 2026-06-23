-- Phase 2.5: Xero invoice sync (OAuth tokens in integration_settings)

alter table public.invoices
  add column if not exists xero_invoice_id text,
  add column if not exists xero_invoice_number text,
  add column if not exists xero_sync_status text not null default 'idle',
  add column if not exists xero_sync_error text,
  add column if not exists xero_synced_at timestamptz;

alter table public.invoices
  drop constraint if exists invoices_xero_sync_status_check;

alter table public.invoices
  add constraint invoices_xero_sync_status_check
  check (xero_sync_status in ('idle', 'pending', 'synced', 'failed'));

comment on column public.invoices.xero_invoice_id is 'Xero InvoiceID (GUID)';
comment on column public.invoices.xero_sync_status is 'idle | pending | synced | failed';
