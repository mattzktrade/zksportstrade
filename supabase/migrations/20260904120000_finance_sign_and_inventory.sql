-- Finance (e.g. Chelley) matches admin for day-to-day CMS work:
-- countersign booking forms, manage catalog/stock, purchase orders, suppliers.
-- Still admin-only: Settings / team logins / integrations UI, sending booking
-- forms to the client, CRM imports, cutover, and promoting other users.

create or replace function public.is_cms_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'finance')
  );
$$;

grant execute on function public.is_cms_operator() to authenticated, anon;

comment on function public.is_cms_operator() is
  'Admin and finance. Settings, sending booking forms, and team logins stay is_admin().';

-- ---------------------------------------------------------------------------
-- Catalog / inventory / PO reads and writes that previously used is_admin()
-- ---------------------------------------------------------------------------
drop policy if exists "races_insert_admin" on public.races;
create policy "races_insert_admin"
  on public.races for insert
  with check (public.is_cms_operator());

drop policy if exists "races_update_admin" on public.races;
create policy "races_update_admin"
  on public.races for update
  using (public.is_cms_operator());

drop policy if exists "races_delete_admin" on public.races;
create policy "races_delete_admin"
  on public.races for delete
  using (public.is_cms_operator());

drop policy if exists "packages_insert_admin" on public.packages;
create policy "packages_insert_admin"
  on public.packages for insert
  with check (public.is_cms_operator());

drop policy if exists "packages_update_admin" on public.packages;
create policy "packages_update_admin"
  on public.packages for update
  using (public.is_cms_operator());

drop policy if exists "packages_delete_admin" on public.packages;
create policy "packages_delete_admin"
  on public.packages for delete
  using (public.is_cms_operator());

drop policy if exists "package_inventory_insert_admin" on public.package_inventory;
create policy "package_inventory_insert_admin"
  on public.package_inventory for insert
  with check (public.is_cms_operator());

drop policy if exists "package_inventory_update_admin" on public.package_inventory;
create policy "package_inventory_update_admin"
  on public.package_inventory for update
  using (public.is_cms_operator());

drop policy if exists "package_inventory_delete_admin" on public.package_inventory;
create policy "package_inventory_delete_admin"
  on public.package_inventory for delete
  using (public.is_cms_operator());

drop policy if exists "package_cost_layers_select_admin" on public.package_cost_layers;
create policy "package_cost_layers_select_admin"
  on public.package_cost_layers for select
  using (public.is_cms_operator());

drop policy if exists "order_cost_consumptions_select_admin" on public.order_cost_consumptions;
create policy "order_cost_consumptions_select_admin"
  on public.order_cost_consumptions for select
  using (public.is_cms_operator());

drop policy if exists "purchase_orders_admin_all" on public.purchase_orders;
create policy "purchase_orders_admin_all"
  on public.purchase_orders for all
  using (public.is_cms_operator())
  with check (public.is_cms_operator());

drop policy if exists "purchase_order_documents_admin_all" on public.purchase_order_documents;
create policy "purchase_order_documents_admin_all"
  on public.purchase_order_documents for all
  using (public.is_cms_operator())
  with check (public.is_cms_operator());

drop policy if exists "fulfilment_blocks_admin_all" on public.fulfilment_blocks;
create policy "fulfilment_blocks_admin_all"
  on public.fulfilment_blocks for all
  using (public.is_cms_operator())
  with check (public.is_cms_operator());

drop policy if exists "inventory_holds_select_admin" on public.inventory_holds;
create policy "inventory_holds_select_admin"
  on public.inventory_holds for select
  using (public.is_cms_operator());

drop policy if exists "suppliers_admin_all" on public.suppliers;
create policy "suppliers_admin_all"
  on public.suppliers for all
  using (public.is_cms_operator())
  with check (public.is_cms_operator());

drop policy if exists "inventory_pools_admin_all" on public.inventory_pools;
create policy "inventory_pools_admin_all"
  on public.inventory_pools for all
  using (public.is_cms_operator())
  with check (public.is_cms_operator());

