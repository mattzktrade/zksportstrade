-- Portal checkout deals were created with a blank owner. Assign the Admin
-- profile by default, and keep that default when a portal deal is still unassigned.
-- Also catch up deal pipeline stages from Operations guest/delivery status.

create or replace function public.default_portal_deal_owner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.profiles
  where role = 'admin'
  order by
    case when lower(btrim(coalesce(full_name, ''))) = 'admin' then 0 else 1 end,
    created_at asc,
    id asc
  limit 1
$$;

create or replace function public.assign_default_portal_deal_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source = 'portal' and new.owner_profile_id is null then
    new.owner_profile_id := public.default_portal_deal_owner_id();
  end if;
  return new;
end;
$$;

drop trigger if exists deals_assign_portal_owner_trg on public.deals;
create trigger deals_assign_portal_owner_trg
before insert or update of owner_profile_id, source on public.deals
for each row
execute function public.assign_default_portal_deal_owner();

update public.deals
set
  owner_profile_id = public.default_portal_deal_owner_id(),
  updated_at = timezone('utc', now())
where source = 'portal'
  and owner_profile_id is null
  and public.default_portal_deal_owner_id() is not null;

update public.deals deal
set
  stage = 'in_fulfilment',
  next_action = 'Complete fulfilment',
  updated_at = timezone('utc', now())
where deal.stage = 'paid_confirmed'
  and (
    exists (
      select 1
      from public.order_operations op
      where op.order_id = deal.order_id
        and op.guest_details_status in ('requested', 'partial', 'complete')
    )
    or exists (
      select 1
      from public.deal_operations dop
      where dop.deal_id = deal.id
        and dop.guest_details_status in ('requested', 'partial', 'complete')
    )
  );

update public.deals deal
set
  stage = 'fulfilled',
  next_action = 'Complete',
  closed_at = coalesce(deal.closed_at, timezone('utc', now())),
  updated_at = timezone('utc', now())
where deal.stage in ('paid_confirmed', 'in_fulfilment')
  and (
    exists (
      select 1
      from public.order_operations op
      where op.order_id = deal.order_id
        and (
          op.delivery_status in ('delivered', 'sent', 'confirmed')
          or op.fulfilment_status = 'delivered'
        )
    )
    or exists (
      select 1
      from public.deal_operations dop
      where dop.deal_id = deal.id
        and (
          dop.delivery_status in ('delivered', 'sent', 'confirmed')
          or dop.fulfilment_status = 'delivered'
        )
    )
  );
