-- Multiple CRM account kinds (concierge, ticket agent, supplier, etc).
-- Keep account_type as a single derived value for existing billing checks.

alter table public.crm_accounts
  add column if not exists account_types text[] not null default '{}';

update public.crm_accounts account
set account_types = array[profile.company_type]
from public.profiles profile
where account.portal_profile_id = profile.id
  and profile.company_type in (
    'concierge',
    'travel_agency',
    'ticket_agent',
    'hospitality_agency',
    'other'
  )
  and (account.account_types is null or account.account_types = '{}');

update public.crm_accounts
set account_types = (
  select array_agg(distinct kind)
  from unnest(account_types || array['supplier']::text[]) as kind
)
where account_type = 'supplier_related'
  and not ('supplier' = any (account_types));

update public.crm_accounts
set account_types = array['other']
where account_type in ('other', 'direct_client')
  and (account_types is null or account_types = '{}');

alter table public.crm_accounts
  drop constraint if exists crm_accounts_account_types_check;

alter table public.crm_accounts
  add constraint crm_accounts_account_types_check
  check (
    account_types <@ array[
      'concierge',
      'travel_agency',
      'ticket_agent',
      'hospitality_agency',
      'supplier',
      'other'
    ]::text[]
  );

create index if not exists crm_accounts_account_types_gin_idx
  on public.crm_accounts using gin (account_types);
