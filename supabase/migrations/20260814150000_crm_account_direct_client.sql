-- Allow Direct client as an account kind (end users, not trade companies).

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
      'direct_client',
      'supplier',
      'other'
    ]::text[]
  );

update public.crm_accounts
set account_types = array['direct_client']
where account_type = 'direct_client'
  and account_types = array['other']::text[];
