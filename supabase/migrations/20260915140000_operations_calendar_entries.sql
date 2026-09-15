-- Staff-created operations calendar tasks (internal reminders, not booking facts).

create table if not exists public.operations_calendar_entries (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text,
  on_date date not null,
  start_time time,
  end_time time,
  deal_id uuid references public.deals (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint operations_calendar_entries_title_check check (btrim(title) <> '')
);

create index if not exists operations_calendar_entries_date_idx
  on public.operations_calendar_entries (on_date, start_time);

create index if not exists operations_calendar_entries_deal_idx
  on public.operations_calendar_entries (deal_id)
  where deal_id is not null;

alter table public.operations_calendar_entries enable row level security;

drop policy if exists "operations_calendar_entries_cms_select" on public.operations_calendar_entries;
create policy "operations_calendar_entries_cms_select"
  on public.operations_calendar_entries for select
  using (public.has_cms_permission('operations.view') or public.is_admin());

drop policy if exists "operations_calendar_entries_cms_write" on public.operations_calendar_entries;
create policy "operations_calendar_entries_cms_write"
  on public.operations_calendar_entries for all
  using (public.has_cms_permission('operations.manage') or public.is_admin())
  with check (public.has_cms_permission('operations.manage') or public.is_admin());

comment on table public.operations_calendar_entries is
  'Internal operations tasks shown on the Operations calendar. Race dates, guest deadlines and collection dates still come from bookings.';
