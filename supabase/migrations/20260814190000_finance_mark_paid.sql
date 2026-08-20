-- Allow finance staff to mark a deal/invoice paid from the finance queue.

create or replace function public.admin_mark_finance_paid(
  p_invoice_id uuid default null,
  p_deal_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid := p_invoice_id;
  v_deal_id uuid := p_deal_id;
  v_order_id uuid;
begin
  if not public.has_cms_permission('finance.manage')
    and not public.has_cms_permission('deals.manage')
    and not public.is_admin()
  then
    raise exception 'forbidden';
  end if;

  if v_invoice_id is not null then
    select order_id into v_order_id
    from public.invoices
    where id = v_invoice_id;
  end if;

  if v_deal_id is null and v_order_id is not null then
    select coalesce(deal_id, (select id from public.deals where order_id = v_order_id limit 1))
      into v_deal_id
    from public.orders
    where id = v_order_id;
  end if;

  if v_order_id is null and v_deal_id is not null then
    select order_id into v_order_id
    from public.deals
    where id = v_deal_id;
  end if;

  if v_invoice_id is null and v_order_id is not null then
    select id into v_invoice_id
    from public.invoices
    where order_id = v_order_id
    order by created_at desc
    limit 1;
  end if;

  if v_invoice_id is not null then
    update public.invoices
    set
      status = 'paid',
      paid_at = coalesce(paid_at, timezone('utc', now()))
    where id = v_invoice_id
      and status is distinct from 'cancelled';
  end if;

  if v_deal_id is not null then
    update public.deals
    set
      stage = 'paid_confirmed',
      closed_at = coalesce(closed_at, timezone('utc', now())),
      next_action = null,
      next_action_due_at = null,
      updated_at = timezone('utc', now())
    where id = v_deal_id
      and stage not in ('paid_confirmed', 'in_fulfilment', 'fulfilled', 'cancelled', 'closed_lost');
  end if;
end;
$$;

revoke all on function public.admin_mark_finance_paid(uuid, uuid) from public;
grant execute on function public.admin_mark_finance_paid(uuid, uuid) to authenticated;
