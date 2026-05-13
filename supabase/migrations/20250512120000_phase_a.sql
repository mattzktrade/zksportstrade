-- Phase A: profiles, catalog (races, packages, inventory), auth trigger, RLS

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  company_name text not null default '',
  role text not null default 'agent' check (role in ('agent', 'admin')),
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_approval_status_idx on public.profiles (approval_status);
create index if not exists profiles_email_idx on public.profiles (email);

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table if not exists public.races (
  id text primary key,
  name text not null,
  short_name text not null,
  location text not null,
  country text not null,
  country_code text not null,
  event_date date not null,
  date_range text not null,
  image text not null,
  season int not null default 2026
);

create table if not exists public.packages (
  id text primary key,
  race_id text not null references public.races (id) on delete cascade,
  name text not null,
  circuit text not null,
  location text not null,
  country text not null,
  country_code text not null,
  event_date date not null,
  date_range text not null,
  trade_price numeric,
  currency text not null default 'USD',
  total_capacity int not null default 0,
  is_enquiry boolean not null default false,
  image text,
  tier text not null default 'paddock',
  includes jsonb not null default '[]'::jsonb,
  featured boolean not null default false,
  sort_order int not null default 0
);

create table if not exists public.package_inventory (
  package_id text primary key references public.packages (id) on delete cascade,
  qty_available int not null default 0,
  qty_held int not null default 0,
  constraint package_inventory_non_negative check (qty_available >= 0 and qty_held >= 0),
  constraint package_inventory_held_lte_available check (qty_held <= qty_available)
);

-- ---------------------------------------------------------------------------
-- Helper: admin check (SECURITY DEFINER; runs as owner, bypasses RLS)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

grant execute on function public.is_admin() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Prevent agents from changing their own role / approval in the dashboard
-- ---------------------------------------------------------------------------
create or replace function public.profiles_lock_agent_privileges()
returns trigger
language plpgsql
as $$
begin
  if new.id = auth.uid() and not public.is_admin() then
    new.role := old.role;
    new.approval_status := old.approval_status;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_lock_agent_privileges on public.profiles;
create trigger profiles_lock_agent_privileges
  before update on public.profiles
  for each row
  execute function public.profiles_lock_agent_privileges();

-- ---------------------------------------------------------------------------
-- New user -> profile row (metadata from signup)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, company_name, role, approval_status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'company_name', ''),
    'agent',
    'pending'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep email in sync (optional but helpful for admin lists later)
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set email = new.email, updated_at = now()
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_profile_email();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.races enable row level security;
alter table public.packages enable row level security;
alter table public.package_inventory enable row level security;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
drop policy if exists "profiles_update_own_or_admin" on public.profiles;
drop policy if exists "races_select_approved" on public.races;
drop policy if exists "packages_select_approved" on public.packages;
drop policy if exists "package_inventory_select_approved" on public.package_inventory;

-- Profiles
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

create policy "profiles_update_own_or_admin"
  on public.profiles for update
  using (id = auth.uid() or public.is_admin());

-- Catalog read: approved trade partners or admins
create policy "races_select_approved"
  on public.races for select
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or exists (
        select 1 from public.profiles pr
        where pr.id = auth.uid()
          and pr.approval_status = 'approved'
      )
    )
  );

create policy "packages_select_approved"
  on public.packages for select
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or exists (
        select 1 from public.profiles pr
        where pr.id = auth.uid()
          and pr.approval_status = 'approved'
      )
    )
  );

create policy "package_inventory_select_approved"
  on public.package_inventory for select
  using (
    auth.uid() is not null
    and (
      public.is_admin()
      or exists (
        select 1 from public.profiles pr
        where pr.id = auth.uid()
          and pr.approval_status = 'approved'
      )
    )
  );

-- Service role bypasses RLS for seeds / admin API later
