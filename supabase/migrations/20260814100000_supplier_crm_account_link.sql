-- Link suppliers to CRM accounts so a company can be both a customer and a supplier.
-- Do not backfill by name — existing purchase orders stay as typed text until
-- an admin reassigns them to a real company from the CRM.

alter table public.suppliers
  add column if not exists crm_account_id uuid references public.crm_accounts (id) on delete set null;

create unique index if not exists suppliers_crm_account_id_unique_idx
  on public.suppliers (crm_account_id)
  where crm_account_id is not null;

create index if not exists suppliers_crm_account_id_idx
  on public.suppliers (crm_account_id)
  where crm_account_id is not null;
