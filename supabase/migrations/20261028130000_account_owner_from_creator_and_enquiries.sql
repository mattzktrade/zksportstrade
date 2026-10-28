-- Accounts take an owner automatically: the staff member who created them, or the
-- owner of their enquiries/deals. Only fills a missing owner; never overwrites one.

-- Backfill from the most recent owned enquiry/deal on the account.
update public.crm_accounts account
set owner_profile_id = latest.owner_profile_id,
    updated_at = timezone('utc', now())
from (
  select distinct on (deal.account_id)
    deal.account_id,
    deal.owner_profile_id
  from public.deals deal
  where deal.account_id is not null
    and deal.owner_profile_id is not null
  order by deal.account_id, deal.created_at desc
) latest
where account.id = latest.account_id
  and account.owner_profile_id is null;

-- Then from legacy crm_leads owners.
update public.crm_accounts account
set owner_profile_id = latest.owner_profile_id,
    updated_at = timezone('utc', now())
from (
  select distinct on (lead.account_id)
    lead.account_id,
    lead.owner_profile_id
  from public.crm_leads lead
  where lead.owner_profile_id is not null
  order by lead.account_id, lead.created_at desc
) latest
where account.id = latest.account_id
  and account.owner_profile_id is null;

-- Then the staff member who created the account.
update public.crm_accounts account
set owner_profile_id = account.created_by,
    updated_at = timezone('utc', now())
from public.profiles creator
where creator.id = account.created_by
  and creator.role in ('admin', 'finance', 'sales')
  and account.owner_profile_id is null;

-- Going forward, an unowned account adopts the owner of an enquiry/deal as soon as one is set.
create or replace function public.crm_account_owner_from_deal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_id is not null and new.owner_profile_id is not null then
    update public.crm_accounts
    set owner_profile_id = new.owner_profile_id,
        updated_at = timezone('utc', now())
    where id = new.account_id
      and owner_profile_id is null;
  end if;
  return new;
end;
$$;

drop trigger if exists deals_account_owner_trg on public.deals;
create trigger deals_account_owner_trg
after insert or update of owner_profile_id, account_id on public.deals
for each row
execute function public.crm_account_owner_from_deal();

revoke all on function public.crm_account_owner_from_deal() from public;
