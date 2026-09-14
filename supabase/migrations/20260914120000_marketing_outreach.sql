-- Three-stage email + WhatsApp follow-up for marketing Instant Form leads.

create table if not exists public.marketing_outreach_settings (
  sequence_key text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint marketing_outreach_settings_key_check check (btrim(sequence_key) <> '')
);

create table if not exists public.marketing_outreach_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_key text not null default 'marketing_leads',
  stage integer not null,
  delay_hours integer not null default 0,
  email_enabled boolean not null default true,
  email_subject text not null default '',
  email_body text not null default '',
  whatsapp_enabled boolean not null default true,
  whatsapp_body text not null default '',
  whatsapp_template_name text not null default '',
  whatsapp_template_language text not null default 'en',
  updated_at timestamptz not null default timezone('utc', now()),
  constraint marketing_outreach_steps_stage_check check (stage in (1, 2, 3)),
  constraint marketing_outreach_steps_delay_check check (delay_hours >= 0 and delay_hours <= 24 * 30),
  constraint marketing_outreach_steps_sequence_stage unique (sequence_key, stage)
);

create table if not exists public.marketing_outreach_enrollments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  account_id uuid references public.crm_accounts (id) on delete set null,
  contact_id uuid references public.crm_contacts (id) on delete set null,
  sequence_key text not null default 'marketing_leads',
  status text not null default 'active',
  stop_reason text,
  current_stage integer not null default 0,
  next_stage_due_at timestamptz,
  first_name text not null default '',
  full_name text not null default '',
  email text,
  phone text,
  phone_digits text,
  interest_event text,
  interest_package text,
  interest_quantity integer,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  stopped_at timestamptz,
  completed_at timestamptz,
  constraint marketing_outreach_enrollments_deal unique (deal_id),
  constraint marketing_outreach_enrollments_status_check check (status in ('active', 'stopped', 'completed')),
  constraint marketing_outreach_enrollments_stage_check check (current_stage >= 0 and current_stage <= 3)
);

create table if not exists public.marketing_outreach_sends (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.marketing_outreach_enrollments (id) on delete cascade,
  deal_id uuid not null references public.deals (id) on delete cascade,
  stage integer not null,
  channel text not null,
  status text not null,
  skip_reason text,
  provider_message_id text,
  subject text,
  body_rendered text,
  error text,
  created_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  constraint marketing_outreach_sends_stage_check check (stage in (1, 2, 3)),
  constraint marketing_outreach_sends_channel_check check (channel in ('email', 'whatsapp')),
  constraint marketing_outreach_sends_status_check check (status in ('sent', 'skipped', 'failed')),
  constraint marketing_outreach_sends_unique unique (enrollment_id, stage, channel)
);

create index if not exists marketing_outreach_enrollments_due_idx
  on public.marketing_outreach_enrollments (status, next_stage_due_at)
  where status = 'active';

create index if not exists marketing_outreach_enrollments_phone_idx
  on public.marketing_outreach_enrollments (phone_digits)
  where phone_digits is not null;

create index if not exists marketing_outreach_enrollments_email_idx
  on public.marketing_outreach_enrollments (email)
  where email is not null;

create index if not exists marketing_outreach_sends_deal_idx
  on public.marketing_outreach_sends (deal_id, created_at desc);

alter table public.marketing_outreach_settings enable row level security;
alter table public.marketing_outreach_steps enable row level security;
alter table public.marketing_outreach_enrollments enable row level security;
alter table public.marketing_outreach_sends enable row level security;

drop policy if exists "marketing_outreach_settings_staff_select" on public.marketing_outreach_settings;
create policy "marketing_outreach_settings_staff_select"
  on public.marketing_outreach_settings for select
  using (public.is_cms_staff());

drop policy if exists "marketing_outreach_settings_staff_update" on public.marketing_outreach_settings;
create policy "marketing_outreach_settings_staff_update"
  on public.marketing_outreach_settings for update
  using (public.has_cms_permission('settings.manage'))
  with check (public.has_cms_permission('settings.manage'));

drop policy if exists "marketing_outreach_steps_staff_select" on public.marketing_outreach_steps;
create policy "marketing_outreach_steps_staff_select"
  on public.marketing_outreach_steps for select
  using (public.is_cms_staff());

