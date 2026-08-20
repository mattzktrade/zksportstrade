-- Track operations emails sent to clients (guest-details requests and intros).

create table if not exists public.operations_emails (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  kind text not null,
  to_email text not null,
  to_name text,
  subject text not null,
  body_text text not null,
  sent_by uuid references public.profiles (id) on delete set null,
  sent_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  constraint operations_emails_kind_check check (kind in ('guest_details', 'operations_intro')),
  constraint operations_emails_parent_check check (deal_id is not null or order_id is not null),
  constraint operations_emails_to_email_check check (btrim(to_email) <> ''),
  constraint operations_emails_subject_check check (btrim(subject) <> ''),
  constraint operations_emails_body_check check (btrim(body_text) <> '')
);

create index if not exists operations_emails_deal_idx
  on public.operations_emails (deal_id, sent_at desc);
create index if not exists operations_emails_order_idx
  on public.operations_emails (order_id, sent_at desc);

alter table public.operations_emails enable row level security;

drop policy if exists "operations_emails_cms_select" on public.operations_emails;
create policy "operations_emails_cms_select"
  on public.operations_emails for select
  using (public.has_cms_permission('operations.view'));
