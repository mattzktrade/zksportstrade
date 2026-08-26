-- Keep shortage quantities positive for audit history. A fully covered row is
-- resolved without rewriting its quantity to zero; remaining/open quantity is
-- reduced only for partial coverage.

create or replace function public.inventory_cover_historical_shortages(
  p_package_id text,
  p_source_key text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shortage record;
  v_available int;
  v_take int;
  v_covered int := 0;
  v_fully_covered boolean;
begin
  if nullif(btrim(p_package_id), '') is null then
    raise exception 'package_required';
  end if;
  if nullif(btrim(p_source_key), '') is null then
    raise exception 'source_key_required';
  end if;

  for v_shortage in
    select shortage.*
    from public.inventory_shortages shortage
    where shortage.package_id = p_package_id
      and shortage.shortage_type = 'historical_reconciliation'
      and shortage.status = 'open'
    order by shortage.created_at, shortage.id
    for update
  loop
    v_available := public.inventory_package_allocatable_quantity(p_package_id);
    exit when v_available <= 0;
    v_take := least(v_shortage.quantity, v_available);
    v_fully_covered := v_take = v_shortage.quantity;

    perform public.inventory_allocate_quantity(
      p_package_id,
      v_take,
      'committed',
      'historical_shortage_cover',
      'shortage:' || v_shortage.id::text || ':cover:' || btrim(p_source_key),
      v_shortage.deal_id,
      v_shortage.deal_line_item_id,
      v_shortage.order_id,
      v_shortage.order_line_item_id,
      null,
      'New purchase stock covered historical shortage',
      jsonb_build_object(
        'shortage_id', v_shortage.id,
        'source_key', btrim(p_source_key)
      )
    );

    update public.inventory_shortages
    set quantity = case
          when v_fully_covered then quantity
          else quantity - v_take
        end,
        status = case when v_fully_covered then 'resolved' else 'open' end,
        resolved_at = case
          when v_fully_covered then timezone('utc', now())
          else null
        end,
        updated_at = timezone('utc', now()),
        metadata = metadata || jsonb_build_object(
          'original_quantity',
            coalesce((metadata->>'original_quantity')::int, v_shortage.quantity),
          'covered_quantity_total',
            coalesce((metadata->>'covered_quantity_total')::int, 0) + v_take,
          'last_cover_source_key', btrim(p_source_key),
          'last_covered_quantity', v_take
        )
    where id = v_shortage.id;

    v_covered := v_covered + v_take;
  end loop;
  return v_covered;
end;
$$;

revoke all on function public.inventory_cover_historical_shortages(text, text)
  from public;
grant execute on function public.inventory_cover_historical_shortages(text, text)
  to service_role;
