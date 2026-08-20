-- Guest names for confirmed deals that do not yet have a native order.

create table if not exists public.deal_guests (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  full_name text,
  email text,
  phone text,
  nationality text,
  date_of_birth date,
  dietary_requirements text,
  special_requests text,
  is_lead_guest boolean not null default false,
  details_complete boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint deal_guests_complete_requires_name
    check (not details_complete or nullif(btrim(full_name), '') is not null)
);

create index if not exists deal_guests_deal_idx
  on public.deal_guests (deal_id, sort_order, created_at);

create unique index if not exists deal_guests_one_lead_idx
  on public.deal_guests (deal_id)
  where is_lead_guest;

alter table public.deal_guests enable row level security;

drop policy if exists "deal_guests_cms_select" on public.deal_guests;
create policy "deal_guests_cms_select"
  on public.deal_guests for select
  using (public.has_cms_permission('operations.view'));
