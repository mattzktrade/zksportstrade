-- Internal ticketing: ZK-issued digital passes, physical serials, scan audit.

insert into storage.buckets (id, name, public)
values ('ticket-files', 'ticket-files', false)
on conflict (id) do nothing;

drop policy if exists "ticket_files_no_public_read" on storage.objects;
create policy "ticket_files_no_public_read"
  on storage.objects for select
  using (bucket_id = 'ticket-files' and (public.has_cms_permission('operations.view') or public.is_admin()));

drop policy if exists "ticket_files_cms_write" on storage.objects;
create policy "ticket_files_cms_write"
  on storage.objects for all
  using (bucket_id = 'ticket-files' and (public.has_cms_permission('operations.manage') or public.is_admin()))
  with check (bucket_id = 'ticket-files' and (public.has_cms_permission('operations.manage') or public.is_admin()));

alter table public.packages
  add column if not exists ticketing_mode text not null default 'supplier_direct',
  add column if not exists ticketing_venue_name text,
  add column if not exists ticketing_doors_time text,
  add column if not exists ticketing_require_headshot boolean not null default true;

alter table public.packages
  drop constraint if exists packages_ticketing_mode_check;
alter table public.packages
  add constraint packages_ticketing_mode_check
  check (
    ticketing_mode in (
      'zk_digital',
      'physical',
      'external_digital',
      'supplier_direct',
      'hybrid'
    )
  );

comment on column public.packages.ticketing_mode is
  'How ZK fulfils tickets for this product. supplier_direct means we do not issue a ZK pass.';

alter table public.order_operations
  add column if not exists ticketing_mode text;
alter table public.deal_operations
  add column if not exists ticketing_mode text;

alter table public.order_operations
  drop constraint if exists order_operations_ticketing_mode_check;
alter table public.order_operations
  add constraint order_operations_ticketing_mode_check
  check (
    ticketing_mode is null
    or ticketing_mode in (
      'zk_digital',
      'physical',
      'external_digital',
      'supplier_direct',
      'hybrid'
    )
  );

alter table public.deal_operations
  drop constraint if exists deal_operations_ticketing_mode_check;
