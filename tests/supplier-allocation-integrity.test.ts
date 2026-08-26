import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  "supabase/migrations/20260824190000_supplier_assignments_require_allocated_stock.sql",
  "utf8",
).toLowerCase()
const orderTable = readFileSync(
  "components/admin/package-orders-table.tsx",
  "utf8",
)
const packageDealsQuery = readFileSync("lib/crm/deals.ts", "utf8")
const shortageResolutionMigration = readFileSync(
  "supabase/migrations/20260824200000_resolve_historical_shortage_without_zero_quantity.sql",
  "utf8",
).toLowerCase()
const deletedDemandMigration = readFileSync(
  "supabase/migrations/20260824210000_release_deleted_deal_inventory.sql",
  "utf8",
).toLowerCase()
const allocationAuditMigration = readFileSync(
  "supabase/migrations/20260824220000_preserve_allocation_audit_on_stock_delete.sql",
  "utf8",
).toLowerCase()
const sharedLedgerDeleteMigration = readFileSync(
  "supabase/migrations/20260824230000_restore_shared_ledger_delete_helper.sql",
  "utf8",
).toLowerCase()
const dealReallocationMigration = readFileSync(
  "supabase/migrations/20260824240000_reallocate_confirmed_deal_product_changes.sql",
  "utf8",
).toLowerCase()
const emptyPurchaseOrderMigration = readFileSync(
  "supabase/migrations/20260824260000_delete_empty_purchase_order_with_cost_layer.sql",
  "utf8",
).toLowerCase()
const dealConfirmationMigration = readFileSync(
  "supabase/migrations/20260824270000_allocate_inventory_on_deal_confirmation.sql",
  "utf8",
).toLowerCase()
const supplierSwapMigration = readFileSync(
  "supabase/migrations/20260824280000_batch_swap_deal_suppliers.sql",
  "utf8",
).toLowerCase()
const supplierPoolMigration = readFileSync(
  "supabase/migrations/20260825100000_supplier_pool_deal_reassignment.sql",
  "utf8",
).toLowerCase()
const supplierPoolIdentityMigration = readFileSync(
  "supabase/migrations/20260825220000_purchase_order_supplier_pool_identity.sql",
  "utf8",
).toLowerCase()
const costLayerUi = readFileSync("components/admin/package-cost-layers.tsx", "utf8")
const fulfilmentSoldLoader = readFileSync("lib/inventory/fulfilment-layer-sold.ts", "utf8")
const signedStockHoldMigration = readFileSync(
  "supabase/migrations/20260826130000_signed_deals_hold_purchased_stock.sql",
  "utf8",
).toLowerCase()
const singleSupplierRepackMigration = readFileSync(
  "supabase/migrations/20260826140000_single_supplier_repack_allocations.sql",
  "utf8",
).toLowerCase()
const dealPartyRepackMigration = readFileSync(
  "supabase/migrations/20260826150000_repack_deals_not_lines.sql",
  "utf8",
).toLowerCase()
const incrementalDealLineMigration = readFileSync(
  "supabase/migrations/20260826160000_incremental_signed_deal_line_allocation.sql",
  "utf8",
).toLowerCase()
const allocationEngine = readFileSync("lib/inventory/allocation-engine.ts", "utf8")

test("supplier fulfilment is projected only from fully allocated purchased stock", () => {
  assert.match(migration, /create or replace view public\.deal_line_inventory_fulfilment/)
  assert.match(migration, /allocation\.state in \('reserved', 'committed'\)/)
  assert.match(migration, /allocated_quantity[\s\S]*>= line\.quantity as fully_allocated/)
  assert.match(migration, /when v_fulfilment\.fully_allocated then v_fulfilment\.supplier_id/)
})

test("new allocations resync supplier projection and legacy guesser is retired", () => {
  assert.match(migration, /drop trigger if exists deal_line_items_auto_assign_supplier/)
  assert.match(migration, /inventory_allocations_sync_deal_supplier_trg/)
  assert.doesNotMatch(orderTable, /allocatePartyPreferSingleSupplier/)
})

test("fully covered shortages stay positive and become resolved", () => {
  assert.match(
    shortageResolutionMigration,
    /when v_fully_covered then quantity[\s\S]*else quantity - v_take/,
  )
  assert.match(
    shortageResolutionMigration,
    /status = case when v_fully_covered then 'resolved'/,
  )
})

