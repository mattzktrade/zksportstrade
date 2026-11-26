-- MCP Streamable HTTP server: hashed API keys, audit log, contact activity,
-- optional LinkedIn/source on contacts, and a configurable deal price floor.

-- ---------------------------------------------------------------------------
-- Contacts: fields the sales assistant needs to store
-- ---------------------------------------------------------------------------
alter table public.crm_contacts
  add column if not exists linkedin_url text;

alter table public.crm_contacts
  add column if not exists source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'crm_contacts_source_check'
  ) then
    alter table public.crm_contacts
      add constraint crm_contacts_source_check
      check (
        source is null
        or source in (
          'manual',
          'website',
          'referral',
          'marketing',
          'other',
          'whatsapp',
          'email',
          'portal',
          'assistant'
        )
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'crm_contacts_linkedin_url_https'
  ) then
    alter table public.crm_contacts
      add constraint crm_contacts_linkedin_url_https
      check (
        linkedin_url is null
        or btrim(linkedin_url) = ''
        or linkedin_url ~* '^https://'
      );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Contact activity log (email / reply / call / note)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_contact_activities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.crm_contacts (id) on delete cascade,
  activity_type text not null,
  summary text not null,
  occurred_at timestamptz not null default timezone('utc', now()),
  source text not null default 'mcp',
  mcp_api_key_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint crm_contact_activities_type_check check (
    activity_type in ('email_sent', 'reply', 'call', 'note')
  ),
  constraint crm_contact_activities_summary_nonempty check (btrim(summary) <> '')
);

create index if not exists crm_contact_activities_contact_idx
  on public.crm_contact_activities (contact_id, occurred_at desc);

alter table public.crm_contact_activities enable row level security;

drop policy if exists "crm_contact_activities_staff_select" on public.crm_contact_activities;
create policy "crm_contact_activities_staff_select"
  on public.crm_contact_activities for select
  using (public.is_cms_staff());

drop policy if exists "crm_contact_activities_staff_insert" on public.crm_contact_activities;
create policy "crm_contact_activities_staff_insert"
  on public.crm_contact_activities for insert
  with check (public.is_cms_staff());

grant select, insert on table public.crm_contact_activities to authenticated;
grant all on table public.crm_contact_activities to service_role;

-- ---------------------------------------------------------------------------
-- MCP keys (hashed), settings, audit
-- ---------------------------------------------------------------------------
create table if not exists public.mcp_api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  key_hash text not null,
  key_prefix text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  constraint mcp_api_keys_name_nonempty check (btrim(name) <> ''),
  constraint mcp_api_keys_role_check check (role in ('read_only', 'sales_agent')),
  constraint mcp_api_keys_hash_sha256 check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint mcp_api_keys_prefix_nonempty check (btrim(key_prefix) <> '')
);

create unique index if not exists mcp_api_keys_hash_unique
  on public.mcp_api_keys (key_hash);

create index if not exists mcp_api_keys_active_idx
  on public.mcp_api_keys (created_at desc)
  where revoked_at is null;

alter table public.mcp_api_keys enable row level security;

drop policy if exists "mcp_api_keys_admin_select" on public.mcp_api_keys;
create policy "mcp_api_keys_admin_select"
  on public.mcp_api_keys for select
  using (public.has_cms_permission('settings.manage'));

drop policy if exists "mcp_api_keys_admin_insert" on public.mcp_api_keys;
create policy "mcp_api_keys_admin_insert"
  on public.mcp_api_keys for insert
  with check (public.has_cms_permission('settings.manage'));

drop policy if exists "mcp_api_keys_admin_update" on public.mcp_api_keys;
create policy "mcp_api_keys_admin_update"
  on public.mcp_api_keys for update
  using (public.has_cms_permission('settings.manage'))
  with check (public.has_cms_permission('settings.manage'));

grant select, insert, update on table public.mcp_api_keys to authenticated;
grant all on table public.mcp_api_keys to service_role;

create table if not exists public.mcp_settings (
  id text primary key default 'default',
  deal_price_floor numeric not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint mcp_settings_id_check check (id = 'default'),
  constraint mcp_settings_floor_nonneg check (deal_price_floor >= 0)
);

insert into public.mcp_settings (id)
values ('default')
on conflict (id) do nothing;

alter table public.mcp_settings enable row level security;

drop policy if exists "mcp_settings_admin_select" on public.mcp_settings;
create policy "mcp_settings_admin_select"
  on public.mcp_settings for select
  using (public.has_cms_permission('settings.manage'));

drop policy if exists "mcp_settings_admin_write" on public.mcp_settings;
create policy "mcp_settings_admin_write"
  on public.mcp_settings for all
  using (public.has_cms_permission('settings.manage'))
  with check (public.has_cms_permission('settings.manage'));

grant select, insert, update on table public.mcp_settings to authenticated;
grant all on table public.mcp_settings to service_role;

create table if not exists public.mcp_audit_log (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid references public.mcp_api_keys (id) on delete set null,
  key_name text not null,
  key_role text not null,
  tool_name text not null,
  arguments jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  duration_ms integer,
  created_at timestamptz not null default timezone('utc', now()),
  constraint mcp_audit_log_tool_nonempty check (btrim(tool_name) <> ''),
  constraint mcp_audit_log_key_name_nonempty check (btrim(key_name) <> '')
);

create index if not exists mcp_audit_log_created_idx
  on public.mcp_audit_log (created_at desc);

create index if not exists mcp_audit_log_key_window_idx
  on public.mcp_audit_log (api_key_id, created_at desc);

alter table public.mcp_audit_log enable row level security;

drop policy if exists "mcp_audit_log_admin_select" on public.mcp_audit_log;
create policy "mcp_audit_log_admin_select"
  on public.mcp_audit_log for select
  using (public.has_cms_permission('settings.manage'));

grant select on table public.mcp_audit_log to authenticated;
grant all on table public.mcp_audit_log to service_role;

alter table public.crm_contact_activities
  drop constraint if exists crm_contact_activities_mcp_key_fk;

alter table public.crm_contact_activities
  add constraint crm_contact_activities_mcp_key_fk
  foreign key (mcp_api_key_id) references public.mcp_api_keys (id) on delete set null;

revoke all on table public.mcp_api_keys from anon, public;
revoke all on table public.mcp_settings from anon, public;
revoke all on table public.mcp_audit_log from anon, public;
revoke all on table public.crm_contact_activities from anon, public;
