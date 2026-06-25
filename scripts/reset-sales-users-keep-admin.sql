-- Reset portal sales/users while keeping catalog packages/races and one admin account.
--
-- HOW TO USE
-- 1) Replace REPLACE_WITH_ADMIN_EMAIL below with the admin email you want to keep.
-- 2) Run in Supabase SQL Editor against the correct project.
-- 3) Review the final counts before committing if you remove the COMMIT.
--
-- This deletes:
-- - agent/user profiles and auth users except the chosen admin
-- - orders, invoices, delivery proofs, booking approval requests, holds
-- - offline Salesforce sale applications and integration outbox jobs
--
-- This keeps:
-- - races, packages, package content/images, package integrations, Wix mappings
-- - package stock purchased / cost layer rows
--
-- Inventory reset:
-- - every cost layer quantity_remaining is restored to quantity
-- - package_inventory.qty_available is reset to total stock purchased
-- - package_inventory.qty_held is reset to 0

begin;

create temporary table reset_keep_admin as
select id, email
from public.profiles
where lower(email) = lower('REPLACE_WITH_ADMIN_EMAIL');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from reset_keep_admin;
  if v_count <> 1 then
    raise exception 'Expected exactly one admin profile to keep, found %. Check the email in reset_keep_admin.', v_count;
  end if;
end $$;

-- Remove private delivery proof files from Supabase Storage.
delete from storage.objects
where bucket_id = 'order-delivery-proofs';

-- Clear sales/workflow data first so profile/auth deletes are not blocked by restrict FKs.
delete from public.order_delivery_proofs;
delete from public.order_cost_consumptions;
delete from public.invoices;
delete from public.booking_approval_requests;
delete from public.inventory_holds;
delete from public.salesforce_offline_sale_applications;
delete from public.integration_outbox;

-- Older branches had order_documents before PandaDoc was removed. Delete only if still present.
do $$
begin
  if to_regclass('public.order_documents') is not null then
    execute 'delete from public.order_documents';
  end if;
end $$;

delete from public.orders;

-- Restore purchased-stock layers as if no orders have consumed them.
update public.package_cost_layers
set quantity_remaining = quantity,
    updated_at = now();

-- Ensure every package has an inventory row, then rebuild inventory from stock purchased.
insert into public.package_inventory (package_id, qty_available, qty_held)
select p.id, 0, 0
from public.packages p
on conflict (package_id) do nothing;

with purchased_stock as (
  select
    p.id as package_id,
    coalesce(sum(cl.quantity), 0)::int as stock_total
  from public.packages p
  left join public.package_cost_layers cl on cl.package_id = p.id
  group by p.id
)
update public.package_inventory pi
set qty_available = purchased_stock.stock_total,
    qty_held = 0
from purchased_stock
where purchased_stock.package_id = pi.package_id;

-- Reconcile linked inventory groups after the raw stock reset.
do $$
declare
  r record;
begin
  if to_regprocedure('public.reconcile_linked_multi_day_inventory(text)') is not null then
    for r in
      select distinct inventory_group_id
      from public.packages
      where inventory_group_id is not null
        and btrim(inventory_group_id) <> ''
    loop
      perform public.reconcile_linked_multi_day_inventory(r.inventory_group_id);
    end loop;
  end if;
end $$;

-- Remove portal users except the chosen admin profile.
delete from public.profiles p
where not exists (
  select 1 from reset_keep_admin k where k.id = p.id
);

-- Remove Supabase Auth users except the chosen admin account.
-- If your SQL editor cannot delete from auth.users, do this part in Supabase Auth UI/API.
delete from auth.users u
where not exists (
  select 1 from reset_keep_admin k where k.id = u.id
);

-- Leave package sync statuses non-failed and ready for the next deliberate sync.
update public.packages
set integration_sync_status = case
      when integration_sync_status = 'failed' then 'idle'
      else integration_sync_status
    end,
    integration_sync_error = null;

-- Quick sanity counts returned after the reset.
select 'orders' as table_name, count(*)::text as remaining from public.orders
union all select 'invoices', count(*)::text from public.invoices
union all select 'booking_approval_requests', count(*)::text from public.booking_approval_requests
union all select 'inventory_holds', count(*)::text from public.inventory_holds
union all select 'salesforce_offline_sale_applications', count(*)::text from public.salesforce_offline_sale_applications
union all select 'profiles', count(*)::text from public.profiles
union all select 'auth.users', count(*)::text from auth.users;

commit;