drop policy if exists "inventory_pool_day_capacity_admin_all" on public.inventory_pool_day_capacity;
create policy "inventory_pool_day_capacity_admin_all"
  on public.inventory_pool_day_capacity for all
  using (public.is_cms_operator())
  with check (public.is_cms_operator());

drop policy if exists "package_day_consumption_admin_all" on public.package_day_consumption;
create policy "package_day_consumption_admin_all"
  on public.package_day_consumption for all
  using (public.is_cms_operator())
  with check (public.is_cms_operator());

drop policy if exists "inventory_ledger_entries_admin_select" on public.inventory_ledger_entries;
create policy "inventory_ledger_entries_admin_select"
  on public.inventory_ledger_entries for select
  using (public.is_cms_operator());

drop policy if exists "inventory_ledger_entries_admin_insert" on public.inventory_ledger_entries;
create policy "inventory_ledger_entries_admin_insert"
  on public.inventory_ledger_entries for insert
  with check (public.is_cms_operator());

drop policy if exists "inventory_reservations_admin_all" on public.inventory_reservations;
create policy "inventory_reservations_admin_all"
  on public.inventory_reservations for all
  using (public.is_cms_operator())
  with check (public.is_cms_operator());

drop policy if exists "sourcing_shortages_admin_all" on public.sourcing_shortages;
create policy "sourcing_shortages_admin_all"
  on public.sourcing_shortages for all
  using (public.is_cms_operator())
  with check (public.is_cms_operator());

drop policy if exists "inventory_allocation_control_staff_select" on public.inventory_allocation_control;
create policy "inventory_allocation_control_staff_select"
  on public.inventory_allocation_control for select
  using (public.is_cms_operator());

drop policy if exists "channel_listings_admin_all" on public.channel_listings;
create policy "channel_listings_admin_all"
  on public.channel_listings for all
  using (public.is_cms_operator())
  with check (public.is_cms_operator());

drop policy if exists "integration_outbox_admin_select" on public.integration_outbox;
create policy "integration_outbox_admin_select"
  on public.integration_outbox for select
  using (public.is_cms_operator());

drop policy if exists "integration_outbox_admin_insert" on public.integration_outbox;
create policy "integration_outbox_admin_insert"
  on public.integration_outbox for insert
  with check (public.is_cms_operator());

drop policy if exists "order_delivery_proofs_select_admin" on public.order_delivery_proofs;
create policy "order_delivery_proofs_select_admin"
  on public.order_delivery_proofs for select
  using (public.is_cms_operator());

drop policy if exists "order_delivery_proofs_insert_admin" on public.order_delivery_proofs;
create policy "order_delivery_proofs_insert_admin"
  on public.order_delivery_proofs for insert
  with check (public.is_cms_operator());

drop policy if exists "package_items_admin_all" on public.package_items;
create policy "package_items_admin_all"
  on public.package_items for all
  using (public.is_cms_operator())
  with check (public.is_cms_operator());

-- Finance may approve/reject portal agents, but cannot change CMS staff roles.
drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin"
  on public.profiles for update
  using (
    id = auth.uid()
    or public.is_admin()
    or (public.is_cms_operator() and role = 'agent')
  )
  with check (
    id = auth.uid()
    or public.is_admin()
    or (public.is_cms_operator() and role = 'agent')
  );

-- ---------------------------------------------------------------------------
-- Rewrite live admin_* RPC guards from is_admin() to is_cms_operator(),
-- except sending booking forms, cutover, CRM imports, and one-off cleanup.
-- Uses the deployed function body so this cannot drift from an older copy.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  def text;
  updated text;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like 'admin_%'
        or p.proname = 'enqueue_integration_event'
      )
      and p.proname not in (
        'admin_send_native_booking_form',
        'admin_apply_crm_import_batch',
        'admin_cleanup_legacy_shell_packages'
      )
      and p.proname not like '%cutover%'
  loop
    def := pg_get_functiondef(r.oid);
    if def not like '%public.is_admin()%' then
      continue;
    end if;
    updated := replace(def, 'public.is_admin()', 'public.is_cms_operator()');
    if updated not ilike 'create or replace function%' then
      updated := regexp_replace(updated, '^CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
    end if;
    execute updated;
  end loop;
end
$$;
