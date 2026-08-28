-- Account lifecycle and lead work-queue stages.
-- Leads is a filtered view of crm_accounts (not a revival of the crm_leads enquiry inbox).

alter table public.crm_accounts
  add column if not exists lifecycle text not null default 'lead';

alter table public.crm_accounts
  add column if not exists lead_stage text not null default 'new';

alter table public.crm_accounts
  drop constraint if exists crm_accounts_lifecycle_check;

alter table public.crm_accounts
  add constraint crm_accounts_lifecycle_check
  check (lifecycle in ('lead', 'client'));

alter table public.crm_accounts
  drop constraint if exists crm_accounts_lead_stage_check;

alter table public.crm_accounts
  add constraint crm_accounts_lead_stage_check
  check (lead_stage in ('new', 'reach_out', 'talking', 'later', 'not_a_fit'));

comment on column public.crm_accounts.lifecycle is
  'lead = prospect work queue; client = has booked (signed/sold deal or non-cancelled order). Auto-promote is lead to client only.';

comment on column public.crm_accounts.lead_stage is
  'Outreach stage while lifecycle is lead. New accounts and bulk uploads start as new; historical backfill uses later.';

-- Existing rows must not flood the New work queue.
update public.crm_accounts
set lead_stage = 'later'
where lead_stage = 'new';

-- Booked accounts become clients. Signed/sold deals count as booked even if unpaid.
update public.crm_accounts account
set lifecycle = 'client'
where account.lifecycle = 'lead'
  and (
    exists (
      select 1
      from public.deals deal
      where deal.account_id = account.id
        and deal.stage in (
          'signed',
          'awaiting_invoice',
          'awaiting_payment',
          'paid_confirmed',
          'in_fulfilment',
          'fulfilled'
        )
    )
    or exists (
      select 1
      from public.orders ord
      where ord.status is distinct from 'cancelled'
        and (
          ord.crm_account_id = account.id
          or (
            account.portal_profile_id is not null
            and ord.agent_profile_id = account.portal_profile_id
          )
        )
    )
  );

create index if not exists crm_accounts_lifecycle_stage_idx
  on public.crm_accounts (lifecycle, lead_stage, created_at desc);

create or replace function public.crm_promote_account_to_client(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_account_id is null then
    return;
  end if;
  update public.crm_accounts
  set lifecycle = 'client',
      updated_at = timezone('utc', now())
  where id = p_account_id
    and lifecycle = 'lead';
end;
$$;

create or replace function public.crm_promote_account_from_deal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_id is not null
     and new.stage in (
       'signed',
       'awaiting_invoice',
       'awaiting_payment',
       'paid_confirmed',
       'in_fulfilment',
       'fulfilled'
     )
  then
    perform public.crm_promote_account_to_client(new.account_id);
  end if;
  return new;
end;
$$;

drop trigger if exists deals_promote_account_to_client_trg on public.deals;
create trigger deals_promote_account_to_client_trg
after insert or update of stage, account_id on public.deals
for each row
execute function public.crm_promote_account_from_deal();

create or replace function public.crm_promote_account_from_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from 'cancelled' then
    return new;
  end if;
  if new.crm_account_id is not null then
    perform public.crm_promote_account_to_client(new.crm_account_id);
  end if;
  if new.agent_profile_id is not null then
    update public.crm_accounts
    set lifecycle = 'client',
        updated_at = timezone('utc', now())
    where portal_profile_id = new.agent_profile_id
      and lifecycle = 'lead';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_promote_account_to_client_trg on public.orders;
create trigger orders_promote_account_to_client_trg
after insert or update of status, crm_account_id, agent_profile_id on public.orders
for each row
execute function public.crm_promote_account_from_order();

revoke all on function public.crm_promote_account_to_client(uuid) from public;
revoke all on function public.crm_promote_account_from_deal() from public;
revoke all on function public.crm_promote_account_from_order() from public;
