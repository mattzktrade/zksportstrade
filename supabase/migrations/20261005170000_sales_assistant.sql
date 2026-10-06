-- CRM-native sales assistant: conversations, knowledge base, and settings.

create table if not exists public.assistant_settings (
  id text primary key default 'default',
  auto_send_enabled boolean not null default false,
  kill_switch boolean not null default false,
  allow_published_trade_prices boolean not null default false,
  notify_emails text[] not null default array['matt@zk-sports.com']::text[],
  debounce_seconds integer not null default 20,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint assistant_settings_id_check check (id = 'default'),
  constraint assistant_settings_debounce_check check (debounce_seconds >= 0 and debounce_seconds <= 120)
);

insert into public.assistant_settings (id)
values ('default')
on conflict (id) do nothing;

create table if not exists public.knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  body text not null,
  category text not null default 'general',
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint knowledge_articles_slug_unique unique (slug),
  constraint knowledge_articles_slug_check check (btrim(slug) <> ''),
  constraint knowledge_articles_title_check check (btrim(title) <> ''),
  constraint knowledge_articles_body_check check (btrim(body) <> '')
);

create table if not exists public.knowledge_examples (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.crm_accounts (id) on delete cascade,
  contact_id uuid references public.crm_contacts (id) on delete set null,
  package_id text references public.packages (id) on delete set null,
  question text not null default '',
  answer text not null,
  source text not null default 'staff_edit',
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  constraint knowledge_examples_source_check check (
    source in ('staff_edit', 'approved_qa', 'imported_thread', 'account_note')
  ),
  constraint knowledge_examples_answer_check check (btrim(answer) <> '')
);

create table if not exists public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  status text not null default 'ai_active',
  identity_status text not null default 'unknown',
  phone_digits text,
  email text,
  display_name text not null default '',
  our_number text,
  account_id uuid references public.crm_accounts (id) on delete set null,
  contact_id uuid references public.crm_contacts (id) on delete set null,
  deal_id uuid references public.deals (id) on delete set null,
  owner_profile_id uuid references public.profiles (id) on delete set null,
  run_after_at timestamptz,
  last_client_message_at timestamptz,
  last_outbound_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint assistant_conversations_channel_check check (channel in ('whatsapp', 'email', 'cms')),
  constraint assistant_conversations_status_check check (
    status in ('ai_active', 'human_takeover', 'needs_review', 'closed')
  ),
  constraint assistant_conversations_identity_check check (
    identity_status in ('unique', 'new', 'ambiguous', 'unknown')
  )
);

create unique index if not exists assistant_conversations_whatsapp_phone_idx
  on public.assistant_conversations (phone_digits)
  where channel = 'whatsapp' and phone_digits is not null;

create unique index if not exists assistant_conversations_email_idx
  on public.assistant_conversations (email)
  where channel = 'email' and email is not null;

create index if not exists assistant_conversations_status_run_idx
  on public.assistant_conversations (status, run_after_at);

create index if not exists assistant_conversations_deal_idx
  on public.assistant_conversations (deal_id)
  where deal_id is not null;

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations (id) on delete cascade,
  direction text not null,
  sent_by text not null,
  channel text not null,
  body text not null default '',
  media_type text,
  provider_message_id text,
  raw jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint assistant_messages_direction_check check (direction in ('inbound', 'outbound')),
  constraint assistant_messages_sent_by_check check (sent_by in ('client', 'ai', 'staff')),
  constraint assistant_messages_channel_check check (channel in ('whatsapp', 'email', 'cms'))
);

create unique index if not exists assistant_messages_provider_id_idx
  on public.assistant_messages (provider_message_id)
  where provider_message_id is not null;

create index if not exists assistant_messages_conversation_idx
  on public.assistant_messages (conversation_id, created_at);

create table if not exists public.assistant_runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations (id) on delete cascade,
  trigger_message_id uuid references public.assistant_messages (id) on delete set null,
  status text not null default 'completed',
  decision text not null,
  confidence numeric,
  model text,
  tool_trace jsonb not null default '[]'::jsonb,
  output_text text not null default '',
  reason text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  constraint assistant_runs_status_check check (status in ('completed', 'failed')),
  constraint assistant_runs_decision_check check (
    decision in ('sent', 'drafted', 'escalated', 'skipped', 'prepare_booking_form', 'source')
  )
);

create index if not exists assistant_runs_conversation_idx
  on public.assistant_runs (conversation_id, created_at desc);

create table if not exists public.assistant_drafts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations (id) on delete cascade,
  run_id uuid references public.assistant_runs (id) on delete set null,
  body text not null,
  status text not null default 'pending',
  intent text not null default 'answer',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint assistant_drafts_body_check check (btrim(body) <> ''),
  constraint assistant_drafts_status_check check (status in ('pending', 'sent', 'discarded'))
);

create index if not exists assistant_drafts_pending_idx
  on public.assistant_drafts (conversation_id, created_at desc)
  where status = 'pending';

