-- Close the public API surface that the anon key (shipped to every browser)
-- and any logged-in agent could reach directly through PostgREST.
--
-- Supabase grants EXECUTE on public functions and SELECT on public views to
-- anon and authenticated by default, so `revoke ... from public` alone did not
-- remove access. Views also run with the owner's rights and skip RLS.

-- ---------------------------------------------------------------------------
-- 1. Internal SECURITY DEFINER helpers: server and trigger use only.
--    Every caller is another SECURITY DEFINER function, a trigger, or app code
--    using the service role, so those paths keep working.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        '_backfill_package_order_costs',
        'admin_reassign_supplier_records',
        'admit_ticket',
        'allocate_order_cost_layers',
        'apply_linked_group_inventory_sync',
        'assert_inventory_layer_capacity',
        'assert_inventory_layer_component_capacity',
        'assign_deal_line_supplier_from_stock',
        'assign_deal_suppliers',
        'attach_deal_for_committed_order',
        'begin_linked_bulk_sync',
        'end_linked_bulk_sync',
        'crm_promote_account_to_client',
        'inventory_attach_allocation_day_components',
        'inventory_convert_reservation_allocations',
        'inventory_cover_historical_shortages',
        'inventory_freeze_cost_layer_day_components',
        'inventory_link_deal_line_allocations_to_order',
        'inventory_prepare_order_cancel_release',
        'inventory_rebalance_place_line',
        'inventory_rebalance_release_flexible',
        'inventory_recompute_layer_remaining',
        'inventory_reconcile_candidate_layers',
        'inventory_reconcile_layer_remaining_from_allocations',
        'inventory_search_single_supplier_pack',
        'inventory_sync_deal_line_shortage',
        'mark_deal_awaiting_booking_form_send',
        'next_deal_reference',
        'record_native_booking_form_view',
        'record_native_client_signature',
        'sync_deal_line_supplier_from_allocations'
      ])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end
$$;

-- Admin CRM import is called from the staff session, so keep authenticated
-- (the function checks is_admin itself) but remove anonymous access.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'admin_apply_crm_import_batch'
  loop
    execute format('revoke execute on function %s from public, anon', r.signature);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Inventory / fulfilment views: staff and server only.
--    Wraps the deployed definition (pg_get_viewdef) so columns, grants, and any
--    dashboard edits are preserved. Inside SECURITY DEFINER functions
--    current_user is the owner, so those reads are unaffected.
-- ---------------------------------------------------------------------------
do $$
declare
  v text;
  def text;
begin
  foreach v in array array[
    'inventory_unallocated_won_by_ledger',
    'deal_line_inventory_fulfilment',
    'inventory_day_slot_availability',
    'inventory_availability',
    'native_package_availability'
  ]
  loop
    if to_regclass('public.' || v) is null then
      continue;
    end if;
    def := pg_get_viewdef(('public.' || v)::regclass, true);
    if def ilike '%staff_scope%' then
      continue;
    end if;
    def := regexp_replace(def, ';\s*$', '');
    execute format(
      'create or replace view public.%I as select staff_scope.* from (%s) staff_scope '
      'where current_user not in (''anon'', ''authenticated'') or (select public.is_cms_staff())',
      v,
      def
    );
    execute format('revoke all on public.%I from anon', v);
  end loop;
end
$$;
