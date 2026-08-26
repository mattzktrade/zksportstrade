-- A historical shortage can be created after its covering purchase layers
-- already exist (for example during a later import/reassignment). Cover it
-- immediately from canonical stock instead of waiting for another purchase.

create or replace function public.cover_new_historical_shortage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.shortage_type = 'historical_reconciliation'
    and new.status = 'open'
  then
    perform public.inventory_cover_historical_shortages(
      new.package_id,
      'shortage-insert:' || new.id::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_shortages_cover_existing_stock_trg
  on public.inventory_shortages;
create trigger inventory_shortages_cover_existing_stock_trg
after insert on public.inventory_shortages
for each row execute function public.cover_new_historical_shortage();

-- Repair existing rows in the same safe FIFO path. This consumes available
-- components, creates normal allocation audit rows, and resolves/partially
-- reduces shortages without deleting their history.
do $$
declare
  v_package record;
begin
  for v_package in
    select distinct shortage.package_id
    from public.inventory_shortages shortage
    where shortage.shortage_type = 'historical_reconciliation'
      and shortage.status = 'open'
    order by shortage.package_id
  loop
    perform public.inventory_cover_historical_shortages(
      v_package.package_id,
      'migration:20260825200000:' || v_package.package_id
    );
  end loop;
end;
$$;

revoke all on function public.cover_new_historical_shortage() from public;
