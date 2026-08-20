-- Auto-assign the purchase-stock supplier when a deal line is created or reserved,
-- using the same single-supplier preference as order cost allocation.

create or replace function public.assign_deal_line_supplier_from_stock(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.deal_line_items%rowtype;
  v_deal public.deals%rowtype;
  v_ledger text;
  v_qty int;
  v_layer_id uuid;
  v_supplier_id uuid;
  v_unit_cost numeric;
  v_preferred_block uuid;
  v_preferred_po uuid;
  v_preferred_source text;
begin
  select * into v_line from public.deal_line_items where id = p_line_id;
  if not found then return; end if;
  if coalesce(v_line.sourcing_mode, 'owned') <> 'owned' then return; end if;
  if v_line.fulfilment_cost_layer_id is not null then return; end if;

  select * into v_deal from public.deals where id = v_line.deal_id;
  if not found or v_deal.stage in ('cancelled', 'closed_lost') then return; end if;

  v_qty := greatest(1, v_line.quantity);
  begin
    v_ledger := public.resolve_cost_ledger_package_id(v_line.package_id);
  exception when others then
    v_ledger := v_line.package_id;
  end;

  select fulfilment_block_id
  into v_preferred_block
  from public.package_cost_layers
  where package_id = v_ledger
    and quantity_remaining > 0
    and fulfilment_block_id is not null
  group by fulfilment_block_id
  having sum(quantity_remaining) >= v_qty
  order by min(received_at) asc, fulfilment_block_id asc
  limit 1;

  if v_preferred_block is not null then
    select id into v_layer_id
    from public.package_cost_layers
    where package_id = v_ledger
      and fulfilment_block_id = v_preferred_block
      and quantity_remaining > 0
    order by received_at asc, id asc
    limit 1;
  else
    select purchase_order_id
    into v_preferred_po
    from public.package_cost_layers
    where package_id = v_ledger
      and quantity_remaining > 0
      and purchase_order_id is not null
    group by purchase_order_id
    having sum(quantity_remaining) >= v_qty
    order by min(received_at) asc, purchase_order_id asc
    limit 1;

    if v_preferred_po is not null then
      select id into v_layer_id
      from public.package_cost_layers
      where package_id = v_ledger
        and purchase_order_id = v_preferred_po
        and quantity_remaining > 0
      order by received_at asc, id asc
      limit 1;
    else
      select lower(btrim(source))
      into v_preferred_source
      from public.package_cost_layers
      where package_id = v_ledger
        and quantity_remaining > 0
        and nullif(btrim(source), '') is not null
        and purchase_order_id is null
        and fulfilment_block_id is null
      group by lower(btrim(source))
      having sum(quantity_remaining) >= v_qty
      order by min(received_at) asc, lower(btrim(source)) asc
      limit 1;

      if v_preferred_source is not null then
        select id into v_layer_id
        from public.package_cost_layers
        where package_id = v_ledger
          and lower(btrim(source)) = v_preferred_source
          and quantity_remaining > 0
        order by received_at asc, id asc
        limit 1;
      else
        select id into v_layer_id
        from public.package_cost_layers
        where package_id = v_ledger
          and quantity_remaining >= v_qty
        order by received_at asc, id asc
        limit 1;
      end if;
    end if;
  end if;

  if v_layer_id is null then
    select id into v_layer_id
    from public.package_cost_layers
    where package_id = v_ledger
      and quantity_remaining > 0
    order by received_at asc, id asc
    limit 1;
  end if;

  if v_layer_id is null then return; end if;

  select
    layer.unit_cost,
    coalesce(layer.supplier_id, po.supplier_id)
  into v_unit_cost, v_supplier_id
  from public.package_cost_layers layer
  left join public.purchase_orders po on po.id = layer.purchase_order_id
  where layer.id = v_layer_id;

  update public.deal_line_items
  set fulfilment_cost_layer_id = v_layer_id,
      supplier_id = coalesce(v_supplier_id, supplier_id),
      expected_unit_cost = coalesce(v_unit_cost, expected_unit_cost),
      updated_at = timezone('utc', now())
  where id = p_line_id;
end;
$$;

create or replace function public.assign_deal_suppliers(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
begin
  for v_line in
    select id
    from public.deal_line_items
    where deal_id = p_deal_id
      and fulfilment_cost_layer_id is null
      and coalesce(sourcing_mode, 'owned') = 'owned'
    order by sort_order, id
  loop
    perform public.assign_deal_line_supplier_from_stock(v_line.id);
  end loop;
end;
$$;

create or replace function public.trg_assign_deal_line_supplier()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.sourcing_mode, 'owned') = 'owned' and new.fulfilment_cost_layer_id is null then
    perform public.assign_deal_line_supplier_from_stock(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists deal_line_items_auto_assign_supplier on public.deal_line_items;
create trigger deal_line_items_auto_assign_supplier
after insert or update of reservation_status, package_id, quantity
on public.deal_line_items
for each row
execute function public.trg_assign_deal_line_supplier();

do $$
declare
  v_line record;
begin
  for v_line in
    select line.id
    from public.deal_line_items line
    join public.deals deal on deal.id = line.deal_id
    where line.fulfilment_cost_layer_id is null
      and coalesce(line.sourcing_mode, 'owned') = 'owned'
      and deal.stage not in ('cancelled', 'closed_lost')
    order by deal.created_at, line.sort_order
  loop
    perform public.assign_deal_line_supplier_from_stock(v_line.id);
  end loop;
end;
$$;

revoke all on function public.assign_deal_line_supplier_from_stock(uuid) from public;
revoke all on function public.assign_deal_suppliers(uuid) from public;
grant execute on function public.assign_deal_line_supplier_from_stock(uuid) to authenticated;
grant execute on function public.assign_deal_suppliers(uuid) to authenticated;
