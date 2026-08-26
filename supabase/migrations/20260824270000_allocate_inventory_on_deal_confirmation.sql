-- Deal lines are normally created while the deal is still a draft. Allocate
-- their purchased stock when the deal later enters or leaves a confirmed stage
-- so sellable quantity, cost layers, COGS, and supplier assignment stay atomic.

create or replace function public.sync_deal_inventory_after_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_old_confirmed boolean;
  v_new_confirmed boolean;
begin
  v_old_confirmed := old.stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled');
  v_new_confirmed := new.stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled');

  if v_old_confirmed = v_new_confirmed then
    return new;
  end if;

  for v_line in
    select line.id
    from public.deal_line_items line
    where line.deal_id = new.id
    order by line.sort_order, line.id
  loop
    perform public.inventory_reassign_deal_line(v_line.id, null);
  end loop;

  return new;
end;
$$;

drop trigger if exists deals_sync_inventory_after_stage_change_trg
  on public.deals;
create trigger deals_sync_inventory_after_stage_change_trg
after update of stage on public.deals
for each row
when (old.stage is distinct from new.stage)
execute function public.sync_deal_inventory_after_stage_change();

-- Repair recent/existing confirmed lines that are not fully represented in the
-- canonical allocation ledger. Each call is isolated so an old genuine
-- shortage cannot prevent a later coverable line from being repaired.
do $$
declare
  v_line record;
begin
  for v_line in
    select line.id
    from public.deal_line_items line
    join public.deals deal on deal.id = line.deal_id
    left join lateral (
      select coalesce(sum(allocation.quantity), 0)::int as quantity
      from public.inventory_allocations allocation
      where allocation.deal_line_item_id = line.id
        and allocation.state in ('reserved', 'committed')
    ) allocated on true
    where deal.stage in ('paid_confirmed', 'in_fulfilment', 'fulfilled')
      and coalesce(line.sourcing_mode, 'owned') = 'owned'
      and allocated.quantity < line.quantity
    order by deal.created_at desc, line.sort_order, line.id
  loop
    begin
      perform public.inventory_reassign_deal_line(v_line.id, null);
    exception
      when others then
        raise notice 'Could not automatically repair deal line %: %',
          v_line.id,
          sqlerrm;
    end;
  end loop;
end;
$$;

revoke all on function public.sync_deal_inventory_after_stage_change() from public;