drop policy if exists "marketing_outreach_steps_staff_update" on public.marketing_outreach_steps;
create policy "marketing_outreach_steps_staff_update"
  on public.marketing_outreach_steps for update
  using (public.has_cms_permission('settings.manage'))
  with check (public.has_cms_permission('settings.manage'));

drop policy if exists "marketing_outreach_enrollments_staff_select" on public.marketing_outreach_enrollments;
create policy "marketing_outreach_enrollments_staff_select"
  on public.marketing_outreach_enrollments for select
  using (public.is_cms_staff());

drop policy if exists "marketing_outreach_enrollments_staff_update" on public.marketing_outreach_enrollments;
create policy "marketing_outreach_enrollments_staff_update"
  on public.marketing_outreach_enrollments for update
  using (public.has_cms_permission('deals.manage'))
  with check (public.has_cms_permission('deals.manage'));

drop policy if exists "marketing_outreach_sends_staff_select" on public.marketing_outreach_sends;
create policy "marketing_outreach_sends_staff_select"
  on public.marketing_outreach_sends for select
  using (public.is_cms_staff());

grant select on table public.marketing_outreach_settings to authenticated;
grant update on table public.marketing_outreach_settings to authenticated;
grant select, update on table public.marketing_outreach_steps to authenticated;
grant select, update on table public.marketing_outreach_enrollments to authenticated;
grant select on table public.marketing_outreach_sends to authenticated;

grant all on table public.marketing_outreach_settings to service_role;
grant all on table public.marketing_outreach_steps to service_role;
grant all on table public.marketing_outreach_enrollments to service_role;
grant all on table public.marketing_outreach_sends to service_role;

insert into public.marketing_outreach_settings (sequence_key, enabled)
values ('marketing_leads', false)
on conflict (sequence_key) do nothing;

insert into public.marketing_outreach_steps (
  sequence_key,
  stage,
  delay_hours,
  email_enabled,
  email_subject,
  email_body,
  whatsapp_enabled,
  whatsapp_body,
  whatsapp_template_name,
  whatsapp_template_language
)
values
  (
    'marketing_leads',
    1,
    0,
    true,
    'Thanks for your {{event}} enquiry',
    $msg$Hi {{first_name}},

Thanks for getting in touch about {{package}} at {{event}}. I'm from the team at ZK Sports.

Happy to check availability and send a price when you're ready — just reply to this email or on WhatsApp.$msg$,
    true,
    $msg$Hi {{first_name}}, thanks for your enquiry about {{package}} at {{event}}. I'm from ZK Sports. Happy to check availability and send a price — just reply here.$msg$,
    '',
    'en'
  ),
  (
    'marketing_leads',
    2,
    48,
    true,
    'Still here if you''d like a price for {{event}}',
    $msg$Hi {{first_name}},

Just checking you still wanted a look at {{package}} for {{event}}. If you send guest numbers or dates, I can come back with options.$msg$,
    true,
    $msg$Hi {{first_name}}, just circling back on {{package}} at {{event}}. Still happy to send a price if useful.$msg$,
    '',
    'en'
  ),
  (
    'marketing_leads',
    3,
    72,
    true,
    'I''ll leave {{event}} with you',
    $msg$Hi {{first_name}},

I'll leave this with you so I'm not chasing. If {{event}} is still of interest, reply and I'll pick it up straight away.$msg$,
    true,
    $msg$Hi {{first_name}}, last note from me on {{event}}. Reply if you'd like a price for {{package}} and I'll take it from there.$msg$,
    '',
    'en'
  )
on conflict (sequence_key, stage) do nothing;

comment on table public.marketing_outreach_settings is
  'On/off switch for the marketing lead email and WhatsApp follow-up sequence.';
comment on table public.marketing_outreach_steps is
  'Editable copy for the three marketing follow-up stages.';
comment on table public.marketing_outreach_enrollments is
  'Marketing enquiries currently in, or finished with, the automated follow-up sequence.';
comment on table public.marketing_outreach_sends is
  'One row per stage and channel (email or WhatsApp) for a marketing follow-up.';
