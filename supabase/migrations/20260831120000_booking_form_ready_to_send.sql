-- Booking forms can be prepared by sales/finance, but only an admin can send
-- them to the client. A dedicated deal stage surfaces outstanding sends.

alter table public.deals
  drop constraint if exists deals_stage_check;

alter table public.deals
  add constraint deals_stage_check check (
    stage in (
      'draft',
      'sourcing',
      'proposal',
      'awaiting_booking_form_send',
      'booking_form_sent',
      'awaiting_client_signature',
      'awaiting_zk_signature',
      'signed',
      'awaiting_invoice',
      'awaiting_payment',
      'paid_confirmed',
      'in_fulfilment',
      'fulfilled',
      'closed_lost',
      'cancelled'
    )
  );

create or replace function public.admin_update_deal_workflow(
  p_deal_id uuid,
  p_stage text,
  p_owner_profile_id uuid default null,
  p_next_action text default null,
  p_next_action_due_at timestamptz default null,
  p_expected_close_date date default null,
  p_loss_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.deals%rowtype;
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_deal
  from public.deals
  where id = p_deal_id
  for update;
  if not found then raise exception 'deal_not_found'; end if;
  if p_owner_profile_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_owner_profile_id and p.role in ('admin', 'sales')
  ) then
    raise exception 'owner_not_found';
  end if;
  if p_stage = 'closed_lost' and nullif(btrim(p_loss_reason), '') is null then
    raise exception 'loss_reason_required';
  end if;

  if p_stage not in (
    'draft',
    'sourcing',
    'proposal',
    'awaiting_booking_form_send',
    'booking_form_sent',
    'awaiting_client_signature',
    'awaiting_zk_signature',
    'signed',
    'awaiting_invoice',
    'awaiting_payment',
    'paid_confirmed',
    'in_fulfilment',
    'fulfilled',
    'closed_lost',
    'cancelled'
  ) then
    raise exception 'invalid_stage:%', p_stage;
  end if;

  if p_stage in ('closed_lost', 'cancelled') and p_stage <> v_deal.stage then
    perform public.admin_release_deal_reservations(
      p_deal_id,
      'cancelled',
      case when p_stage = 'closed_lost'
        then 'Reservation released because deal was lost'
        else 'Reservation released because deal was cancelled'
      end
    );
  end if;

  update public.deals
  set stage = p_stage,
      owner_profile_id = p_owner_profile_id,
      next_action = nullif(btrim(p_next_action), ''),
      next_action_due_at = p_next_action_due_at,
      expected_close_date = p_expected_close_date,
      loss_reason = case
        when p_stage = 'closed_lost' then nullif(btrim(p_loss_reason), '')
        when p_stage not in ('closed_lost', 'cancelled') then null
        else loss_reason end,
      closed_at = case
        when p_stage in ('paid_confirmed', 'fulfilled', 'closed_lost', 'cancelled')
          then coalesce(closed_at, timezone('utc', now()))
        when p_stage = 'draft' then null
        else closed_at end,
      updated_at = timezone('utc', now())
  where id = p_deal_id;

  insert into public.deal_activities (
    deal_id, actor_profile_id, action, summary, metadata
  ) values (
    p_deal_id,
    auth.uid(),
    case when p_stage = v_deal.stage then 'workflow_updated' else 'stage_changed' end,
    case when p_stage = v_deal.stage
      then 'Deal workflow details updated'
      else 'Deal stage changed from ' || v_deal.stage || ' to ' || p_stage
    end,
    jsonb_build_object(
      'previous_stage', v_deal.stage,
      'stage', p_stage,
      'owner_profile_id', p_owner_profile_id,
      'next_action', nullif(btrim(p_next_action), ''),
      'next_action_due_at', p_next_action_due_at,
      'expected_close_date', p_expected_close_date,
      'loss_reason', nullif(btrim(p_loss_reason), '')
    )
  );
end;
$$;

create or replace function public.prevent_sent_booking_form_snapshot_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status not in ('draft', 'failed') and (
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
      next_action = 'Approved admin to send booking form',
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

  perform public.mark_deal_awaiting_booking_form_send(p_deal_id);
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

  perform public.mark_deal_awaiting_booking_form_send(v_form.deal_id);
end;
$$;

drop function if exists public.admin_send_native_booking_form(uuid);

create function public.admin_send_native_booking_form(
  p_booking_form_id uuid,
  p_client_token_hash text default null,
  p_client_token_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form public.booking_forms%rowtype;
  v_unreserved_lines int;
  v_expires timestamptz;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select * into v_form
  from public.booking_forms
  where id = p_booking_form_id
  for update;
  if not found then raise exception 'booking_form_not_found'; end if;
  if v_form.status not in ('draft', 'failed') then raise exception 'booking_form_not_sendable'; end if;
  if v_form.unsigned_pdf_path is null then raise exception 'unsigned_pdf_required'; end if;

  v_expires := coalesce(
    p_client_token_expires_at,
    timezone('utc', now()) + interval '7 days'
  );
  if v_expires <= timezone('utc', now()) then
    raise exception 'token_expiry_must_be_future';
  end if;

  update public.booking_forms
  set client_token_hash = coalesce(nullif(btrim(p_client_token_hash), ''), client_token_hash),
      client_token_expires_at = v_expires,
      updated_at = timezone('utc', now())
  where id = v_form.id
  returning * into v_form;

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
    'Booking form ready — approved admin to send',
    jsonb_build_object('booking_form_id', v_form.id)
  );
end;
$$;

revoke all on function public.mark_deal_awaiting_booking_form_send(uuid) from public;
revoke all on function public.admin_create_native_booking_form(
  uuid, uuid, text, jsonb, text, text, text, text, timestamptz, text
) from public;
grant execute on function public.admin_create_native_booking_form(
  uuid, uuid, text, jsonb, text, text, text, text, timestamptz, text
) to authenticated;
revoke all on function public.admin_update_native_booking_form_draft(uuid, jsonb, text, text, text, text) from public;
grant execute on function public.admin_update_native_booking_form_draft(uuid, jsonb, text, text, text, text) to authenticated;
revoke all on function public.admin_send_native_booking_form(uuid, text, timestamptz) from public;
grant execute on function public.admin_send_native_booking_form(uuid, text, timestamptz) to authenticated;
revoke all on function public.admin_record_booking_form_ready_notification(uuid) from public;
grant execute on function public.admin_record_booking_form_ready_notification(uuid) to authenticated;

comment on function public.admin_create_native_booking_form(
  uuid, uuid, text, jsonb, text, text, text, text, timestamptz, text
) is
  'Sales, finance, and admin can create a draft booking form. Stock is reserved only when an admin sends it.';
comment on function public.admin_send_native_booking_form(uuid, text, timestamptz) is
  'Emails are sent in the app layer. This RPC reserves stock and marks the form sent. Admin role only.';
comment on function public.admin_update_native_booking_form_draft(uuid, jsonb, text, text, text, text) is
  'Sales, finance, and admin can amend an unsent booking form without reserving stock.';
