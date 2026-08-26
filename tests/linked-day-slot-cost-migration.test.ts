import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const foundation = readFileSync(
  new URL(
    "../supabase/migrations/20260825110000_linked_day_slot_cost_foundation.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase()
const mutations = readFileSync(
  new URL(
    "../supabase/migrations/20260825120000_linked_day_slot_canonical_mutations.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase()
const paths = readFileSync(
  new URL(
    "../supabase/migrations/20260825130000_linked_day_slot_paths_and_views.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase()
const adminContracts = readFileSync(
  new URL(
    "../supabase/migrations/20260825140000_linked_day_cost_admin_contracts.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase()
const remainingMutations = readFileSync(
  new URL(
    "../supabase/migrations/20260825150000_linked_day_slot_remaining_mutations.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase()
const orderMutationSafety = readFileSync(
  new URL(
    "../supabase/migrations/20260825160000_component_safe_order_reassignment_and_cancel.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase()
const stockDeletionSafety = readFileSync(
  new URL(
    "../supabase/migrations/20260825170000_delete_frozen_cost_layer_snapshots.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase()
const canonicalStockDeletion = readFileSync(
  new URL(
    "../supabase/migrations/20260825180000_delete_stock_using_layer_capacity.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase()
const historicalPurchaseFallback = readFileSync(
  new URL(
    "../supabase/migrations/20260825190000_historical_po_day_cost_fallback.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase()
const shortageAutoCover = readFileSync(
  new URL(
    "../supabase/migrations/20260825200000_cover_shortages_created_after_stock.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase()
const singleProductFallback = readFileSync(
  new URL(
    "../supabase/migrations/20260825210000_single_product_day_cost_fallback.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase()
const supplierPoolIdentity = readFileSync(
  new URL(
    "../supabase/migrations/20260825220000_purchase_order_supplier_pool_identity.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase()
const soldFollowsAllocations = readFileSync(
  new URL(
    "../supabase/migrations/20260825230000_sold_follows_allocated_layers.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase()
const quantityRemainingSync = readFileSync(
  new URL(
    "../supabase/migrations/20260826120000_cost_layer_quantity_keeps_remaining_in_sync.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase()

test("day-slot schema is additive and preserves physical/audit rows", () => {
  assert.match(foundation, /create table if not exists public\.inventory_group_cost_policies/)
  assert.match(foundation, /add column if not exists source_package_id/)
  assert.match(foundation, /create table if not exists public\.package_cost_layer_day_components/)
  assert.match(foundation, /create table if not exists public\.inventory_allocation_day_components/)
  assert.match(foundation, /create table if not exists public\.inventory_cost_restatement_events/)
  assert.doesNotMatch(
    foundation,
    /delete from public\.(package_cost_layers|inventory_allocations|inventory_allocation_events)/,
  )
})

test("weights require positive day prices or valid manual weights", () => {
  assert.match(foundation, /inventory_manual_day_weights_valid/)
  assert.match(foundation, /allocation_method = 'manual'/)
  assert.match(foundation, /abs\([\s\S]*- 1\) <= 0\.000001/)
  assert.match(foundation, /missing_positive_day_trade_prices_or_valid_manual_weights/)
  assert.match(foundation, /inventory_cost_policy_setup_required/)
  assert.match(foundation, /historical_equal_fallback/)
  assert.match(foundation, /cost_snapshot_frozen_at/)
  assert.match(foundation, /v_layer\.unit_cost - v_allocated_cost/)
})

test("component allocator locks deterministically and enforces every slot", () => {
  assert.match(mutations, /order by layer\.id, component\.day_slot/)
  assert.match(mutations, /for update of layer, component/)
  assert.match(mutations, /inventory_layer_component_available_quantity/)
  assert.match(mutations, /insufficient_purchased_day_capacity/)
  assert.match(mutations, /inventory_attach_allocation_day_components/)
  assert.match(mutations, /inventory_recompute_layer_remaining/)
  assert.match(mutations, /effective_unit_cost_snapshot/)
})

test("release and reservation conversion restore or consume components", () => {
  assert.match(
    mutations,
    /create or replace function public\.inventory_release_allocations/,
  )
  assert.match(mutations, /quantity_remaining \+ v_component\.consumed_units/)
  assert.match(
    mutations,
    /create or replace function public\.inventory_convert_reservation_allocations/,
  )
  assert.match(mutations, /quantity_remaining - v_component\.consumed_units/)
  assert.match(mutations, /create or replace function public\.allocate_order_cost_layers/)
  assert.match(mutations, /project_order_cost_consumption_allocation/)
})

test("historical backfill is idempotent, shortage-backed, and audited", () => {
  assert.match(foundation, /day-component-overcapacity:/)
  assert.match(foundation, /'day_shortages', v_shortage_details/)
  assert.doesNotMatch(foundation, /day-component-overcapacity:' \|\| v_allocation\.id::text\s*\|\| ':'/)
  assert.match(foundation, /ambiguous_shared_ledger/)
  assert.match(foundation, /on conflict \(idempotency_key\) do nothing/)
  assert.match(foundation, /historical occ restated to frozen day-component cost/)
  assert.match(foundation, /inventory_cost_restatement_events_idempotency_idx/)
})

test("standalone, 2-day fallback, suppliers, and reads use component capacity", () => {
  assert.match(foundation, /when sold\.inventory_is_standalone/)
  assert.match(paths, /when '3_day' then 0 else 1/)
  assert.match(paths, /create or replace view public\.inventory_day_slot_availability/)
  assert.match(paths, /create or replace view public\.inventory_availability/)
  assert.match(paths, /create or replace view public\.deal_line_inventory_fulfilment/)
  assert.match(paths, /inventory_reassign_deal_line_to_supplier/)
  assert.match(paths, /admin_reassign_order_package_stock/)
  assert.match(paths, /inventory_allocate_quantity_from_layers/)
})

test("admin policy and stock-purchase contracts freeze atomically", () => {
  assert.match(
    adminContracts,
    /create or replace function public\.admin_set_inventory_group_cost_policy/,
  )
  assert.match(adminContracts, /manual_weights_must_total_one/)
  assert.match(
    adminContracts,
    /create or replace function public\.admin_add_cost_layer\([\s\S]*p_source_package_id text/,
  )
  assert.match(adminContracts, /source_package_not_compatible_with_ledger/)
  assert.match(adminContracts, /source_package_id,[\s\S]*source_package_origin/)
  assert.match(adminContracts, /perform public\.adjust_linked_inventory_available/)
})

test("historical, quantity, cost, and delete paths preserve component integrity", () => {
  assert.match(
    remainingMutations,
    /create or replace function public\.inventory_allocate_historical_quantity/,
  )
  assert.match(remainingMutations, /select public\.inventory_allocate_quantity\(/)
  assert.match(
    remainingMutations,
    /create or replace function public\.admin_update_cost_layer_quantity/,
  )
  assert.match(remainingMutations, /quantity_below_consumed_or_reserved/)
  assert.match(
    remainingMutations,
    /create or replace function public\.admin_update_cost_layer\(/,
  )
  assert.match(remainingMutations, /inventory_cost_restatement_events/)
  assert.match(remainingMutations, /on delete set null/)
  assert.match(mutations, /update public\.order_cost_consumptions[\s\S]*v_effective_unit_cost/)
})

test("manual order reassignment and cancellation release components exactly once", () => {
  assert.match(
    orderMutationSafety,
    /create or replace function public\.admin_set_order_cost_allocations/,
  )
  assert.match(orderMutationSafety, /admin_reassign_order_package_stock/)
  assert.match(
    orderMutationSafety,
    /create or replace function public\.admin_cancel_order/,
  )
  assert.match(
    orderMutationSafety,
    /create or replace function public\.admin_cancel_native_deal_order/,
  )
  assert.match(orderMutationSafety, /inventory_release_allocations/)
  assert.match(
    orderMutationSafety,
    /create or replace function public\._backfill_package_order_costs/,
  )
  assert.match(orderMutationSafety, /inventory_package_allocatable_quantity/)
  assert.match(orderMutationSafety, /perform public\.inventory_allocate_quantity\(/)
  assert.doesNotMatch(
    orderMutationSafety,
    /set quantity_remaining = quantity_remaining \+ v_cons\.quantity/,
  )
})

test("unused stock deletion preserves frozen component audit snapshots", () => {
  assert.match(stockDeletionSafety, /inventory\.component_stock_delete/)
  assert.match(
    stockDeletionSafety,
    /new\.cost_layer_id is null[\s\S]*old\.cost_layer_id is not null/,
  )
  assert.match(
    stockDeletionSafety,
    /create or replace function public\.admin_delete_cost_layer/,
  )
  assert.match(
    stockDeletionSafety,
    /perform set_config\('inventory\.component_stock_delete', 'on', true\)/,
  )
  assert.doesNotMatch(
    stockDeletionSafety,
    /delete from public\.(package_cost_layer_day_components|inventory_cost_restatement_events)/,
  )
})

test("stock deletion validates remaining purchase layers instead of stale counters", () => {
  assert.match(
    canonicalStockDeletion,
    /select coalesce\(sum\(layer\.quantity\), 0\)::int/,
  )
  assert.match(
    canonicalStockDeletion,
    /set qty_available = greatest\(qty_held, v_remaining_capacity\)/,
  )
  assert.doesNotMatch(
    canonicalStockDeletion,
    /v_qty_available - v_layer\.quantity/,
  )
  assert.match(canonicalStockDeletion, /layer_has_active_allocations/)
  assert.match(canonicalStockDeletion, /layer_already_consumed/)
})

test("historical PO lines use an audited fallback without weakening new purchases", () => {
  assert.match(
    historicalPurchaseFallback,
    /create or replace function public\.admin_add_purchase_order_cost_layer/,
  )
  assert.match(
    historicalPurchaseFallback,
    /coalesce\(purchase\.issued_at::timestamptz, purchase\.created_at\)[\s\S]*< timestamptz '2026-08-25 00:00:00\+00'/,
  )
  assert.match(
    historicalPurchaseFallback,
    /inventory\.allow_historical_cost_fallback/,
  )
  assert.match(
    historicalPurchaseFallback,
    /historical_equal_fallback/,
  )
  assert.match(
    historicalPurchaseFallback,
    /setup_reason = 'historical_purchase_day_prices_missing'/,
  )
  assert.doesNotMatch(
    historicalPurchaseFallback,
    /create or replace function public\.admin_add_cost_layer\(/,
  )
})

test("historical shortages immediately consume already available stock", () => {
  assert.match(
    shortageAutoCover,
    /create or replace function public\.cover_new_historical_shortage/,
  )
  assert.match(shortageAutoCover, /after insert on public\.inventory_shortages/)
  assert.match(
    shortageAutoCover,
    /perform public\.inventory_cover_historical_shortages\(/,
  )
  assert.match(shortageAutoCover, /shortage_type = 'historical_reconciliation'/)
  assert.match(shortageAutoCover, /and new\.status = 'open'/)
  assert.doesNotMatch(shortageAutoCover, /delete from public\.inventory_shortages/)
})

test("stock purchases need no day policy until linked child products exist", () => {
  assert.match(
    singleProductFallback,
    /create or replace function public\.freeze_new_cost_layer_day_components/,
  )
  assert.match(singleProductFallback, /sibling\.id <> source\.id/)
  assert.match(
    singleProductFallback,
    /exists \([\s\S]*from public\.inventory_package_day_slots\(sibling\.id\)/,
  )
  assert.match(
    singleProductFallback,
    /v_single_product_fallback := not coalesce\(v_has_linked_child, false\)/,
  )
  assert.match(singleProductFallback, /'single_product_equal'/)
  assert.match(
    singleProductFallback,
    /v_allow_historical_fallback or v_single_product_fallback/,
  )
})

test("purchase-order supplier identity is canonical for fulfilment pools", () => {
  assert.match(
    supplierPoolIdentity,
    /coalesce\(p_purchase_supplier_id, p_layer_supplier_id\)/,
  )
  assert.match(
    supplierPoolIdentity,
    /package_cost_layers_sync_supplier_from_po_trg/,
  )
  assert.match(
    supplierPoolIdentity,
    /purchase_orders_sync_cost_layer_supplier_trg/,
  )
  assert.match(
    supplierPoolIdentity,
    /inventory_layer_in_supplier_pool/,
  )
})

test("layer remaining is rebuilt from committed allocations", () => {
  assert.match(
    soldFollowsAllocations,
    /create or replace function public\.inventory_reconcile_layer_remaining_from_allocations/,
  )
  assert.match(
    soldFollowsAllocations,
    /allocation\.state = 'committed'/,
  )
  assert.match(
    soldFollowsAllocations,
    /create or replace function public\.inventory_reconcile_candidate_layers/,
  )
})

test("purchase quantity edits keep remaining <= quantity in the same write", () => {
  assert.match(
    quantityRemainingSync,
    /create or replace function public\.admin_update_cost_layer_quantity/,
  )
  assert.match(
    quantityRemainingSync,
    /set quantity = p_new_quantity,\s*quantity_remaining = quantity_remaining \+ v_delta/,
  )
  assert.match(
    quantityRemainingSync,
    /quantity_remaining \+ v_delta < v_reserved/,
  )
  assert.match(
    quantityRemainingSync,
    /if not coalesce\(v_has_components, false\) then/,
  )
  assert.doesNotMatch(
    quantityRemainingSync,
    /set quantity = p_new_quantity,\s*updated_at = timezone\('utc', now\(\)\)\s*where id = p_layer_id/,
  )
})

test("supplier stock queries disambiguate package_cost_layers to packages", () => {
  const profile = readFileSync(
    new URL("../lib/admin/supplier-profile.ts", import.meta.url),
    "utf8",
  )
  const directory = readFileSync(
    new URL("../app/(admin)/admin/suppliers/page.tsx", import.meta.url),
    "utf8",
  )
  assert.match(profile, /packages!package_id\(/)
  assert.match(directory, /packages!package_id\(/)
  assert.doesNotMatch(profile, /currency, packages\(/)
  assert.doesNotMatch(directory, /currency, packages\(/)
})
