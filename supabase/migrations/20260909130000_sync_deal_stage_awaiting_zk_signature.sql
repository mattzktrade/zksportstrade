-- Keep deal.stage in step with a client-signed booking form that still needs
-- ZK's countersignature. The dashboard already counts booking_forms.status;
-- unsigned pipeline deals that drifted (or never moved) were invisible on Deals.

create or replace function public.keep_client_signed_deal_reservations()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'awaiting_zk_signature'
    and old.status in ('sent', 'viewed')
  then
    update public.inventory_reservations
    set expires_at = null,
        updated_at = timezone('utc', now()),
        note = concat_ws(E'\n', note, 'Expiry removed after client signature')
    where deal_id = new.deal_id
      and status = 'active';
    update public.deals
    set do_not_expire = true,
        hold_expires_at = null,
        stage = case
          when stage in (
            'draft',
            'sourcing',
            'proposal',
            'awaiting_booking_form_send',
            'booking_form_sent',
            'awaiting_client_signature',
            'form_expired'
          ) then 'awaiting_zk_signature'
          else stage
        end,
        next_action = case
          when stage in (
            'draft',
            'sourcing',
            'proposal',
            'awaiting_booking_form_send',
            'booking_form_sent',
            'awaiting_client_signature',
            'form_expired',
            'awaiting_zk_signature'
          ) then 'ZK admin to review and sign booking form'
          else next_action
        end,
        next_action_due_at = case
          when stage in (
            'draft',
            'sourcing',
            'proposal',
            'awaiting_booking_form_send',
            'booking_form_sent',
            'awaiting_client_signature',
            'form_expired',
            'awaiting_zk_signature'
          ) then timezone('utc', now())
          else next_action_due_at
        end,
        updated_at = timezone('utc', now())
    where id = new.deal_id;
  end if;
  return new;
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
  where id = v_form.deal_id
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

update public.deals d
set stage = 'awaiting_zk_signature',
    next_action = 'ZK admin to review and sign booking form',
    next_action_due_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
where d.stage in (
  'draft',
  'sourcing',
  'proposal',
  'awaiting_booking_form_send',
  'booking_form_sent',
  'awaiting_client_signature',
  'form_expired'
)
and exists (
  select 1
  from public.booking_forms bf
  where bf.deal_id = d.id
    and bf.status = 'awaiting_zk_signature'
);
