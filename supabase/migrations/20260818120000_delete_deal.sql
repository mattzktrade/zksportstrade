-- Allow staff to delete a deal that has no portal order or live booking form.

create or replace function public.admin_delete_deal(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.deals%rowtype;
begin
  if not public.has_cms_permission('deals.manage') and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_deal_id is null then raise exception 'deal_required'; end if;

  select * into v_deal
  from public.deals
  where id = p_deal_id
  for update;
  if not found then raise exception 'deal_not_found'; end if;

  if v_deal.order_id is not null then
    raise exception 'deal_has_order';
  end if;

  if exists (
    select 1
    from public.booking_forms
    where deal_id = p_deal_id
      and status not in ('draft', 'voided', 'declined', 'expired', 'failed')
  ) then
    raise exception 'deal_has_booking_form';
  end if;

  perform public.admin_release_deal_reservations(
    p_deal_id,
    'cancelled',
    'Deal deleted'
  );

  update public.sourcing_shortages
  set status = case
        when status in ('open', 'quoted', 'confirmed') then 'cancelled'
        else status
      end,
      cleared_at = case
        when status in ('open', 'quoted', 'confirmed') then timezone('utc', now())
        else cleared_at
      end,
      deal_id = null,
      updated_at = timezone('utc', now())
  where deal_id = p_deal_id;

  delete from public.booking_form_events
  where booking_form_id in (select id from public.booking_forms where deal_id = p_deal_id);
  delete from public.booking_form_signatures
  where booking_form_id in (select id from public.booking_forms where deal_id = p_deal_id);
  delete from public.booking_forms where deal_id = p_deal_id;

  delete from public.deals where id = p_deal_id;
end;
$$;

revoke all on function public.admin_delete_deal(uuid) from public;
grant execute on function public.admin_delete_deal(uuid) to authenticated;
