-- Countersign must move the deal off "Awaiting ZK signature" in the same
-- database transaction as the ZK signature. Completion used to update the
-- deal in a later app request; if that work died after the PDF was saved,
-- the form looked completed while the deal still asked for our signature
-- and no invoice was created.

create or replace function public.advance_deal_after_zk_signature()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('zk_signed', 'completed')
    and old.status is distinct from new.status
  then
    update public.deals
    set stage = 'signed',
        next_action = 'Create and send invoice',
        next_action_due_at = timezone('utc', now()),
        do_not_expire = true,
        hold_expires_at = null,
        updated_at = timezone('utc', now())
    where id = new.deal_id
      and order_id is null
      and stage in (
        'draft',
        'sourcing',
        'proposal',
        'awaiting_booking_form_send',
        'booking_form_sent',
        'awaiting_client_signature',
        'awaiting_zk_signature',
        'form_expired'
      );
  end if;
  return new;
end;
$$;

drop trigger if exists booking_forms_advance_deal_after_zk_signature_trg on public.booking_forms;
create trigger booking_forms_advance_deal_after_zk_signature_trg
after update of status on public.booking_forms
for each row execute function public.advance_deal_after_zk_signature();

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
  if not public.is_cms_operator() then raise exception 'admin_signature_required'; end if;
  select * into v_form
  from public.booking_forms
  where id = p_booking_form_id
  for update;
  if not found then raise exception 'booking_form_not_found'; end if;
  if v_form.status = 'zk_signed' then
    update public.deals
    set stage = 'signed',
        next_action = 'Create and send invoice',
        next_action_due_at = timezone('utc', now()),
        do_not_expire = true,
        hold_expires_at = null,
        updated_at = timezone('utc', now())
    where id = v_form.deal_id
      and order_id is null
      and stage in (
        'draft',
        'sourcing',
        'proposal',
        'awaiting_booking_form_send',
        'booking_form_sent',
        'awaiting_client_signature',
        'awaiting_zk_signature',
        'form_expired'
      );
    return;
  end if;
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
  if auth.role() <> 'service_role' and not public.is_cms_operator() then
    raise exception 'forbidden';
  end if;
  select * into v_form from public.booking_forms
  where id = p_booking_form_id for update;
  if not found then raise exception 'booking_form_not_found'; end if;

  if v_form.status <> 'completed' then
    if v_form.status <> 'zk_signed' then raise exception 'both_signatures_required'; end if;
    update public.booking_forms
    set status = 'completed',
        final_pdf_path = btrim(p_final_pdf_path),
        completed_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_form.id;
    insert into public.booking_form_events (
      booking_form_id, event_type, actor_profile_id, metadata
    ) values (
      v_form.id, 'completed', auth.uid(),
      jsonb_build_object('final_pdf_path', p_final_pdf_path)
    );
  end if;

  update public.deals
  set stage = 'signed',
      next_action = 'Create and send invoice',
      next_action_due_at = timezone('utc', now()),
      do_not_expire = true,
      hold_expires_at = null,
      updated_at = timezone('utc', now())
  where id = v_form.deal_id
    and order_id is null
    and stage in (
      'draft',
      'sourcing',
      'proposal',
      'awaiting_booking_form_send',
      'booking_form_sent',
      'awaiting_client_signature',
      'awaiting_zk_signature',
      'form_expired'
    );
end;
$$;

-- Repair deals that already have both signatures but never left the
-- awaiting-ZK pipeline (so staff can create the order/invoice).
update public.deals d
set stage = 'signed',
    next_action = 'Create and send invoice',
    next_action_due_at = timezone('utc', now()),
    do_not_expire = true,
    hold_expires_at = null,
    updated_at = timezone('utc', now())
where d.order_id is null
  and d.stage in (
    'draft',
    'sourcing',
    'proposal',
    'awaiting_booking_form_send',
    'booking_form_sent',
    'awaiting_client_signature',
    'awaiting_zk_signature',
    'form_expired'
  )
  and exists (
    select 1
    from public.booking_forms bf
    where bf.deal_id = d.id
      and bf.status in ('zk_signed', 'completed')
  );

revoke all on function public.advance_deal_after_zk_signature() from public;
