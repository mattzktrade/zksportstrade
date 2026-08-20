-- Keep the deal event aligned with its product lines, including Salesforce imports.

create or replace function public.sync_deal_event_from_lines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal_id uuid;
  v_event_count int;
  v_race_id text;
begin
  for v_deal_id in
    select distinct deal_id
    from (
      select case when tg_op <> 'DELETE' then new.deal_id else null end as deal_id
      union all
      select case when tg_op <> 'INSERT' then old.deal_id else null end
    ) affected
    where deal_id is not null
  loop
    select count(distinct package.race_id)::int, min(package.race_id)
    into v_event_count, v_race_id
    from public.deal_line_items line
    join public.packages package on package.id = line.package_id
    where line.deal_id = v_deal_id;

    update public.deals
    set race_id = case when v_event_count = 1 then v_race_id else null end,
        updated_at = timezone('utc', now())
    where id = v_deal_id
      and race_id is distinct from case when v_event_count = 1 then v_race_id else null end;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists deal_lines_sync_event_insert_trg on public.deal_line_items;
create trigger deal_lines_sync_event_insert_trg
after insert on public.deal_line_items
for each row execute function public.sync_deal_event_from_lines();

drop trigger if exists deal_lines_sync_event_update_trg on public.deal_line_items;
create trigger deal_lines_sync_event_update_trg
after update of deal_id, package_id on public.deal_line_items
for each row execute function public.sync_deal_event_from_lines();

drop trigger if exists deal_lines_sync_event_delete_trg on public.deal_line_items;
create trigger deal_lines_sync_event_delete_trg
after delete on public.deal_line_items
for each row execute function public.sync_deal_event_from_lines();

with mapped as (
  select
    line.deal_id,
    count(distinct package.race_id)::int as event_count,
    min(package.race_id) as race_id
  from public.deal_line_items line
  join public.packages package on package.id = line.package_id
  group by line.deal_id
)
update public.deals deal
set race_id = mapped.race_id,
    updated_at = timezone('utc', now())
from mapped
where mapped.deal_id = deal.id
  and mapped.event_count = 1
  and deal.race_id is distinct from mapped.race_id;

