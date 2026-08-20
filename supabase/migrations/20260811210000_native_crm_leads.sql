-- Phase 2A: native lead capture, ownership and atomic conversion to a deal.

create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  account_id uuid not null references public.crm_accounts (id) on delete restrict,
  contact_id uuid references public.crm_contacts (id) on delete set null,
  owner_profile_id uuid references public.profiles (id) on delete set null,
  race_id text references public.races (id) on delete set null,
  package_id text references public.packages (id) on delete set null,
  quantity int not null default 1,
  status text not null default 'new',
  source text not null default 'manual',
  interest text,
  estimated_value numeric,
  currency text not null default 'USD',
  next_action text,
  next_action_due_at timestamptz,
  notes text,
  converted_deal_id uuid references public.deals (id) on delete set null,
  converted_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint crm_leads_reference_unique unique (reference),
  constraint crm_leads_status_check check (
    status in ('new', 'contacted', 'price_sent', 'converted', 'unqualified', 'closed')
  ),
  constraint crm_leads_source_check check (
    source in ('manual', 'website', 'portal', 'referral', 'marketing', 'repeat_client', 'other')
  ),
  constraint crm_leads_estimated_value_nonneg check (
    estimated_value is null or estimated_value >= 0
  ),
  constraint crm_leads_quantity_pos check (quantity > 0)
);

create index if not exists crm_leads_status_idx
  on public.crm_leads (status, updated_at desc);
create index if not exists crm_leads_owner_idx
  on public.crm_leads (owner_profile_id, status);
create index if not exists crm_leads_account_idx
  on public.crm_leads (account_id, updated_at desc);

alter table public.crm_leads enable row level security;

drop policy if exists "crm_leads_staff_all" on public.crm_leads;
create policy "crm_leads_staff_all"
  on public.crm_leads for all
  using (public.is_cms_staff())
  with check (public.is_cms_staff());

create table if not exists public.crm_lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.crm_leads (id) on delete cascade,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  action text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint crm_lead_activities_action_nonempty check (btrim(action) <> ''),
  constraint crm_lead_activities_summary_nonempty check (btrim(summary) <> '')
);

create index if not exists crm_lead_activities_lead_idx
  on public.crm_lead_activities (lead_id, created_at desc);

alter table public.crm_lead_activities enable row level security;

drop policy if exists "crm_lead_activities_staff_all" on public.crm_lead_activities;
create policy "crm_lead_activities_staff_all"
  on public.crm_lead_activities for all
  using (public.is_cms_staff())
  with check (public.is_cms_staff());

