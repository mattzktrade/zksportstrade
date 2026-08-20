-- Account source for companies/contacts directory (replaces the leads inbox).

alter table public.crm_accounts
  add column if not exists source text;

update public.crm_accounts account
set source = case latest.source
  when 'portal' then 'website'
  when 'repeat_client' then 'other'
  else latest.source
end
from (
  select distinct on (account_id)
    account_id,
    source
  from public.crm_leads
  order by account_id, created_at desc
) latest
where account.id = latest.account_id
  and account.source is null
  and latest.source in ('manual', 'website', 'portal', 'referral', 'marketing', 'repeat_client', 'other');

update public.crm_accounts
set source = 'manual'
where source is null;

alter table public.crm_accounts
  alter column source set default 'manual';

alter table public.crm_accounts
  alter column source set not null;

alter table public.crm_accounts
  drop constraint if exists crm_accounts_source_check;

alter table public.crm_accounts
  add constraint crm_accounts_source_check
  check (source in ('manual', 'website', 'referral', 'marketing', 'other'));

create index if not exists crm_accounts_source_idx
  on public.crm_accounts (source, created_at desc);
