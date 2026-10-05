-- One-off inclusion contracts. These are signed documents for a larger purchase.
-- They never reserve stock and do not move a deal through the booking-form pipeline.

insert into storage.buckets (id, name, public)
values ('inclusion-contracts', 'inclusion-contracts', false)
on conflict (id) do nothing;

create table if not exists public.inclusion_contracts (
  id uuid primary key default gen_random_uuid(),
  document_ref text not null,
  title text not null,
  status text not null default 'draft',
  deal_id uuid references public.deals (id) on delete set null,
  account_id uuid references public.crm_accounts (id) on delete set null,
  contact_id uuid references public.crm_contacts (id) on delete set null,
  company_name text not null default '',
  client_name text not null default '',
  client_email text not null default '',
  content jsonb not null,
  content_hash text not null default '',
  client_token_hash text,
  client_signing_token text,
  client_token_expires_at timestamptz,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  voided_at timestamptz,
  signer_name text,
  signer_position text,
  signer_email text,
  unsigned_pdf_path text,
  signed_pdf_path text,
  last_error text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inclusion_contracts_ref_unique unique (document_ref),
  constraint inclusion_contracts_token_hash_unique unique (client_token_hash),
  constraint inclusion_contracts_title_nonempty check (btrim(title) <> ''),
  constraint inclusion_contracts_status_check check (
    status in ('draft', 'sent', 'viewed', 'signed', 'declined', 'voided')
  )
);

create index if not exists inclusion_contracts_updated_idx
  on public.inclusion_contracts (updated_at desc);
create index if not exists inclusion_contracts_status_idx
  on public.inclusion_contracts (status, updated_at desc);
create index if not exists inclusion_contracts_deal_idx
  on public.inclusion_contracts (deal_id)
  where deal_id is not null;

create table if not exists public.inclusion_contract_signatures (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.inclusion_contracts (id) on delete restrict,
  signer_name text not null,
  signer_position text not null,
  signer_email text not null,
  signature_path text not null,
  signature_sha256 text not null,
  evidence_hash text not null,
  consent_text text not null,
  ip_address text,
  location text,
  user_agent text,
  signed_at timestamptz not null default timezone('utc', now()),
  constraint inclusion_contract_signatures_one unique (contract_id)
);

create table if not exists public.inclusion_contract_events (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.inclusion_contracts (id) on delete cascade,
  event_type text not null,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  actor_email text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint inclusion_contract_events_type_nonempty check (btrim(event_type) <> '')
);

create index if not exists inclusion_contract_events_contract_idx
  on public.inclusion_contract_events (contract_id, created_at desc);

alter table public.inclusion_contracts enable row level security;
alter table public.inclusion_contract_signatures enable row level security;
alter table public.inclusion_contract_events enable row level security;

drop policy if exists "inclusion_contracts_staff_select" on public.inclusion_contracts;
create policy "inclusion_contracts_staff_select"
  on public.inclusion_contracts for select
  using (public.is_cms_staff());

drop policy if exists "inclusion_contracts_staff_insert" on public.inclusion_contracts;
create policy "inclusion_contracts_staff_insert"
  on public.inclusion_contracts for insert
  with check (public.has_cms_permission('deals.manage') or public.is_admin());

drop policy if exists "inclusion_contracts_staff_update" on public.inclusion_contracts;
create policy "inclusion_contracts_staff_update"
  on public.inclusion_contracts for update
  using (public.has_cms_permission('deals.manage') or public.is_admin())
  with check (public.has_cms_permission('deals.manage') or public.is_admin());

drop policy if exists "inclusion_contract_signatures_staff_select" on public.inclusion_contract_signatures;
create policy "inclusion_contract_signatures_staff_select"
  on public.inclusion_contract_signatures for select
  using (public.is_cms_staff());

drop policy if exists "inclusion_contract_events_staff_select" on public.inclusion_contract_events;
create policy "inclusion_contract_events_staff_select"
  on public.inclusion_contract_events for select
  using (public.is_cms_staff());
