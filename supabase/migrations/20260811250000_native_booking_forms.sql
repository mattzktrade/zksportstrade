-- Phase 2B: provider-neutral native booking forms and client-first signatures.

insert into storage.buckets (id, name, public)
values ('booking-form-documents', 'booking-form-documents', false)
on conflict (id) do nothing;

create table if not exists public.booking_form_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  version int not null,
  name text not null,
  content jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint booking_form_templates_key_version_unique unique (template_key, version),
  constraint booking_form_templates_version_pos check (version > 0)
);

insert into public.booking_form_templates (
  id, template_key, version, name, content, active
) values (
  '00000000-0000-0000-0000-00000000b001',
  'zk-standard-booking-form',
  1,
  'ZK Standard Booking Form',
  jsonb_build_object(
    'renderer', 'zk-native-v1',
    'legal_content_version', '2026-08-11',
    'source', 'Current five-page ZK booking form approved for native proof of concept'
  ),
  true
)
on conflict (template_key, version) do nothing;

create table if not exists public.booking_forms (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete restrict,
  template_id uuid not null references public.booking_form_templates (id) on delete restrict,
  revision int not null default 1,
  supersedes_id uuid references public.booking_forms (id) on delete set null,
  document_ref text not null,
  provider text not null default 'native',
  provider_document_id text,
  status text not null default 'draft',
  snapshot_data jsonb not null,
  snapshot_hash text not null,
  client_name text not null,
  client_email text not null,
  client_token_hash text not null,
  client_token_expires_at timestamptz not null,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  client_signed_at timestamptz,
  zk_signed_at timestamptz,
  completed_at timestamptz,
  declined_at timestamptz,
  expired_at timestamptz,
  voided_at timestamptz,
  reminder_count int not null default 0,
  last_reminder_at timestamptz,
  last_error text,
  unsigned_pdf_bucket text not null default 'booking-form-documents',
  unsigned_pdf_path text,
  final_pdf_bucket text not null default 'booking-form-documents',
  final_pdf_path text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint booking_forms_document_ref_unique unique (document_ref),
  constraint booking_forms_token_hash_unique unique (client_token_hash),
  constraint booking_forms_deal_revision_unique unique (deal_id, revision),
  constraint booking_forms_revision_pos check (revision > 0),
  constraint booking_forms_status_check check (
    status in (
      'draft',
      'sent',
      'viewed',
      'awaiting_zk_signature',
      'zk_signed',
      'completed',
      'declined',
      'expired',
      'voided',
      'failed'
    )
  ),
  constraint booking_forms_provider_check check (provider in ('native', 'pandadoc')),
  constraint booking_forms_reminder_nonneg check (reminder_count >= 0)
);

create index if not exists booking_forms_deal_idx
  on public.booking_forms (deal_id, revision desc);
create index if not exists booking_forms_status_expiry_idx
  on public.booking_forms (status, client_token_expires_at);

create table if not exists public.booking_form_signatures (
  id uuid primary key default gen_random_uuid(),
  booking_form_id uuid not null references public.booking_forms (id) on delete restrict,
  signer_role text not null,
  signer_profile_id uuid references public.profiles (id) on delete set null,
  signer_name text not null,
  signer_email text not null,
  signature_bucket text not null default 'booking-form-documents',
  signature_path text not null,
  signature_sha256 text not null,
  evidence_hash text not null,
  consent_text text not null,
  ip_address text,
  location text,
  user_agent text,
  signed_at timestamptz not null default timezone('utc', now()),
  constraint booking_form_signatures_role_check check (
    signer_role in ('client', 'zk_admin')
  ),
  constraint booking_form_signatures_form_role_unique unique (
    booking_form_id, signer_role
  )
);

create index if not exists booking_form_signatures_form_idx
  on public.booking_form_signatures (booking_form_id, signed_at);

create table if not exists public.booking_form_events (
  id uuid primary key default gen_random_uuid(),
  booking_form_id uuid not null references public.booking_forms (id) on delete restrict,
  event_type text not null,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  actor_email text,
  ip_address text,
  location text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint booking_form_events_type_nonempty check (btrim(event_type) <> '')
);

create index if not exists booking_form_events_form_idx
  on public.booking_form_events (booking_form_id, created_at);