alter table public.deal_operations
  add constraint deal_operations_ticketing_mode_check
  check (
    ticketing_mode is null
    or ticketing_mode in (
      'zk_digital',
      'physical',
      'external_digital',
      'supplier_direct',
      'hybrid'
    )
  );

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals (id) on delete cascade,
  order_id uuid references public.orders (id) on delete cascade,
  package_id text references public.packages (id) on delete set null,
  race_id text references public.races (id) on delete set null,
  order_guest_id uuid references public.order_guests (id) on delete set null,
  deal_guest_id uuid references public.deal_guests (id) on delete set null,
  kind text not null,
  status text not null default 'issued',
  valid_days text[] not null default '{}',
  event_date date,
  venue_name text,
  public_token text not null,
  token_hash text not null,
  short_code text not null,
  signing_kid text not null default 'v1',
  physical_serial text,
  physical_location text,
  tracking_number text,
  supplier_url text,
  issued_at timestamptz,
  issued_by uuid references public.profiles (id) on delete set null,
  sent_at timestamptz,
  sent_by uuid references public.profiles (id) on delete set null,
  delivered_at timestamptz,
  arrived_at timestamptz,
  arrived_by uuid references public.profiles (id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete set null,
  voided_reason text,
  replaced_by uuid references public.tickets (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tickets_parent_check check (deal_id is not null or order_id is not null),
  constraint tickets_guest_xor_check check (
    order_guest_id is null or deal_guest_id is null
  ),
  constraint tickets_kind_check check (kind in ('zk_digital', 'physical', 'external_digital')),
  constraint tickets_status_check check (
    status in ('draft', 'issued', 'sent', 'delivered', 'arrived', 'void')
  ),
  constraint tickets_physical_location_check check (
    physical_location is null
    or physical_location in (
      'in_office',
      'packed',
      'in_transit',
      'awaiting_collection',
      'with_guest'
    )
  ),
  constraint tickets_public_token_unique unique (public_token),
  constraint tickets_token_hash_unique unique (token_hash),
  constraint tickets_short_code_unique unique (short_code)
);

create index if not exists tickets_deal_idx on public.tickets (deal_id) where deal_id is not null;
create index if not exists tickets_order_idx on public.tickets (order_id) where order_id is not null;
create index if not exists tickets_race_idx on public.tickets (race_id, event_date) where status <> 'void';
create index if not exists tickets_status_idx on public.tickets (status);

create unique index if not exists tickets_open_order_guest_uidx
  on public.tickets (order_guest_id)
  where order_guest_id is not null and status <> 'void';

create unique index if not exists tickets_open_deal_guest_uidx
  on public.tickets (deal_guest_id)
  where deal_guest_id is not null and status <> 'void';

create unique index if not exists tickets_open_serial_uidx
  on public.tickets (lower(physical_serial))
  where physical_serial is not null and btrim(physical_serial) <> '' and status <> 'void';

comment on table public.tickets is
  'One live ticket per named guest. QR is a signed pointer; this row is the source of truth.';

create table if not exists public.ticket_assets (
  ticket_id uuid primary key references public.tickets (id) on delete cascade,
  pdf_path text,
  supplier_file_path text,
  apple_serial text,
  google_object_id text,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  kind text not null,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ticket_events_ticket_idx
  on public.ticket_events (ticket_id, created_at desc);

create table if not exists public.ticket_scan_attempts (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.tickets (id) on delete set null,
  race_id text,
  payload_prefix text,
  code text not null,
  method text not null,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  offline_queued_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ticket_scan_attempts_created_idx
  on public.ticket_scan_attempts (created_at desc);

alter table public.tickets enable row level security;
alter table public.ticket_assets enable row level security;
alter table public.ticket_events enable row level security;
alter table public.ticket_scan_attempts enable row level security;

drop policy if exists "tickets_cms_select" on public.tickets;
create policy "tickets_cms_select"
  on public.tickets for select
  using (public.has_cms_permission('operations.view') or public.is_admin());

drop policy if exists "tickets_cms_write" on public.tickets;
create policy "tickets_cms_write"
  on public.tickets for all
  using (public.has_cms_permission('operations.manage') or public.is_admin())
  with check (public.has_cms_permission('operations.manage') or public.is_admin());

drop policy if exists "ticket_assets_cms_select" on public.ticket_assets;
create policy "ticket_assets_cms_select"
  on public.ticket_assets for select
  using (public.has_cms_permission('operations.view') or public.is_admin());

drop policy if exists "ticket_assets_cms_write" on public.ticket_assets;
create policy "ticket_assets_cms_write"
  on public.ticket_assets for all
  using (public.has_cms_permission('operations.manage') or public.is_admin())
  with check (public.has_cms_permission('operations.manage') or public.is_admin());

drop policy if exists "ticket_events_cms_select" on public.ticket_events;
create policy "ticket_events_cms_select"
  on public.ticket_events for select
  using (public.has_cms_permission('operations.view') or public.is_admin());

drop policy if exists "ticket_events_cms_write" on public.ticket_events;
create policy "ticket_events_cms_write"
  on public.ticket_events for insert
  with check (public.has_cms_permission('operations.manage') or public.is_admin());

drop policy if exists "ticket_scan_attempts_cms_select" on public.ticket_scan_attempts;
create policy "ticket_scan_attempts_cms_select"
  on public.ticket_scan_attempts for select
  using (public.has_cms_permission('operations.view') or public.is_admin());

drop policy if exists "ticket_scan_attempts_cms_write" on public.ticket_scan_attempts;
create policy "ticket_scan_attempts_cms_write"
  on public.ticket_scan_attempts for insert
  with check (public.has_cms_permission('operations.manage') or public.is_admin());

create or replace function public.admit_ticket(
  p_ticket_id uuid,
  p_staff_id uuid,
  p_method text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.tickets;
  existing public.tickets;
begin
  update public.tickets
     set status = 'arrived',
         arrived_at = timezone('utc', now()),
         arrived_by = p_staff_id,
         updated_at = timezone('utc', now())
   where id = p_ticket_id
     and status in ('issued', 'sent', 'delivered')
     and arrived_at is null
     and voided_at is null
  returning * into updated;

  if updated.id is not null then
    insert into public.ticket_events (ticket_id, kind, actor_profile_id, detail, metadata)
    values (
      updated.id,
      'scanned',
      p_staff_id,
      'Arrived',
      jsonb_build_object('method', coalesce(p_method, 'qr'))
    );
    return jsonb_build_object('code', 'ok', 'ticket_id', updated.id, 'arrived_at', updated.arrived_at);
  end if;

  select * into existing from public.tickets where id = p_ticket_id;
  if existing.id is null then
    return jsonb_build_object('code', 'unknown');
  end if;
  if existing.voided_at is not null or existing.status = 'void' then
    return jsonb_build_object('code', 'void', 'ticket_id', existing.id);
  end if;
  if existing.status = 'arrived' or existing.arrived_at is not null then
    return jsonb_build_object(
      'code', 'already_arrived',
      'ticket_id', existing.id,
      'arrived_at', existing.arrived_at,
      'arrived_by', existing.arrived_by
    );
  end if;
  return jsonb_build_object('code', 'not_admittable', 'ticket_id', existing.id, 'status', existing.status);
end;
$$;

revoke all on function public.admit_ticket(uuid, uuid, text) from public;
grant execute on function public.admit_ticket(uuid, uuid, text) to service_role;

alter table public.operations_emails
  drop constraint if exists operations_emails_kind_check;
alter table public.operations_emails
  add constraint operations_emails_kind_check check (
    kind in (
      'guest_details',
      'operations_intro',
      'guest_details_reminder',
      'names_sent',
      'collection_details',
      'tickets_sent',
      'tickets_ready',
      'after_event'
    )
  );

alter table public.operations_email_templates
  drop constraint if exists operations_email_templates_kind_check;
alter table public.operations_email_templates
  add constraint operations_email_templates_kind_check check (
    kind in (
      'guest_details',
      'operations_intro',
      'guest_details_reminder',
      'names_sent',
      'collection_details',
      'tickets_sent',
      'tickets_ready',
      'after_event'
    )
  );

insert into public.operations_email_templates (kind, subject, body)
values
  (
    'tickets_ready',
    'Your tickets for {{event}}',
    E'Hi {{first_name}},\n\nYour tickets for {{event}} are ready. Open the link below on your phone, check the name and day, and keep it handy for arrival.\n\n{{ticket_links_block}}\n\nIf anything looks wrong, reply to this email and I will help straight away.\n\nKind regards,\nJenny Kent\nZK Sports & Entertainment'
  )
on conflict (kind) do nothing;
