-- Finance staff (e.g. Chelley) can own deals, run operations, and use the rest of
-- CMS the same way as admin, except Settings / team logins / integrations.
-- Sending a booking form to the client remains admin-only.

create or replace function public.has_cms_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'admin'
        or (
          p.role = 'finance'
          and p_permission in (
            'cms.access',
            'inventory.view',
            'inventory.manage',
            'inventory.purchase',
            'inventory.adjust',
            'inventory.archive',
            'inventory.hold',
            'pricing.manage',
            'deals.view',
            'deals.manage',
            'accounts.manage',
            'orders.view',
            'operations.view',
            'operations.manage',
            'finance.view',
            'finance.manage'
          )
        )
        or (
          p.role = 'sales'
          and p_permission in (
            'cms.access',
            'deals.view',
            'deals.manage',
            'accounts.manage',
            'inventory.view',
            'inventory.hold',
            'orders.view',
            'operations.view',
            'operations.manage'
          )
        )
      )
  );
$$;

grant execute on function public.has_cms_permission(text) to authenticated, anon;

comment on function public.has_cms_permission(text) is
  'Finance matches admin for day-to-day CMS work. Settings, team logins, integrations, and sending booking forms stay admin-only.';

-- Owner dropdowns need CMS staff to read other staff profiles.
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (
    id = auth.uid()
    or public.is_admin()
    or (
      public.is_cms_staff()
      and role in ('admin', 'finance', 'sales')
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

create or replace function public.admin_update_crm_lead_workflow(
  p_lead_id uuid,
  p_status text,
  p_next_action text default null,
  p_next_action_due_at timestamptz default null,
  p_owner_profile_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.crm_leads%rowtype;
begin
  if not public.has_cms_permission('accounts.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_before
  from public.crm_leads
  where id = p_lead_id
  for update;

  if not found then raise exception 'lead_not_found'; end if;
  if v_before.status = 'converted' then raise exception 'lead_already_converted'; end if;
  if p_status not in ('new', 'contacted', 'price_sent', 'unqualified', 'closed') then
    raise exception 'invalid_lead_status';
  end if;
  if p_owner_profile_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_owner_profile_id and p.role in ('admin', 'finance', 'sales')
  ) then
    raise exception 'owner_not_found';
  end if;

  update public.crm_leads
  set status = p_status,
      next_action = nullif(btrim(p_next_action), ''),
      next_action_due_at = p_next_action_due_at,
      owner_profile_id = p_owner_profile_id,
      updated_at = timezone('utc', now())
  where id = p_lead_id;

  insert into public.crm_lead_activities (
    lead_id, actor_profile_id, action, summary, metadata
  ) values (
    p_lead_id,
    auth.uid(),
    'workflow_updated',
    'Lead workflow updated',
    jsonb_build_object(
      'previous_status', v_before.status,
      'status', p_status,
      'next_action', nullif(btrim(p_next_action), ''),
      'owner_profile_id', p_owner_profile_id
    )
  );
end;
$$;

revoke all on function public.admin_update_deal_workflow(
  uuid, text, uuid, text, timestamptz, date, text
) from public;
grant execute on function public.admin_update_deal_workflow(
  uuid, text, uuid, text, timestamptz, date, text
) to authenticated;

revoke all on function public.admin_update_crm_lead_workflow(
  uuid, text, text, timestamptz, uuid
) from public;
grant execute on function public.admin_update_crm_lead_workflow(
  uuid, text, text, timestamptz, uuid
) to authenticated;
