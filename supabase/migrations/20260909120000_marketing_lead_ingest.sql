-- Marketing Instant Form leads: signed webhook ingest into Enquiries (native deals).

alter table public.deals
  drop constraint if exists deals_source_check;

alter table public.deals
  add constraint deals_source_check
  check (source in ('offline', 'portal', 'website', 'referral', 'other', 'marketing'));

do $$
declare
  r record;
  def text;
  needle text := '''offline'', ''portal'', ''website'', ''referral'', ''other''';
  repl text := '''offline'', ''portal'', ''website'', ''referral'', ''other'', ''marketing''';
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname like 'admin_%'
  loop
    begin
      def := pg_get_functiondef(r.oid);
    exception
      when others then
        continue;
    end;
    if position(repl in def) > 0 then
      continue;
    end if;
    if position(needle in def) = 0 then
      continue;
    end if;
    execute replace(def, needle, repl);
  end loop;
end $$;

create table if not exists public.marketing_lead_ingest (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received',
  deal_id uuid references public.deals (id) on delete set null,
  account_id uuid references public.crm_accounts (id) on delete set null,
  contact_id uuid references public.crm_contacts (id) on delete set null,
  error text,
  created_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  constraint marketing_lead_ingest_lead_id_nonempty check (btrim(lead_id) <> ''),
  constraint marketing_lead_ingest_status_check check (status in ('received', 'processed', 'failed')),
  constraint marketing_lead_ingest_lead_id_unique unique (lead_id)
);

create index if not exists marketing_lead_ingest_created_idx
  on public.marketing_lead_ingest (created_at desc);

create table if not exists public.marketing_package_aliases (
  alias_normalized text primary key,
  alias_label text not null,
  package_id text not null references public.packages (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  constraint marketing_package_aliases_alias_nonempty check (btrim(alias_normalized) <> ''),
  constraint marketing_package_aliases_label_nonempty check (btrim(alias_label) <> '')
);

create index if not exists marketing_package_aliases_package_idx
  on public.marketing_package_aliases (package_id);

alter table public.marketing_lead_ingest enable row level security;
alter table public.marketing_package_aliases enable row level security;

drop policy if exists "marketing_lead_ingest_staff_select" on public.marketing_lead_ingest;
create policy "marketing_lead_ingest_staff_select"
  on public.marketing_lead_ingest for select
  using (public.is_cms_staff());

drop policy if exists "marketing_package_aliases_staff_all" on public.marketing_package_aliases;
create policy "marketing_package_aliases_staff_all"
  on public.marketing_package_aliases for all
  using (public.is_cms_staff())
  with check (public.is_cms_staff());

grant select on table public.marketing_lead_ingest to authenticated;
grant all on table public.marketing_package_aliases to authenticated;
grant all on table public.marketing_lead_ingest to service_role;
grant all on table public.marketing_package_aliases to service_role;

comment on table public.marketing_lead_ingest is
  'Idempotent log of Meta / agency marketing leads posted to /api/webhooks/marketing-lead.';
comment on table public.marketing_package_aliases is
  'Optional Instant Form package labels mapped onto catalog products.';
