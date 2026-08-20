-- Seed missing operations rows and advance fulfilment when invoices are already paid.

insert into public.order_operations (
  order_id, fulfilment_status, guest_details_status, communication_status,
  supplier_status, delivery_status
)
select
  o.id,
  case
    when o.status = 'cancelled' then 'cancelled'
    when i.status = 'delivered' then 'delivered'
    when i.status = 'paid' then 'confirmed'
    else 'awaiting_payment'
  end,
  case
    when o.status = 'cancelled' then 'not_required'
    else 'not_requested'
  end,
  'not_started',
  case
    when o.status = 'cancelled' then 'not_required'
    else 'unassigned'
  end,
  case when o.status = 'cancelled' then 'not_required' else 'not_ready' end
from public.orders o
left join lateral (
  select status
  from public.invoices
  where order_id = o.id
  order by created_at desc
  limit 1
) i on true
where not exists (
  select 1 from public.order_operations op where op.order_id = o.id
)
on conflict (order_id) do nothing;

update public.order_operations op
set
  fulfilment_status = v.fulfilment_status,
  updated_at = timezone('utc', now())
from (
  select distinct on (order_id)
    order_id,
    case
      when status = 'delivered' then 'delivered'
      when status = 'paid' then 'confirmed'
    end as fulfilment_status
  from public.invoices
  where status in ('paid', 'delivered')
  order by order_id, created_at desc
) v
where v.order_id = op.order_id
  and op.fulfilment_status = 'awaiting_payment'
  and v.fulfilment_status is not null;

update public.order_operations op
set
  fulfilment_status = 'cancelled',
  guest_details_status = 'not_required',
  supplier_status = 'not_required',
  delivery_status = 'not_required',
  updated_at = timezone('utc', now())
from public.orders o
where o.id = op.order_id
  and o.status = 'cancelled'
  and op.fulfilment_status is distinct from 'cancelled';
