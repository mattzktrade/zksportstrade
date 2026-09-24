-- Leaving a stock-holding stage releases owned fulfilment (supplier and
-- expected cost) on the deal line. A completed booking form still locks the
-- commercial snapshot — product, quantity, price, currency, and sourcing —
-- but that inventory release must not block cancelling or losing the deal.

create or replace function public.prevent_signed_deal_line_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_deal_id uuid;
  v_new_deal_id uuid;
  v_fulfilment_release boolean := false;
begin
  if tg_op <> 'INSERT' then v_old_deal_id := old.deal_id; end if;
  if tg_op <> 'DELETE' then v_new_deal_id := new.deal_id; end if;
  if tg_op = 'UPDATE'
    and new.deal_id is not distinct from old.deal_id
    and (
      new.supplier_id is distinct from old.supplier_id
      or new.expected_unit_cost is distinct from old.expected_unit_cost
    )
    and not public.deal_stage_holds_purchased_stock((
      select deal.stage from public.deals deal where deal.id = new.deal_id
    ))
  then
    v_fulfilment_release := true;
  end if;
  if tg_op = 'UPDATE'
    and new.deal_id is not distinct from old.deal_id
    and new.package_id is not distinct from old.package_id
    and new.quantity is not distinct from old.quantity
    and new.unit_sale_price is not distinct from old.unit_sale_price
    and new.currency is not distinct from old.currency
    and (
      v_fulfilment_release
      or new.supplier_id is not distinct from old.supplier_id
    )
    and (
      v_fulfilment_release
      or new.expected_unit_cost is not distinct from old.expected_unit_cost
    )
    and new.discount_reason is not distinct from old.discount_reason
    and new.sort_order is not distinct from old.sort_order
    and new.sourcing_mode is not distinct from old.sourcing_mode
    and new.supplier_quote_at is not distinct from old.supplier_quote_at
  then return new; end if;
  if exists (
    select 1 from public.booking_forms form
    where form.deal_id in (v_old_deal_id, v_new_deal_id)
      and form.status in ('sent', 'viewed', 'awaiting_zk_signature', 'zk_signed', 'completed')
  ) then raise exception 'booking_form_snapshot_locks_deal_lines'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
