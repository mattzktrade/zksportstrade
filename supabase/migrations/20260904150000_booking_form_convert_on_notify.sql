-- Saving a booking form draft must stay on Enquiries. The row only moves to
-- Deals (awaiting_booking_form_send) when sales send it for approval, or when
-- an admin sends it to the client (that path sets awaiting_client_signature).

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
  if not public.is_cms_staff() then
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
      and status in ('draft', 'failed', 'sent', 'viewed', 'awaiting_zk_signature', 'zk_signed')
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

create or replace function public.admin_update_native_booking_form_draft(
  p_booking_form_id uuid,
  p_snapshot_data jsonb,
  p_snapshot_hash text,
  p_client_name text,
  p_client_email text,
  p_unsigned_pdf_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form public.booking_forms%rowtype;
begin
  if not public.is_cms_staff() then
    raise exception 'forbidden';
  end if;
  if nullif(btrim(p_client_name), '') is null then raise exception 'client_name_required'; end if;
  if nullif(btrim(p_client_email), '') is null then raise exception 'client_email_required'; end if;

  select * into v_form
  from public.booking_forms
  where id = p_booking_form_id
  for update;
  if not found then raise exception 'booking_form_not_found'; end if;
  if v_form.status not in ('draft', 'failed') then
    raise exception 'booking_form_not_editable_draft';
  end if;

  update public.booking_forms
  set status = 'draft',
      snapshot_data = p_snapshot_data,
      snapshot_hash = btrim(p_snapshot_hash),
      client_name = btrim(p_client_name),
      client_email = lower(btrim(p_client_email)),
      unsigned_pdf_path = nullif(btrim(p_unsigned_pdf_path), ''),
      last_error = null,
      updated_at = timezone('utc', now())
  where id = v_form.id;

  insert into public.booking_form_events (
    booking_form_id, event_type, actor_profile_id, metadata
  ) values (
    v_form.id,
    'draft_updated',
    auth.uid(),
    jsonb_build_object(
      'snapshot_hash', p_snapshot_hash,
      'recipient_email', lower(btrim(p_client_email))
    )
  );
end;
$$;

create or replace function public.mark_deal_awaiting_booking_form_send(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous text;
begin
  select stage into v_previous
  from public.deals
  where id = p_deal_id
  for update;
  if not found then
    return;
  end if;
  if v_previous not in ('draft', 'sourcing', 'proposal', 'awaiting_booking_form_send') then
    return;
  end if;

  update public.deals
  set stage = 'awaiting_booking_form_send',
      next_action = 'Sent for approval to Ollie and Michel',
      next_action_due_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_deal_id;

  if v_previous <> 'awaiting_booking_form_send' then
    insert into public.deal_activities (
      deal_id, actor_profile_id, action, summary, metadata
    ) values (
      p_deal_id,
      auth.uid(),
      'stage_changed',
      'Deal stage changed from ' || v_previous || ' to awaiting_booking_form_send',
      jsonb_build_object(
        'previous_stage', v_previous,
        'stage', 'awaiting_booking_form_send'
      )
    );
  end if;
end;
$$;

create or replace function public.admin_record_booking_form_ready_notification(
  p_booking_form_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form public.booking_forms%rowtype;
begin
  if not public.is_cms_staff() then
    raise exception 'forbidden';
  end if;
  select * into v_form
  from public.booking_forms
  where id = p_booking_form_id
  for update;
  if not found then raise exception 'booking_form_not_found'; end if;
  if v_form.status not in ('draft', 'failed') then
    raise exception 'booking_form_not_ready_to_notify';
  end if;

  insert into public.booking_form_events (
    booking_form_id, event_type, actor_profile_id, metadata
  ) values (
    v_form.id,
    'ready_notified',
    auth.uid(),
    jsonb_build_object('deal_id', v_form.deal_id)
  );

  perform public.mark_deal_awaiting_booking_form_send(v_form.deal_id);

  insert into public.deal_activities (
    deal_id, actor_profile_id, action, summary, metadata
  ) values (
    v_form.deal_id,
    auth.uid(),
    'booking_form_ready_notified',
    'Booking form sent for approval to Ollie and Michel',
    jsonb_build_object('booking_form_id', v_form.id)
  );
end;
$$;
