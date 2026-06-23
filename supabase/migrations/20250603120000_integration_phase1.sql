-- Phase 1: Integration plumbing (Salesforce, Wix, partner API — sync workers in later phases)

-- ---------------------------------------------------------------------------
-- Packages: cross-channel IDs and sync state
-- ---------------------------------------------------------------------------
alter table public.packages
  add column if not exists product_code text,
  add column if not exists salesforce_product_id text,
  add column if not exists retail_price_multiplier numeric,
  add column if not exists sell_on_trade_portal boolean not null default true,
  add column if not exists sell_on_wix boolean not null default false,
  add column if not exists sell_on_partners boolean not null default false,
  add column if not exists integration_sync_status text not null default 'idle',
  add column if not exists integration_synced_at timestamptz,
  add column if not exists integration_sync_error text;

alter table public.packages
  drop constraint if exists packages_integration_sync_status_check;

alter table public.packages
  add constraint packages_integration_sync_status_check
  check (integration_sync_status in ('idle', 'pending', 'synced', 'failed'));

alter table public.packages
  drop constraint if exists packages_retail_price_multiplier_check;

alter table public.packages
  add constraint packages_retail_price_multiplier_check
  check (retail_price_multiplier is null or retail_price_multiplier > 0);

create unique index if not exists packages_product_code_unique_idx
  on public.packages (product_code)
  where product_code is not null and btrim(product_code) <> '';

-- ---------------------------------------------------------------------------
-- Orders: channel + Salesforce sync metadata
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists channel text not null default 'trade_portal',
  add column if not exists external_order_id text,
  add column if not exists salesforce_opportunity_id text,
  add column if not exists salesforce_quote_id text,
  add column if not exists salesforce_sync_status text not null default 'pending',
  add column if not exists salesforce_synced_at timestamptz,
  add column if not exists salesforce_sync_error text;

alter table public.orders
  drop constraint if exists orders_channel_check;

alter table public.orders
  add constraint orders_channel_check
  check (channel in ('trade_portal', 'wix', 'partner_api', 'admin'));

alter table public.orders
  drop constraint if exists orders_salesforce_sync_status_check;

alter table public.orders
  add constraint orders_salesforce_sync_status_check
  check (salesforce_sync_status in ('pending', 'synced', 'failed', 'skipped'));

create unique index if not exists orders_external_order_id_unique_idx
  on public.orders (external_order_id)
  where external_order_id is not null and btrim(external_order_id) <> '';

create index if not exists orders_salesforce_sync_status_idx
  on public.orders (salesforce_sync_status);

-- ---------------------------------------------------------------------------
-- Outbox for async integrations (SF, Wix, etc.)
-- ---------------------------------------------------------------------------
create table if not exists public.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint integration_outbox_idempotency_key_unique unique (idempotency_key),
  constraint integration_outbox_status_check
    check (status in ('pending', 'processing', 'completed', 'failed'))
);

create index if not exists integration_outbox_status_created_idx
  on public.integration_outbox (status, created_at);

create index if not exists integration_outbox_event_type_idx
  on public.integration_outbox (event_type);

-- ---------------------------------------------------------------------------
-- Per-channel external listing IDs (e.g. multiple Wix lines per package)
-- ---------------------------------------------------------------------------
create table if not exists public.channel_listings (
  id uuid primary key default gen_random_uuid(),
  package_id text not null references public.packages (id) on delete cascade,
  channel text not null,
  external_id text not null,
  external_variant_id text,
  page_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_listings_channel_check
    check (channel in ('wix', 'salesforce')),
  constraint channel_listings_package_channel_external_unique
    unique (package_id, channel, external_id)
);

create index if not exists channel_listings_package_id_idx
  on public.channel_listings (package_id);

-- ---------------------------------------------------------------------------
-- Partner API (Phase 5 — tables only for now)
-- ---------------------------------------------------------------------------
create table if not exists public.partner_api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_prefix text not null,
  key_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint partner_api_keys_key_prefix_unique unique (key_prefix)
);

create table if not exists public.partner_package_allowlist (
  partner_id uuid not null references public.partner_api_keys (id) on delete cascade,
  package_id text not null references public.packages (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (partner_id, package_id)
);

-- ---------------------------------------------------------------------------
-- Enqueue helper (admin server actions)
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_integration_event(
  p_event_type text,
  p_idempotency_key text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_package_id text;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if p_event_type is null or btrim(p_event_type) = '' then
    raise exception 'event_type is required';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key is required';
  end if;

  insert into public.integration_outbox (event_type, idempotency_key, payload)
  values (btrim(p_event_type), btrim(p_idempotency_key), coalesce(p_payload, '{}'::jsonb))
  on conflict (idempotency_key) do update set
    payload = excluded.payload,
    status = 'pending',
    attempts = 0,
    last_error = null,
    processed_at = null,
    created_at = now()
  returning id into v_id;

  v_package_id := nullif(btrim(p_payload->>'package_id'), '');
  if v_package_id is not null then
    update public.packages
    set
      integration_sync_status = 'pending',
      integration_sync_error = null
    where id = v_package_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.enqueue_integration_event(text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.integration_outbox enable row level security;
alter table public.channel_listings enable row level security;
alter table public.partner_api_keys enable row level security;
alter table public.partner_package_allowlist enable row level security;

drop policy if exists "integration_outbox_admin_select" on public.integration_outbox;
create policy "integration_outbox_admin_select"
  on public.integration_outbox for select
  using (public.is_admin());

drop policy if exists "integration_outbox_admin_insert" on public.integration_outbox;
create policy "integration_outbox_admin_insert"
  on public.integration_outbox for insert
  with check (public.is_admin());

drop policy if exists "channel_listings_admin_all" on public.channel_listings;
create policy "channel_listings_admin_all"
  on public.channel_listings for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "partner_api_keys_admin_all" on public.partner_api_keys;
create policy "partner_api_keys_admin_all"
  on public.partner_api_keys for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "partner_package_allowlist_admin_all" on public.partner_package_allowlist;
create policy "partner_package_allowlist_admin_all"
  on public.partner_package_allowlist for all
  using (public.is_admin())
  with check (public.is_admin());