create or replace function public.admin_create_crm_lead(
  p_account_id uuid default null,
  p_contact_id uuid default null,
  p_company_name text default null,
  p_contact_name text default null,
  p_email text default null,
  p_phone text default null,
  p_source text default 'manual',
  p_interest text default null,
  p_race_id text default null,
  p_package_id text default null,
  p_quantity int default 1,
  p_estimated_value numeric default null,
  p_next_action text default null,
  p_next_action_due_at timestamptz default null,
  p_owner_profile_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_contact_id uuid;
  v_lead_id uuid;
  v_reference text;
  v_account_name text;
  v_contact_name text;
begin
  if not public.has_cms_permission('accounts.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if p_estimated_value is not null and p_estimated_value < 0 then
    raise exception 'invalid_estimated_value';
  end if;
  if coalesce(p_quantity, 0) < 1 then
    raise exception 'invalid_quantity';
  end if;

  if p_package_id is not null and not exists (
    select 1 from public.packages p
    where p.id = btrim(p_package_id)
      and p.shell_parent_package_id is null
      and p.is_hidden = false
  ) then
    raise exception 'package_not_found';
  end if;

  if p_race_id is not null and not exists (
    select 1 from public.races r where r.id = btrim(p_race_id)
  ) then
    raise exception 'event_not_found';
  end if;

  if p_owner_profile_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_owner_profile_id
      and p.role in ('admin', 'finance', 'sales')
  ) then
    raise exception 'owner_not_found';
  end if;

  if p_account_id is not null then
    select a.id, a.name into v_account_id, v_account_name
    from public.crm_accounts a
    where a.id = p_account_id and a.active = true;
    if v_account_id is null then raise exception 'account_not_found'; end if;
  else
    v_account_name := coalesce(
      nullif(btrim(p_company_name), ''),
      nullif(btrim(p_contact_name), ''),
      nullif(btrim(p_email), '')
    );
    if v_account_name is null then raise exception 'client_required'; end if;
    v_account_id := public.admin_ensure_crm_account(
      v_account_name,
      case when nullif(btrim(p_company_name), '') is null then 'direct_client' else 'agent_company' end,
      p_email,
      p_phone,
      null
    );
  end if;

  if p_contact_id is not null then
    select c.id, c.full_name into v_contact_id, v_contact_name
    from public.crm_contacts c
    where c.id = p_contact_id
      and c.account_id = v_account_id
      and c.active = true;
    if v_contact_id is null then raise exception 'contact_not_found_for_account'; end if;
  elsif nullif(btrim(p_contact_name), '') is not null then
    v_contact_name := btrim(p_contact_name);
    if nullif(btrim(p_email), '') is not null then
      select c.id into v_contact_id
      from public.crm_contacts c
      where c.account_id = v_account_id
        and lower(btrim(c.email)) = lower(btrim(p_email))
        and c.active = true
      limit 1;
    end if;

    if v_contact_id is null then
      insert into public.crm_contacts (
        account_id, full_name, email, phone, is_primary, created_by
      ) values (
        v_account_id,
        v_contact_name,
        nullif(btrim(p_email), ''),
        nullif(btrim(p_phone), ''),
        not exists (
          select 1 from public.crm_contacts c
          where c.account_id = v_account_id and c.active = true
        ),
        auth.uid()
      )
      returning id into v_contact_id;
    end if;
  end if;

  v_reference := 'L-' || to_char(timezone('utc', now()), 'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.crm_leads (
    reference,
    account_id,
    contact_id,
    owner_profile_id,
    race_id,
    package_id,
    quantity,
    source,
    interest,
    estimated_value,
    next_action,
    next_action_due_at,
    notes,
    created_by
  ) values (
    v_reference,
    v_account_id,
    v_contact_id,
    coalesce(p_owner_profile_id, auth.uid()),
    nullif(btrim(p_race_id), ''),
    nullif(btrim(p_package_id), ''),
    p_quantity,
    coalesce(nullif(btrim(p_source), ''), 'manual'),
    nullif(btrim(p_interest), ''),
    p_estimated_value,
    nullif(btrim(p_next_action), ''),
    p_next_action_due_at,
    nullif(btrim(p_notes), ''),
    auth.uid()
  )
  returning id into v_lead_id;

  insert into public.crm_lead_activities (
    lead_id, actor_profile_id, action, summary, metadata
  ) values (
    v_lead_id,
    auth.uid(),
    'lead_created',
    'Lead created',
    jsonb_build_object('reference', v_reference, 'account_id', v_account_id, 'contact_id', v_contact_id)
  );

  return v_lead_id;
end;
$$;

revoke all on function public.admin_create_crm_lead(
  uuid, uuid, text, text, text, text, text, text, text, text, int, numeric, text, timestamptz, uuid, text
) from public;
grant execute on function public.admin_create_crm_lead(
  uuid, uuid, text, text, text, text, text, text, text, text, int, numeric, text, timestamptz, uuid, text
) to authenticated;

create or replace function public.admin_convert_crm_lead_to_deal(p_lead_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead public.crm_leads%rowtype;
  v_deal_id uuid;
  v_deal_reference text;
  v_deal_source text;
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_lead
  from public.crm_leads
  where id = p_lead_id
  for update;

  if not found then raise exception 'lead_not_found'; end if;
  if v_lead.converted_deal_id is not null then return v_lead.converted_deal_id; end if;
  if v_lead.status in ('unqualified', 'closed') then raise exception 'lead_closed'; end if;

  v_deal_source := case
    when v_lead.source in ('website', 'portal', 'referral') then v_lead.source
    when v_lead.source = 'repeat_client' then 'offline'
    else 'other'
  end;
  v_deal_reference := 'D-' || to_char(timezone('utc', now()), 'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.deals (
    reference,
    account_id,
    primary_contact_id,
    owner_profile_id,
    race_id,
    source,
    stage,
    currency,
    total_amount,
    next_action,
    next_action_due_at,
    notes,
    created_by
  ) values (
    v_deal_reference,
    v_lead.account_id,
    v_lead.contact_id,
    coalesce(v_lead.owner_profile_id, auth.uid()),
    v_lead.race_id,
    v_deal_source,
    'draft',
    coalesce(
      (select p.currency from public.packages p where p.id = v_lead.package_id),
      v_lead.currency
    ),
    coalesce(
      v_lead.estimated_value,
      (select coalesce(p.trade_price, 0) * v_lead.quantity from public.packages p where p.id = v_lead.package_id),
      0
    ),
    coalesce(v_lead.next_action, 'Review enquiry and prepare price'),
    v_lead.next_action_due_at,
    concat_ws(E'\n', v_lead.interest, v_lead.notes),
    auth.uid()
  )
  returning id into v_deal_id;

  if v_lead.package_id is not null then
    insert into public.deal_line_items (
      deal_id, package_id, quantity, unit_sale_price, currency, reservation_status
    )
    select
      v_deal_id,
      p.id,
      v_lead.quantity,
      case
        when v_lead.estimated_value is not null
          then v_lead.estimated_value / v_lead.quantity
        else coalesce(p.trade_price, 0)
      end,
      coalesce(p.currency, v_lead.currency),
      'none'
    from public.packages p
    where p.id = v_lead.package_id;
  end if;

  update public.crm_leads
  set status = 'converted',
      converted_deal_id = v_deal_id,
      converted_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_lead.id;

  insert into public.crm_lead_activities (
    lead_id, actor_profile_id, action, summary, metadata
  ) values (
    v_lead.id,
    auth.uid(),
    'lead_converted',
    'Lead converted to deal',
    jsonb_build_object('deal_id', v_deal_id, 'deal_reference', v_deal_reference)
  );

  insert into public.deal_activities (
    deal_id, actor_profile_id, action, summary, metadata
  ) values (
    v_deal_id,
    auth.uid(),
    'created_from_lead',
    'Deal created from lead',
    jsonb_build_object('lead_id', v_lead.id, 'lead_reference', v_lead.reference)
  );

  return v_deal_id;
end;
$$;

revoke all on function public.admin_convert_crm_lead_to_deal(uuid) from public;
grant execute on function public.admin_convert_crm_lead_to_deal(uuid) to authenticated;

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
    where p.id = p_owner_profile_id and p.role in ('admin', 'sales')
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

revoke all on function public.admin_update_crm_lead_workflow(
  uuid, text, text, timestamptz, uuid
) from public;
grant execute on function public.admin_update_crm_lead_workflow(
  uuid, text, text, timestamptz, uuid
) to authenticated;

comment on table public.crm_leads is
  'Native enquiries linked to CRM accounts/contacts before conversion to a deal.';

