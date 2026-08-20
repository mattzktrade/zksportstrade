-- Sequential deal IDs: DL0000, DL0001, … Unique, assigned on insert, backfilled for existing deals.

create sequence if not exists public.deal_reference_seq
  as bigint
  minvalue 0
  start with 0
  no cycle;

create or replace function public.format_deal_reference(p_n bigint)
returns text
language sql
immutable
as $$
  select 'DL' || lpad(p_n::text, 4, '0');
$$;

create or replace function public.next_deal_reference()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.format_deal_reference(nextval('public.deal_reference_seq'));
end;
$$;

revoke all on function public.format_deal_reference(bigint) from public;
revoke all on function public.next_deal_reference() from public;
grant execute on function public.format_deal_reference(bigint) to authenticated;
grant execute on function public.next_deal_reference() to authenticated;
grant usage, select on sequence public.deal_reference_seq to authenticated, service_role;

create or replace function public.deals_assign_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.reference := public.next_deal_reference();
  return new;
end;
$$;

drop trigger if exists deals_assign_reference on public.deals;
create trigger deals_assign_reference
  before insert on public.deals
  for each row
  execute function public.deals_assign_reference();

-- Avoid unique collisions while swapping every existing reference.
update public.deals
set reference = '__renumber_' || id::text
where reference not like '__renumber_%';

with numbered as (
  select
    id,
    row_number() over (
      order by coalesce(external_created_at, created_at) asc,
               created_at asc,
               id asc
    ) - 1 as n
  from public.deals
)
update public.deals d
set reference = public.format_deal_reference(numbered.n)
from numbered
where d.id = numbered.id;

do $$
declare
  v_max bigint;
begin
  select coalesce(max(substring(reference from 3)::bigint), -1)
  into v_max
  from public.deals
  where reference ~ '^DL[0-9]+$';

  if v_max < 0 then
    perform setval('public.deal_reference_seq', 0, false);
  else
    perform setval('public.deal_reference_seq', v_max, true);
  end if;
end;
$$;

alter table public.deals drop constraint if exists deals_reference_format;
alter table public.deals
  add constraint deals_reference_format
  check (reference ~ '^DL[0-9]{4,}$');
