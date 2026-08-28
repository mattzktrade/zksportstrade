-- Catch up rows already marked in Operations so agents do not have to toggle them again.

update public.invoices i
set status = 'delivered'
where i.status = 'paid'
  and (
    exists (
      select 1
      from public.order_operations op
      where op.order_id = i.order_id
        and (
          op.delivery_status in ('delivered', 'sent', 'confirmed')
          or op.fulfilment_status = 'delivered'
        )
    )
    or exists (
      select 1
      from public.deals d
      join public.deal_operations dop on dop.deal_id = d.id
      where d.order_id = i.order_id
        and (
          dop.delivery_status in ('delivered', 'sent', 'confirmed')
          or dop.fulfilment_status = 'delivered'
        )
    )
  );

update public.order_operations op
set
  guest_details_status = 'complete',
  updated_at = timezone('utc', now())
from public.orders o
where o.id = op.order_id
  and op.guest_details_status is distinct from 'not_required'
  and op.guest_details_status is distinct from 'complete'
  and (
    select count(*)
    from public.order_guests g
    where g.order_id = o.id
      and nullif(btrim(g.full_name), '') is not null
  ) >= greatest(1, coalesce(o.guests, 1));

update public.deal_operations dop
set
  guest_details_status = 'complete',
  updated_at = timezone('utc', now())
from (
  select
    d.id as deal_id,
    greatest(
      1,
      coalesce((
        select coalesce(sum(li.quantity), 0)::int
        from public.deal_line_items li
        where li.deal_id = d.id
      ), 1)
    ) as needed,
    (
      select count(*)::int
      from public.deal_guests g
      where g.deal_id = d.id
        and nullif(btrim(g.full_name), '') is not null
    ) as named
  from public.deals d
) counts
where counts.deal_id = dop.deal_id
  and dop.guest_details_status is distinct from 'not_required'
  and dop.guest_details_status is distinct from 'complete'
  and counts.named >= counts.needed;
