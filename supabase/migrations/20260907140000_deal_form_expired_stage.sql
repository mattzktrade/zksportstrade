-- Expired booking forms stay on Deals as Form Expired instead of bouncing
-- back to Enquiries (proposal / price sent).

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
      'form_expired',
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

create or replace function public.expire_due_native_booking_forms()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form record;
  v_previous text;
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

    select stage into v_previous
    from public.deals
    where id = v_form.deal_id
    for update;

    if v_previous in (
      'draft',
      'sourcing',
      'proposal',
      'awaiting_booking_form_send',
      'booking_form_sent',
      'awaiting_client_signature',
      'awaiting_zk_signature',
      'form_expired'
    ) then
      update public.deals
      set stage = 'form_expired',
          next_action = 'Booking form expired; send a new form or follow up',
          next_action_due_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
      where id = v_form.deal_id;

      if v_previous is distinct from 'form_expired' then
        insert into public.deal_activities (
          deal_id, actor_profile_id, action, summary, metadata
        ) values (
          v_form.deal_id,
          auth.uid(),
          'stage_changed',
          'Deal stage changed from ' || v_previous || ' to form_expired',
          jsonb_build_object(
            'previous_stage', v_previous,
            'stage', 'form_expired',
            'reason', 'booking_form_expired'
          )
        );
      end if;
    end if;

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
  if v_previous not in (
    'draft',
    'sourcing',
    'proposal',
    'awaiting_booking_form_send',
    'form_expired'
  ) then
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
  v_enquiry_stage text;
  v_enquiry_temperature text;
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
    where p.id = p_owner_profile_id and p.role in ('admin', 'finance', 'sales')
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
    'form_expired',
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

  if p_stage in ('closed_lost', 'cancelled', 'form_expired') and p_stage <> v_deal.stage then
    perform public.admin_release_deal_reservations(
      p_deal_id,
      case when p_stage = 'form_expired' then 'expired' else 'cancelled' end,
      case
        when p_stage = 'closed_lost' then 'Reservation released because deal was lost'
        when p_stage = 'form_expired' then 'Reservation released because booking form expired'
        else 'Reservation released because deal was cancelled'
      end
    );
  end if;

  if p_stage in ('draft', 'sourcing', 'proposal') then
    v_enquiry_stage := case
      when p_stage = 'draft' and v_deal.enquiry_stage in ('new', 'contacted', 'responded', 'not_interested')
        then v_deal.enquiry_stage
      when p_stage = 'draft' then 'new'
      when p_stage = 'sourcing' and v_deal.enquiry_stage in ('sourcing_required', 'sourcing_complete')
        then v_deal.enquiry_stage
      when p_stage = 'sourcing' then 'sourcing_required'
      when p_stage = 'proposal' and v_deal.enquiry_stage in ('price_sent', 'follow_up')
        then v_deal.enquiry_stage
      when p_stage = 'proposal' then 'price_sent'
      else v_deal.enquiry_stage
    end;
    v_enquiry_temperature := case
      when v_deal.source in ('website', 'portal', 'referral') then 'warm'
      when v_enquiry_stage in ('responded', 'sourcing_required', 'sourcing_complete') then 'warm'
      else coalesce(v_deal.enquiry_temperature, 'warm')
    end;
  else
    v_enquiry_stage := v_deal.enquiry_stage;
    v_enquiry_temperature := v_deal.enquiry_temperature;
  end if;

  update public.deals
  set stage = p_stage,
      enquiry_stage = v_enquiry_stage,
      enquiry_temperature = v_enquiry_temperature,
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
      'previous_enquiry_stage', v_deal.enquiry_stage,
      'enquiry_stage', v_enquiry_stage,
      'enquiry_temperature', v_enquiry_temperature,
      'owner_profile_id', p_owner_profile_id,
      'next_action', nullif(btrim(p_next_action), ''),
      'next_action_due_at', p_next_action_due_at,
      'expected_close_date', p_expected_close_date,
      'loss_reason', nullif(btrim(p_loss_reason), '')
    )
  );
end;
$$;

update public.deals d
set stage = 'form_expired',
    next_action = coalesce(
      nullif(btrim(d.next_action), ''),
      'Booking form expired; send a new form or follow up'
    ),
    updated_at = timezone('utc', now())
where d.stage in ('draft', 'sourcing', 'proposal')
  and exists (
    select 1
    from public.booking_forms expired
    where expired.deal_id = d.id
      and expired.status = 'expired'
  )
  and not exists (
    select 1
    from public.booking_forms live
    where live.deal_id = d.id
      and live.status in (
        'draft',
        'sent',
        'viewed',
        'awaiting_zk_signature',
        'zk_signed',
        'completed'
      )
  );