insert into public.knowledge_articles (slug, title, body, category)
values (
  'sales-policy',
  'ZK sales assistant policy',
  $policy$
Use live CRM stock, product copy, and FAQs only. Never invent inclusions, itineraries, partner logos, prices, or on-ground contacts.

Pricing: do not commit a price unless it is already on this deal, or published trade prices are explicitly allowed. Discounting always needs a human.

Stock: quote sellable from the inventory availability view. If sellable is zero, say we need to check sourcing — never promise we can get it.

Booking: portal agents should book on the portal. Offline clients get a booking form prepared for an admin to send. Never send a booking form, hold stock, or raise an invoice.

Sensitive topics (cancellations, refunds, visas, “guaranteed” hospitality, guest-guide on-ground contacts) always go to a human.

Sound like ZK sales: short, warm, specific. Sign off as the person they already know when we have a style example; otherwise keep it human and brief. If unsure, say we will check and escalate.
$policy$,
  'policy'
)
on conflict (slug) do nothing;

alter table public.assistant_settings enable row level security;
alter table public.knowledge_articles enable row level security;
alter table public.knowledge_examples enable row level security;
alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_runs enable row level security;
alter table public.assistant_drafts enable row level security;

drop policy if exists "assistant_settings_staff_select" on public.assistant_settings;
create policy "assistant_settings_staff_select"
  on public.assistant_settings for select
  using (public.is_cms_staff());

drop policy if exists "assistant_settings_staff_update" on public.assistant_settings;
create policy "assistant_settings_staff_update"
  on public.assistant_settings for update
  using (public.has_cms_permission('settings.manage'))
  with check (public.has_cms_permission('settings.manage'));

drop policy if exists "knowledge_articles_staff_select" on public.knowledge_articles;
create policy "knowledge_articles_staff_select"
  on public.knowledge_articles for select
  using (public.is_cms_staff());

drop policy if exists "knowledge_articles_staff_write" on public.knowledge_articles;
create policy "knowledge_articles_staff_write"
  on public.knowledge_articles for all
  using (public.has_cms_permission('deals.manage'))
  with check (public.has_cms_permission('deals.manage'));

drop policy if exists "knowledge_examples_staff_select" on public.knowledge_examples;
create policy "knowledge_examples_staff_select"
  on public.knowledge_examples for select
  using (public.is_cms_staff());

drop policy if exists "knowledge_examples_staff_write" on public.knowledge_examples;
create policy "knowledge_examples_staff_write"
  on public.knowledge_examples for all
  using (public.has_cms_permission('deals.manage'))
  with check (public.has_cms_permission('deals.manage'));

drop policy if exists "assistant_conversations_staff_select" on public.assistant_conversations;
create policy "assistant_conversations_staff_select"
  on public.assistant_conversations for select
  using (public.is_cms_staff());

drop policy if exists "assistant_conversations_staff_write" on public.assistant_conversations;
create policy "assistant_conversations_staff_write"
  on public.assistant_conversations for all
  using (public.has_cms_permission('deals.manage'))
  with check (public.has_cms_permission('deals.manage'));

drop policy if exists "assistant_messages_staff_select" on public.assistant_messages;
create policy "assistant_messages_staff_select"
  on public.assistant_messages for select
  using (public.is_cms_staff());

drop policy if exists "assistant_messages_staff_write" on public.assistant_messages;
create policy "assistant_messages_staff_write"
  on public.assistant_messages for all
  using (public.has_cms_permission('deals.manage'))
  with check (public.has_cms_permission('deals.manage'));

drop policy if exists "assistant_runs_staff_select" on public.assistant_runs;
create policy "assistant_runs_staff_select"
  on public.assistant_runs for select
  using (public.is_cms_staff());

drop policy if exists "assistant_drafts_staff_select" on public.assistant_drafts;
create policy "assistant_drafts_staff_select"
  on public.assistant_drafts for select
  using (public.is_cms_staff());

drop policy if exists "assistant_drafts_staff_write" on public.assistant_drafts;
create policy "assistant_drafts_staff_write"
  on public.assistant_drafts for all
  using (public.has_cms_permission('deals.manage'))
  with check (public.has_cms_permission('deals.manage'));

grant select on table public.assistant_settings to authenticated;
grant update on table public.assistant_settings to authenticated;
grant select, insert, update, delete on table public.knowledge_articles to authenticated;
grant select, insert, update, delete on table public.knowledge_examples to authenticated;
grant select, insert, update, delete on table public.assistant_conversations to authenticated;
grant select, insert, update, delete on table public.assistant_messages to authenticated;
grant select on table public.assistant_runs to authenticated;
grant select, insert, update, delete on table public.assistant_drafts to authenticated;

grant all on table public.assistant_settings to service_role;
grant all on table public.knowledge_articles to service_role;
grant all on table public.knowledge_examples to service_role;
grant all on table public.assistant_conversations to service_role;
grant all on table public.assistant_messages to service_role;
grant all on table public.assistant_runs to service_role;
grant all on table public.assistant_drafts to service_role;
