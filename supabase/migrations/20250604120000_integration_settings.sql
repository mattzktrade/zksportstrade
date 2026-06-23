-- Phase 2: store Salesforce OAuth tokens (service role only; not exposed to portal agents)

create table if not exists public.integration_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.integration_settings enable row level security;

-- No policies: only service role (bypasses RLS) reads/writes from server routes.

comment on table public.integration_settings is
  'Server-only integration secrets (e.g. Salesforce refresh token). Use service role from API routes.';
