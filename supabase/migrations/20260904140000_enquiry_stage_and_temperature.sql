-- Enquiry CRM progress and warm/cold sit on deals rows without expanding
-- deals.stage. Booking forms, inventory RPCs, and the later Deals board still
-- use draft / sourcing / proposal for the early pipeline. Not interested stays
-- on Enquiries (never closed_lost).

alter table public.deals
  add column if not exists enquiry_stage text,
  add column if not exists enquiry_temperature text;

do $$
begin
  alter table public.deals
    add constraint deals_enquiry_stage_check
    check (
      enquiry_stage is null
      or enquiry_stage in (
        'new',
        'contacted',
        'responded',
        'sourcing_required',
        'sourcing_complete',
        'price_sent',
        'follow_up',
        'not_interested'
      )
    );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.deals
    add constraint deals_enquiry_temperature_check
    check (
      enquiry_temperature is null
      or enquiry_temperature in ('warm', 'cold')
    );
exception
  when duplicate_object then null;
end
$$;

comment on column public.deals.enquiry_stage is
  'CRM enquiry progress. Independent of deals.stage so booking-form and inventory RPCs keep using draft/sourcing/proposal.';
comment on column public.deals.enquiry_temperature is
  'warm = they came to us or have replied; cold = we reached out first and they have not replied yet.';

create index if not exists deals_enquiry_stage_idx
  on public.deals (enquiry_stage)
  where enquiry_stage is not null;

update public.deals
set
  enquiry_stage = case stage
    when 'draft' then 'new'
    when 'sourcing' then 'sourcing_required'
    when 'proposal' then 'price_sent'
    else enquiry_stage
  end,
  enquiry_temperature = coalesce(enquiry_temperature, 'warm')
where stage in ('draft', 'sourcing', 'proposal')
  and (enquiry_stage is null or enquiry_temperature is null);

create or replace function public.enquiry_crm_stage_label(p_stage text)
returns text
language sql
immutable
as $$
  select case p_stage
    when 'new' then 'New'
    when 'contacted' then 'Contacted'
    when 'responded' then 'Responded'
    when 'sourcing_required' then 'Sourcing required'
    when 'sourcing_complete' then 'Sourcing complete'
    when 'price_sent' then 'Price sent'
    when 'follow_up' then 'Follow-up'
    when 'not_interested' then 'Not interested'
    else coalesce(p_stage, 'New')
  end;
$$;

create or replace function public.enquiry_crm_to_deal_stage(
  p_enquiry_stage text,
  p_current_deal_stage text
)
returns text
language sql
immutable
as $$
  select case p_enquiry_stage
    when 'sourcing_required' then 'sourcing'
    when 'sourcing_complete' then 'sourcing'
    when 'price_sent' then 'proposal'
    when 'follow_up' then 'proposal'
    when 'not_interested' then
      case
        when p_current_deal_stage in ('draft', 'sourcing', 'proposal') then p_current_deal_stage
        else 'draft'
      end
    else 'draft'
  end;
$$;

create or replace function public.deals_set_enquiry_defaults()
returns trigger
language plpgsql
as $$
begin
  if NEW.stage in ('draft', 'sourcing', 'proposal') then
    if NEW.enquiry_stage is null then
      NEW.enquiry_stage := case NEW.stage
        when 'sourcing' then 'sourcing_required'
        when 'proposal' then 'price_sent'
        else 'new'
      end;
    end if;
    if NEW.enquiry_temperature is null then
      NEW.enquiry_temperature := 'warm';
    end if;
    if NEW.source in ('website', 'portal', 'referral') then
      NEW.enquiry_temperature := 'warm';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists deals_set_enquiry_defaults on public.deals;
create trigger deals_set_enquiry_defaults
before insert on public.deals
for each row
execute function public.deals_set_enquiry_defaults();

create or replace function public.admin_update_enquiry_pipeline(
  p_deal_id uuid,
  p_enquiry_stage text,
  p_enquiry_temperature text default null,
  p_owner_profile_id uuid default null,
  p_next_action text default null,
  p_next_action_due_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.deals%rowtype;
  v_stage text;
  v_temperature text;
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_deal
  from public.deals
  where id = p_deal_id
  for update;
  if not found then raise exception 'deal_not_found'; end if;

  if v_deal.stage not in ('draft', 'sourcing', 'proposal') then
    raise exception 'enquiry_already_converted';
  end if;

  if p_enquiry_stage not in (
    'new',
    'contacted',
    'responded',
    'sourcing_required',
    'sourcing_complete',
    'price_sent',
    'follow_up',
    'not_interested'
  ) then
    raise exception 'invalid_enquiry_stage:%', p_enquiry_stage;
  end if;

  if p_enquiry_temperature is not null
     and p_enquiry_temperature not in ('warm', 'cold') then
    raise exception 'invalid_enquiry_temperature:%', p_enquiry_temperature;
  end if;

  if p_owner_profile_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_owner_profile_id and p.role in ('admin', 'finance', 'sales')
  ) then
    raise exception 'owner_not_found';
  end if;

  v_stage := public.enquiry_crm_to_deal_stage(p_enquiry_stage, v_deal.stage);
  v_temperature := coalesce(p_enquiry_temperature, v_deal.enquiry_temperature, 'warm');
  if v_deal.source in ('website', 'portal', 'referral') then
    v_temperature := 'warm';
  elsif p_enquiry_stage in ('responded', 'sourcing_required', 'sourcing_complete') then
    v_temperature := 'warm';
  end if;

  update public.deals
  set stage = v_stage,
      enquiry_stage = p_enquiry_stage,
      enquiry_temperature = v_temperature,
      owner_profile_id = p_owner_profile_id,
      next_action = nullif(btrim(p_next_action), ''),
      next_action_due_at = p_next_action_due_at,
      updated_at = timezone('utc', now())
  where id = p_deal_id;

  insert into public.deal_activities (
    deal_id, actor_profile_id, action, summary, metadata
  ) values (
    p_deal_id,
    auth.uid(),
    case
      when p_enquiry_stage is distinct from v_deal.enquiry_stage then 'enquiry_stage_changed'
      else 'workflow_updated'
    end,
    case
      when p_enquiry_stage is distinct from v_deal.enquiry_stage then
        'Enquiry stage changed from '
        || public.enquiry_crm_stage_label(coalesce(v_deal.enquiry_stage, 'new'))
        || ' to '
        || public.enquiry_crm_stage_label(p_enquiry_stage)
      when v_temperature is distinct from v_deal.enquiry_temperature then
        'Enquiry marked ' || initcap(v_temperature)
      else 'Enquiry workflow details updated'
    end,
    jsonb_build_object(
      'previous_enquiry_stage', v_deal.enquiry_stage,
      'enquiry_stage', p_enquiry_stage,
      'previous_enquiry_temperature', v_deal.enquiry_temperature,
      'enquiry_temperature', v_temperature,
      'previous_stage', v_deal.stage,
      'stage', v_stage,
      'owner_profile_id', p_owner_profile_id,
      'next_action', nullif(btrim(p_next_action), ''),
      'next_action_due_at', p_next_action_due_at
    )
  );
end;
$$;

revoke all on function public.admin_update_enquiry_pipeline(
  uuid, text, text, uuid, text, timestamptz
) from public;
grant execute on function public.admin_update_enquiry_pipeline(
  uuid, text, text, uuid, text, timestamptz
) to authenticated;

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