alter table public.booking_form_templates enable row level security;
alter table public.booking_forms enable row level security;
alter table public.booking_form_signatures enable row level security;
alter table public.booking_form_events enable row level security;

create policy "booking_form_templates_staff_select"
  on public.booking_form_templates for select
  using (public.is_cms_staff());
create policy "booking_form_templates_admin_write"
  on public.booking_form_templates for all
  using (public.has_cms_permission('settings.manage'))
  with check (public.has_cms_permission('settings.manage'));

create policy "booking_forms_staff_select"
  on public.booking_forms for select
  using (public.is_cms_staff());

create policy "booking_form_signatures_staff_select"
  on public.booking_form_signatures for select
  using (public.is_cms_staff());
create policy "booking_form_events_staff_select"
  on public.booking_form_events for select
  using (public.is_cms_staff());

create or replace function public.prevent_sent_booking_form_snapshot_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'draft' and (
    new.snapshot_data is distinct from old.snapshot_data
    or new.snapshot_hash is distinct from old.snapshot_hash
    or new.template_id is distinct from old.template_id
    or new.client_name is distinct from old.client_name
    or new.client_email is distinct from old.client_email
  ) then
    raise exception 'sent_booking_form_snapshot_is_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists booking_forms_snapshot_immutable_trg on public.booking_forms;
create trigger booking_forms_snapshot_immutable_trg
before update on public.booking_forms
for each row execute function public.prevent_sent_booking_form_snapshot_change();

create or replace function public.admin_create_native_booking_form(
  p_deal_id uuid,
  p_template_id uuid,
  p_document_ref text,
  p_snapshot_data jsonb,
  p_snapshot_hash text,
  p_client_name text,
  p_client_email text,
  p_client_token_hash text,
  p_client_token_expires_at timestamptz,
  p_unsigned_pdf_path text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form_id uuid;
  v_revision int;
  v_supersedes uuid;
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.deals where id = p_deal_id) then
    raise exception 'deal_not_found';
  end if;
  if not exists (select 1 from public.deal_line_items where deal_id = p_deal_id) then
    raise exception 'deal_line_required';
  end if;
  if not exists (
    select 1 from public.booking_form_templates
    where id = p_template_id and active = true
  ) then
    raise exception 'template_not_found';
  end if;
  if nullif(btrim(p_client_name), '') is null then raise exception 'client_name_required'; end if;
  if nullif(btrim(p_client_email), '') is null then raise exception 'client_email_required'; end if;
  if p_client_token_expires_at <= timezone('utc', now()) then
    raise exception 'token_expiry_must_be_future';
  end if;
  if exists (
    select 1 from public.booking_forms
    where deal_id = p_deal_id
      and status in ('sent', 'viewed', 'awaiting_zk_signature', 'zk_signed')
  ) then
    raise exception 'active_booking_form_exists';
  end if;

  select id, revision into v_supersedes, v_revision
  from public.booking_forms
  where deal_id = p_deal_id
  order by revision desc
  limit 1;
  v_revision := coalesce(v_revision, 0) + 1;

  insert into public.booking_forms (
    deal_id, template_id, revision, supersedes_id, document_ref, snapshot_data,
    snapshot_hash, client_name, client_email, client_token_hash,
    client_token_expires_at, unsigned_pdf_path, created_by
  ) values (
    p_deal_id, p_template_id, v_revision, v_supersedes, btrim(p_document_ref),
    p_snapshot_data, btrim(p_snapshot_hash), btrim(p_client_name),
    lower(btrim(p_client_email)), btrim(p_client_token_hash),
    p_client_token_expires_at, nullif(btrim(p_unsigned_pdf_path), ''), auth.uid()
  )
  returning id into v_form_id;

  insert into public.booking_form_events (
    booking_form_id, event_type, actor_profile_id, actor_email, metadata
  ) values (
    v_form_id,
    'created',
    auth.uid(),
    null,
    jsonb_build_object(
      'revision', v_revision,
      'snapshot_hash', p_snapshot_hash,
      'recipient_email', lower(btrim(p_client_email))
    )
  );
  return v_form_id;
end;
$$;

