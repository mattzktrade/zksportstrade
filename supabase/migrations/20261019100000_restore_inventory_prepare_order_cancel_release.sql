-- The Oct 14 cancel rewrite calls inventory_prepare_order_cancel_release so
-- fulfilment-locked stock can be restored without voiding the Xero invoice.
-- Hosted databases that never received the Aug 27 helper (or lost it) fail
-- cancel with "function public.inventory_prepare_order_cancel_release(uuid)
-- does not exist". Recreate it. Tickets received or delivered still block.

create or replace function public.inventory_prepare_order_cancel_release(
  p_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_order_id is null then raise exception 'order_id_required'; end if;

  if exists (
    select 1
    from public.order_supplier_fulfilments fulfilment
    where fulfilment.order_id = p_order_id
      and fulfilment.status = 'tickets_received'
  ) or exists (
    select 1
    from public.order_operations operation
    where operation.order_id = p_order_id
      and (
        operation.delivery_status = 'delivered'
        or operation.fulfilment_status = 'delivered'
      )
  ) then
    raise exception 'tickets_or_delivery_block_cancellation';
  end if;

  update public.inventory_allocations allocation
  set lock_state = 'mutable',
      locked_at = null,
      locked_reason = null,
      updated_at = timezone('utc', now()),
      metadata = allocation.metadata || jsonb_build_object(
        'reason', 'Unlocked so cancelled order stock can be restored'
      )
  where allocation.order_id = p_order_id
    and allocation.state <> 'released'
    and allocation.lock_state = 'fulfilment_locked';
end;
$$;

revoke all on function public.inventory_prepare_order_cancel_release(uuid)
  from public;
