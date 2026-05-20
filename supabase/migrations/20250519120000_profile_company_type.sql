-- Agent company type (concierge, travel agency, etc.)
alter table public.profiles
  add column if not exists company_type text;

alter table public.profiles
  drop constraint if exists profiles_company_type_check;

alter table public.profiles
  add constraint profiles_company_type_check check (
    company_type is null
    or company_type in (
      'concierge',
      'travel_agency',
      'ticket_agent',
      'hospitality_agency',
      'other'
    )
  );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_type text;
begin
  v_company_type := nullif(trim(coalesce(new.raw_user_meta_data->>'company_type', '')), '');
  if v_company_type is not null
    and v_company_type not in (
      'concierge',
      'travel_agency',
      'ticket_agent',
      'hospitality_agency',
      'other'
    )
  then
    v_company_type := null;
  end if;

  insert into public.profiles (id, email, full_name, company_name, company_type, role, approval_status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'company_name', ''),
    v_company_type,
    'agent',
    'pending'
  );
  return new;
end;
$$;