create or replace function public.admin_send_native_booking_form(p_booking_form_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form public.booking_forms%rowtype;
  v_unreserved_lines int;
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select * into v_form
  from public.booking_forms
  where id = p_booking_form_id
  for update;
  if not found then raise exception 'booking_form_not_found'; end if;
  if v_form.status not in ('draft', 'failed') then raise exception 'booking_form_not_sendable'; end if;
  if v_form.unsigned_pdf_path is null then raise exception 'unsigned_pdf_required'; end if;

  select count(*)::int into v_unreserved_lines
  from public.deal_line_items
  where deal_id = v_form.deal_id
    and reservation_status <> 'active';
  if v_unreserved_lines > 0 then
    perform public.admin_reserve_deal_stock(
      v_form.deal_id,
      greatest(1, ceil(extract(epoch from (v_form.client_token_expires_at - timezone('utc', now()))) / 86400)::int),
      'Stock reserved when booking form was sent'
    );
  end if;
  update public.inventory_reservations
  set expires_at = v_form.client_token_expires_at,
      updated_at = timezone('utc', now())
  where deal_id = v_form.deal_id and status = 'active';

  update public.booking_forms
  set status = 'sent',
      sent_at = coalesce(sent_at, timezone('utc', now())),
      last_error = null,
      updated_at = timezone('utc', now())
  where id = v_form.id;

  update public.deals
  set stage = 'awaiting_client_signature',
      hold_expires_at = v_form.client_token_expires_at,
      do_not_expire = false,
      next_action = 'Await client booking-form signature',
      next_action_due_at = v_form.client_token_expires_at,
      updated_at = timezone('utc', now())
  where id = v_form.deal_id;

  insert into public.booking_form_events (
    booking_form_id, event_type, actor_profile_id, actor_email, metadata
  ) values (
    v_form.id,
    'sent',
    auth.uid(),
    null,
    jsonb_build_object(
      'expires_at', v_form.client_token_expires_at,
      'recipient_email', v_form.client_email
    )
  );
end;
$$;

create or replace function public.record_native_booking_form_view(
  p_token_hash text,
  p_ip_address text default null,
  p_location text default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form public.booking_forms%rowtype;
begin
  select * into v_form
  from public.booking_forms
  where client_token_hash = btrim(p_token_hash)
  for update;
  if not found then raise exception 'booking_form_not_found'; end if;
  if v_form.status in ('expired', 'voided', 'declined') then raise exception 'booking_form_unavailable'; end if;
  if v_form.client_token_expires_at <= timezone('utc', now())
    and v_form.status in ('sent', 'viewed')
  then
    raise exception 'booking_form_expired';
  end if;

  if v_form.status = 'sent' then
    update public.booking_forms
    set status = 'viewed',
        first_viewed_at = coalesce(first_viewed_at, timezone('utc', now())),
        updated_at = timezone('utc', now())
    where id = v_form.id;
    insert into public.booking_form_events (
      booking_form_id, event_type, actor_email, ip_address, location, user_agent
    ) values (
      v_form.id, 'viewed', v_form.client_email, p_ip_address, p_location, p_user_agent
    );
  end if;
  return v_form.id;
end;
$$;

create or replace function public.record_native_client_signature(
  p_token_hash text,
  p_signer_name text,
  p_signer_email text,
  p_signature_path text,
  p_signature_sha256 text,
  p_evidence_hash text,
  p_consent_text text,
  p_ip_address text default null,
  p_location text default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form public.booking_forms%rowtype;
begin
  select * into v_form
  from public.booking_forms
  where client_token_hash = btrim(p_token_hash)
  for update;
  if not found then raise exception 'booking_form_not_found'; end if;
  if v_form.status = 'awaiting_zk_signature' then return v_form.id; end if;
  if v_form.status not in ('sent', 'viewed') then raise exception 'booking_form_not_signable'; end if;
  if v_form.client_token_expires_at <= timezone('utc', now()) then
    raise exception 'booking_form_expired';
  end if;
  if lower(btrim(p_signer_email)) <> lower(v_form.client_email) then
    raise exception 'signer_email_mismatch';
  end if;
  if nullif(btrim(p_signer_name), '') is null then raise exception 'signer_name_required'; end if;

  insert into public.booking_form_signatures (
    booking_form_id, signer_role, signer_name, signer_email, signature_path,
    signature_sha256, evidence_hash, consent_text, ip_address, location, user_agent
  ) values (
    v_form.id, 'client', btrim(p_signer_name), lower(btrim(p_signer_email)),
    btrim(p_signature_path), btrim(p_signature_sha256), btrim(p_evidence_hash),
    btrim(p_consent_text), p_ip_address, p_location, p_user_agent
  );

  update public.booking_forms
  set status = 'awaiting_zk_signature',
      client_signed_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_form.id;

  update public.deals
  set stage = 'awaiting_zk_signature',
      next_action = 'ZK admin to review and sign booking form',
      next_action_due_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_form.deal_id;

  insert into public.booking_form_events (
    booking_form_id, event_type, actor_email, ip_address, location, user_agent,
    metadata
  ) values (
    v_form.id, 'client_signed', lower(btrim(p_signer_email)), p_ip_address,
    p_location, p_user_agent, jsonb_build_object('evidence_hash', p_evidence_hash)
  );
  return v_form.id;
end;
$$;

create or replace function public.admin_record_zk_signature(
  p_booking_form_id uuid,
  p_signer_name text,
  p_signer_email text,
  p_signature_path text,
  p_signature_sha256 text,
  p_evidence_hash text,
  p_consent_text text,
  p_ip_address text default null,
  p_location text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form public.booking_forms%rowtype;
begin
  if not public.is_admin() then raise exception 'admin_signature_required'; end if;
  select * into v_form
  from public.booking_forms
  where id = p_booking_form_id
  for update;
  if not found then raise exception 'booking_form_not_found'; end if;
  if v_form.status = 'zk_signed' then return; end if;
  if v_form.status <> 'awaiting_zk_signature' then raise exception 'client_must_sign_first'; end if;

  insert into public.booking_form_signatures (
    booking_form_id, signer_role, signer_profile_id, signer_name, signer_email,
    signature_path, signature_sha256, evidence_hash, consent_text, ip_address, location,
    user_agent
  ) values (
    v_form.id, 'zk_admin', auth.uid(), btrim(p_signer_name),
    lower(btrim(p_signer_email)), btrim(p_signature_path),
    btrim(p_signature_sha256), btrim(p_evidence_hash), btrim(p_consent_text),
    p_ip_address, p_location, p_user_agent
  );

  update public.booking_forms
  set status = 'zk_signed',
      zk_signed_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_form.id;

  insert into public.booking_form_events (
    booking_form_id, event_type, actor_profile_id, actor_email, ip_address, location,
    user_agent, metadata
  ) values (
    v_form.id, 'zk_signed', auth.uid(), lower(btrim(p_signer_email)),
    p_ip_address, p_location, p_user_agent, jsonb_build_object('evidence_hash', p_evidence_hash)
  );
end;
$$;

create or replace function public.decline_native_booking_form(
  p_token_hash text,
  p_reason text default null,
  p_ip_address text default null,
  p_location text default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form public.booking_forms%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  select * into v_form
  from public.booking_forms
  where client_token_hash = btrim(p_token_hash)
  for update;
  if not found then raise exception 'booking_form_not_found'; end if;
  if v_form.status = 'declined' then return v_form.id; end if;
  if v_form.status not in ('sent', 'viewed') then raise exception 'booking_form_not_declinable'; end if;

  perform public.admin_release_deal_reservations(
    v_form.deal_id, 'cancelled', 'Booking form declined by client'
  );
  update public.booking_forms
  set status = 'declined',
      declined_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_form.id;
  update public.deals
  set stage = 'proposal',
      next_action = 'Follow up declined booking form',
      next_action_due_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_form.deal_id;
  insert into public.booking_form_events (
    booking_form_id, event_type, actor_email, ip_address, location, user_agent, metadata
  ) values (
    v_form.id, 'declined', v_form.client_email, p_ip_address, p_location, p_user_agent,
    jsonb_build_object('reason', nullif(btrim(p_reason), ''))
  );
  return v_form.id;
end;
$$;

create or replace function public.admin_finalize_native_booking_form(
  p_booking_form_id uuid,
  p_final_pdf_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form public.booking_forms%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into v_form from public.booking_forms
  where id = p_booking_form_id for update;
  if not found then raise exception 'booking_form_not_found'; end if;
  if v_form.status = 'completed' then return; end if;
  if v_form.status <> 'zk_signed' then raise exception 'both_signatures_required'; end if;

  update public.booking_forms
  set status = 'completed',
      final_pdf_path = btrim(p_final_pdf_path),
      completed_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_form.id;
  update public.deals
  set stage = 'signed',
      next_action = 'Create and send invoice',
      next_action_due_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_form.deal_id;
  insert into public.booking_form_events (
    booking_form_id, event_type, actor_profile_id, metadata
  ) values (
    v_form.id, 'completed', auth.uid(),
    jsonb_build_object('final_pdf_path', p_final_pdf_path)
  );
end;
$$;

create or replace function public.admin_void_native_booking_form(
  p_booking_form_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form public.booking_forms%rowtype;
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;
  select * into v_form from public.booking_forms
  where id = p_booking_form_id for update;
  if not found then raise exception 'booking_form_not_found'; end if;
  if v_form.status in ('completed', 'expired', 'voided', 'declined') then
    raise exception 'booking_form_not_voidable';
  end if;

  perform public.admin_release_deal_reservations(
    v_form.deal_id, 'cancelled', 'Booking form voided: ' || btrim(p_reason)
  );
  update public.booking_forms
  set status = 'voided',
      voided_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_form.id;
  update public.deals
  set stage = 'proposal',
      next_action = 'Review voided booking form',
      next_action_due_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_form.deal_id;
  insert into public.booking_form_events (
    booking_form_id, event_type, actor_profile_id, metadata
  ) values (
    v_form.id, 'voided', auth.uid(), jsonb_build_object('reason', btrim(p_reason))
  );
end;
$$;

create or replace function public.expire_due_native_booking_forms()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form record;
  v_count int := 0;
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  for v_form in
    select id, deal_id
    from public.booking_forms
    where status in ('sent', 'viewed')
      and client_token_expires_at <= timezone('utc', now())
    order by id
    for update
  loop
    perform public.admin_release_deal_reservations(
      v_form.deal_id, 'expired', 'Unsigned booking form expired after seven days'
    );
    update public.booking_forms
    set status = 'expired',
        expired_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_form.id;
    update public.deals
    set stage = 'proposal',
        next_action = 'Booking form expired; follow up with client',
        next_action_due_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_form.deal_id;
    insert into public.booking_form_events (
      booking_form_id, event_type, metadata
    ) values (
      v_form.id, 'expired', jsonb_build_object('stock_released', true)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.admin_create_native_booking_form(
  uuid, uuid, text, jsonb, text, text, text, text, timestamptz, text
) from public;
grant execute on function public.admin_create_native_booking_form(
  uuid, uuid, text, jsonb, text, text, text, text, timestamptz, text
) to authenticated;
revoke all on function public.admin_send_native_booking_form(uuid) from public;
grant execute on function public.admin_send_native_booking_form(uuid) to authenticated;
revoke all on function public.record_native_booking_form_view(text, text, text, text) from public;
grant execute on function public.record_native_booking_form_view(text, text, text, text) to service_role;
revoke all on function public.record_native_client_signature(
  text, text, text, text, text, text, text, text, text, text
) from public;
grant execute on function public.record_native_client_signature(
  text, text, text, text, text, text, text, text, text, text
) to service_role;
revoke all on function public.decline_native_booking_form(text, text, text, text, text) from public;
grant execute on function public.decline_native_booking_form(text, text, text, text, text) to service_role;
revoke all on function public.admin_record_zk_signature(
  uuid, text, text, text, text, text, text, text, text, text
) from public;
grant execute on function public.admin_record_zk_signature(
  uuid, text, text, text, text, text, text, text, text, text
) to authenticated;
revoke all on function public.admin_finalize_native_booking_form(uuid, text) from public;
grant execute on function public.admin_finalize_native_booking_form(uuid, text) to authenticated;
revoke all on function public.admin_void_native_booking_form(uuid, text) from public;
grant execute on function public.admin_void_native_booking_form(uuid, text) to authenticated;
revoke all on function public.expire_due_native_booking_forms() from public;
grant execute on function public.expire_due_native_booking_forms() to authenticated, service_role;

comment on table public.booking_forms is
  'Immutable deal snapshots and state for provider-neutral native booking forms.';
comment on table public.booking_form_signatures is
  'Signature evidence; client must sign before an approved admin.';