test("deleting a deal releases its mutable canonical stock allocation", () => {
  assert.match(
    deletedDemandMigration,
    /inventory_release_allocations\([\s\S]*'deal deleted'[\s\S]*true/,
  )
  assert.match(
    deletedDemandMigration,
    /update public\.inventory_shortages[\s\S]*status = 'cancelled'/,
  )
})

test("unused stock deletion releases only orphaned mutable allocations", () => {
  assert.match(deletedDemandMigration, /allocation\.lock_state = 'mutable'/)
  assert.match(deletedDemandMigration, /allocation\.deal_id is null/)
  assert.match(deletedDemandMigration, /raise exception 'layer_has_active_allocations'/)
})

test("stock deletion preserves released allocations and append-only events", () => {
  assert.match(allocationAuditMigration, /on delete set null/)
  assert.match(
    allocationAuditMigration,
    /check \(state = 'released' or cost_layer_id is not null\)/,
  )
  assert.doesNotMatch(
    allocationAuditMigration,
    /delete from public\.inventory_allocation_events/,
  )
  assert.doesNotMatch(
    allocationAuditMigration,
    /delete from public\.inventory_allocations/,
  )
})

test("stock deletion installs its shared-ledger dependency explicitly", () => {
  assert.match(
    sharedLedgerDeleteMigration,
    /create or replace function public\.package_uses_shared_three_day_ledger/,
  )
  assert.match(sharedLedgerDeleteMigration, /split\.duration is distinct from '3_day'/)
})

test("deleting a product's final cost layer removes its empty purchase order", () => {
  assert.match(
    emptyPurchaseOrderMigration,
    /perform public\.admin_delete_cost_layer\(p_layer_id\)/,
  )
  assert.match(
    emptyPurchaseOrderMigration,
    /not exists \([\s\S]*from public\.package_cost_layers[\s\S]*purchase_order_id = v_purchase_order_id/,
  )
  assert.match(
    emptyPurchaseOrderMigration,
    /delete from public\.purchase_orders[\s\S]*id = v_purchase_order_id/,
  )
})

test("confirming a deal atomically allocates its lines and supplier", () => {
  assert.match(
    dealConfirmationMigration,
    /after update of stage on public\.deals/,
  )
  assert.match(
    dealConfirmationMigration,
    /old\.stage in \('paid_confirmed', 'in_fulfilment', 'fulfilled'\)/,
  )
  assert.match(
    dealConfirmationMigration,
    /perform public\.inventory_reassign_deal_line\(v_line\.id, null\)/,
  )
  assert.match(
    dealConfirmationMigration,
    /allocated\.quantity < line\.quantity/,
  )
})

test("signed deals hold purchased stock before payment", () => {
  assert.match(signedStockHoldMigration, /deal_stage_holds_purchased_stock/)
  assert.match(signedStockHoldMigration, /'signed'/)
  assert.match(signedStockHoldMigration, /'awaiting_invoice'/)
  assert.match(signedStockHoldMigration, /'awaiting_payment'/)
  assert.match(
    signedStockHoldMigration,
    /not public\.deal_stage_holds_purchased_stock\(v_deal\.stage\)/,
  )
  assert.match(
    signedStockHoldMigration,
    /and public\.deal_stage_holds_purchased_stock\(deal\.stage\)/,
  )
  assert.match(
    signedStockHoldMigration,
    /and deal\.order_id is null/,
  )
  assert.match(
    signedStockHoldMigration,
    /v_old_holds and v_new_holds/,
  )
})

test("automatic allocation reshuffles earlier deals to keep one supplier", () => {
  assert.match(
    singleSupplierRepackMigration,
    /create or replace function public\.inventory_repack_mutable_deal_allocations/,
  )
  assert.match(
    singleSupplierRepackMigration,
    /inventory_search_single_supplier_pack/,
  )
  assert.match(
    dealPartyRepackMigration,
    /update _inv_pack_state set nodes = nodes \+ 1 where true/,
  )
  assert.match(
    dealPartyRepackMigration,
    /group by deal\.id, deal\.created_at/,
  )
  assert.match(
    dealPartyRepackMigration,
    /case when supplier\.supplier_key = any\(v_used\) then 0 else 1 end/,
  )
  assert.match(
    orderTable,
    /Split across \$\{Math\.max\(selectedKeys\.length, 2\)\} suppliers/,
  )
  assert.match(
    allocationEngine,
    /Later parties in the input \(newer deals\) win ties/,
  )
})

test("signed deal line edits allocate the changed line without a package reshuffle", () => {
  assert.match(
    incrementalDealLineMigration,
    /create or replace function public\.inventory_reassign_deal_line/,
  )
  assert.match(
    incrementalDealLineMigration,
    /preferred_existing_deal_supplier/,
  )
  assert.match(
    incrementalDealLineMigration,
    /perform public\.inventory_allocate_quantity_from_layers/,
  )
  assert.doesNotMatch(
    incrementalDealLineMigration,
    /perform public\.inventory_repack_mutable_deal_allocations/,
  )
  assert.match(
    incrementalDealLineMigration,
    /inventory_signed_deal_line_allocation_mode/,
  )
})

test("zero-remaining suppliers can be swapped without temporary overselling", () => {
  assert.match(
    supplierSwapMigration,
    /perform public\.inventory_release_allocations\(/,
  )
  assert.match(
    supplierSwapMigration,
    /perform public\.inventory_reassign_deal_line\([\s\S]*v_assignment\.cost_layer_id/,
  )
  assert.match(
    supplierSwapMigration,
    /for update of line/,
  )
  assert.match(orderTable, /costLayers\.map\(\(layer\)/)
  assert.match(orderTable, /Save supplier change/)
})

test("unconfirmed deals cannot block or save paid supplier assignments", () => {
  assert.match(orderTable, /dealStageHoldsPurchasedStock\(deal\.stage\)/)
  assert.match(orderTable, /dealProjectsSupplierConsumption/)
  assert.match(orderTable, /dealStageIsOpenPipeline/)
  assert.match(orderTable, /Not complete — do not fulfil/)
  assert.match(orderTable, /do not take[\s\S]*purchased stock/)
  assert.match(orderTable, /saleFilter === "incomplete"/)
  assert.match(orderTable, /Search company, contact or reference/)
  assert.match(
    orderTable,
    /if \(!dealProjectsSupplierConsumption\(deal\)\) continue/,
  )
  const dealEditActions = readFileSync(
    "app/(admin)/admin/deals/deal-edit-actions.ts",
    "utf8",
  )
  assert.match(dealEditActions, /dealStageHoldsPurchasedStock/)
  assert.match(
    dealEditActions,
    /Supplier can only be assigned once a deal is signed/,
  )
})

test("deal supplier choices aggregate purchase layers and allocate them FIFO", () => {
  assert.match(orderTable, /groupSupplierPoolOptions/)
  assert.match(orderTable, /Balances update before anything[\s\S]*is saved/)
  assert.match(orderTable, /supplier\.purchased[\s\S]*assigned[\s\S]*balanced/)
  assert.match(orderTable, /projectedUnassigned/)
  assert.match(orderTable, /!supplierChangesBalanced/)
  assert.match(packageDealsQuery, /from\("inventory_allocations"\)/)
  assert.match(packageDealsQuery, /supplierAllocations/)
  assert.match(
    supplierPoolMigration,
    /inventory_reassign_deal_line_to_supplier/,
  )
  assert.match(
    supplierPoolMigration,
    /order by layer\.received_at, layer\.id/,
  )
  assert.match(
    supplierPoolMigration,
    /layer\.quantity_remaining - public\.inventory_layer_reserved_quantity/,
  )
  assert.match(
    supplierPoolMigration,
    /value->>'supplierkey'/,
  )
})

test("renamed purchase orders leave the old supplier pool instead of pooling by stale layer id", () => {
  assert.match(
    supplierPoolIdentityMigration,
    /create or replace function public\.inventory_layer_effective_supplier_id/,
  )
  assert.match(
    supplierPoolIdentityMigration,
    /select coalesce\(p_purchase_supplier_id, p_layer_supplier_id\)/,
  )
  assert.match(
    supplierPoolIdentityMigration,
    /when p_supplier_id is not null then/,
  )
  assert.match(
    supplierPoolIdentityMigration,
    /public\.inventory_layer_in_supplier_pool\(/,
  )
  assert.match(
    supplierPoolIdentityMigration,
    /purchase_orders_sync_cost_layer_supplier_trg/,
  )
  assert.match(
    supplierPoolIdentityMigration,
    /set supplier_id = purchase\.supplier_id/,
  )
  assert.doesNotMatch(
    supplierPoolIdentityMigration
      .split("when p_supplier_id is not null then")[1]
      ?.split("else")[0] ?? "",
    /or lower\(btrim/,
  )
})

test("deal product changes reject stale allocations from the previous package", () => {
  assert.match(
    dealReallocationMigration,
    /allocation_line\.package_id = allocation\.package_id/,
  )
  assert.match(
    dealReallocationMigration,
    /after update of package_id, quantity, sourcing_mode/,
  )
  assert.match(
    dealReallocationMigration,
    /inventory_reassign_deal_line\(new\.id, null\)/,
  )
})

test("manual supplier changes move canonical stock atomically", () => {
  assert.match(
    dealReallocationMigration,
    /p_preferred_cost_layer_id uuid default null/,
  )
  assert.match(
    dealReallocationMigration,
    /'deal_line_supplier_reassignment'/,
  )
  assert.match(
    dealReallocationMigration,
    /raise exception 'insufficient_supplier_stock'/,
  )
})

test("removing a deal product releases its inventory first", () => {
  assert.match(
    dealReallocationMigration,
    /before delete on public\.deal_line_items/,
  )
  assert.match(
    dealReallocationMigration,
    /'deal product removed'/,
  )
})

test("inventory sold follows committed allocations instead of leftover FIFO remaining", () => {
  assert.match(fulfilmentSoldLoader, /from\("inventory_allocations"\)/)
  assert.match(fulfilmentSoldLoader, /inventory_reconcile_candidate_layers/)
  assert.match(costLayerUi, /resolveSoldByCostLayer/)
  assert.doesNotMatch(costLayerUi, /targetLayerRemaining/)
})
