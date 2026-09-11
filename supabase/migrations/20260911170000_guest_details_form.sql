-- Public guest-details form: tokenised client link, per-day attendance,
-- and private headshot storage. Names/photos written here flow into
-- operations and the product guest list.

insert into storage.buckets (id, name, public)
values ('guest-headshots', 'guest-headshots', false)
on conflict (id) do nothing;

alter table public.order_guests
  add column if not exists attendance_day text,
  add column if not exists headshot_path text;

alter table public.deal_guests
  add column if not exists attendance_day text,
  add column if not exists headshot_path text;

alter table public.order_guests
  drop constraint if exists order_guests_attendance_day_check;
alter table public.order_guests
  add constraint order_guests_attendance_day_check
  check (
    attendance_day is null
    or attendance_day in ('thursday_only', 'friday_only', 'saturday_only', 'sunday_only')
  );

alter table public.deal_guests
  drop constraint if exists deal_guests_attendance_day_check;
alter table public.deal_guests
  add constraint deal_guests_attendance_day_check
  check (
    attendance_day is null
    or attendance_day in ('thursday_only', 'friday_only', 'saturday_only', 'sunday_only')
  );

comment on column public.order_guests.attendance_day is
  'Null means this guest attends every day on the booking. A day slot means they attend that day only.';
comment on column public.deal_guests.attendance_day is
  'Null means this guest attends every day on the booking. A day slot means they attend that day only.';
comment on column public.order_guests.headshot_path is
  'Private storage path in the guest-headshots bucket.';
comment on column public.deal_guests.headshot_path is
  'Private storage path in the guest-headshots bucket.';

alter table public.order_operations
  add column if not exists guest_attendance_mode text not null default 'same';
alter table public.deal_operations
  add column if not exists guest_attendance_mode text not null default 'same';

alter table public.order_operations
  drop constraint if exists order_operations_guest_attendance_mode_check;
alter table public.order_operations
  add constraint order_operations_guest_attendance_mode_check
  check (guest_attendance_mode in ('same', 'per_day'));

alter table public.deal_operations
  drop constraint if exists deal_operations_guest_attendance_mode_check;
alter table public.deal_operations
  add constraint deal_operations_guest_attendance_mode_check
  check (guest_attendance_mode in ('same', 'per_day'));

create table if not exists public.guest_details_invites (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals (id) on delete cascade,
  order_id uuid references public.orders (id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  attendance_mode text not null default 'same',
  status text not null default 'open',
  submitted_at timestamptz,
  last_saved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint guest_details_invites_parent_check
    check (deal_id is not null or order_id is not null),
  constraint guest_details_invites_token_hash_unique unique (token_hash),
  constraint guest_details_invites_attendance_mode_check
    check (attendance_mode in ('same', 'per_day')),
  constraint guest_details_invites_status_check
    check (status in ('open', 'submitted'))
);

create unique index if not exists guest_details_invites_deal_uidx
  on public.guest_details_invites (deal_id)
  where deal_id is not null;

create unique index if not exists guest_details_invites_order_only_uidx
  on public.guest_details_invites (order_id)
  where order_id is not null and deal_id is null;

create index if not exists guest_details_invites_order_idx
  on public.guest_details_invites (order_id);

alter table public.guest_details_invites enable row level security;

drop policy if exists "guest_details_invites_cms_select" on public.guest_details_invites;
create policy "guest_details_invites_cms_select"
  on public.guest_details_invites for select
  using (public.has_cms_permission('operations.view'));

comment on table public.guest_details_invites is
  'Hashed public tokens for the client guest-details form sent from operations email.';
