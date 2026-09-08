import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const sql = readFileSync(
  "supabase/migrations/20260904130000_uncovered_signed_deal_shortages.sql",
  "utf8",
).toLowerCase()

test("signed uncovered deals are recorded as purchase shortages", () => {
  assert.match(sql, /inventory_sync_deal_line_shortage/)
  assert.match(sql, /uncovered-deal-line:/)
  assert.match(sql, /uncovered_signed_deal/)
  assert.match(sql, /historical_reconciliation/)
})

test("unsigned owned lines clear uncovered shortages instead of leaving them on the buy list", () => {
  assert.match(
    sql,
    /idempotency_key = 'uncovered-deal-line:' \|\| v_line\.id::text;\s*return;/,
  )
})

test("brokered quotes survive reassignment and unsigned stock holds can be created", () => {
  assert.doesNotMatch(
    sql,
    /set supplier_id = null, fulfilment_cost_layer_id = null,\s*expected_unit_cost = null/,
  )
  assert.match(sql, /if v_inventory.sellable >= v_line.quantity then/)
  assert.match(sql, /sqlerrm like 'insufficient_purchased_stock%'/)
})

test("native deal orders record a shortage instead of blocking when stock is missing", () => {
  assert.match(sql, /v_channel = 'native_deal'/)
  assert.match(sql, /inventory_sync_deal_line_shortage\(v_deal_line_id\)/)
  assert.match(
    sql,
    /revoke all on function public\.allocate_order_cost_layers\(uuid, text, int, text\)\s+from authenticated/,
  )
})

test("existing signed shortages are backfilled without duplicating historical rows", () => {
  assert.match(sql, /perform public.inventory_sync_deal_line_shortage\(v_line.id\)/)
  assert.match(sql, /and shortage.shortage_type = 'historical_reconciliation'/)
})

const adoptSql = readFileSync(
  "supabase/migrations/20260908120000_adopt_brokered_lines_onto_purchased_stock.sql",
  "utf8",
).toLowerCase()
const orderTable = readFileSync("components/admin/package-orders-table.tsx", "utf8")
const dealEditActions = readFileSync(
  "app/(admin)/admin/deals/deal-edit-actions.ts",
  "utf8",
)

test("assigning purchased stock to a signed brokered deal converts it to owned", () => {
  assert.match(adoptSql, /v_was_brokered := coalesce\(v_line.sourcing_mode, 'owned'\) = 'brokered'/)
  assert.match(adoptSql, /set sourcing_mode = 'owned'/)
  assert.match(adoptSql, /adopted_from_brokered/)
  assert.match(
    adoptSql,
    /coalesce\(line.sourcing_mode, 'owned'\) in \('owned', 'brokered'\)/,
  )
  assert.match(dealEditActions, /toPurchasedSupplierPoolKey/)
  assert.match(dealEditActions, /inventory_reassign_deal_line_to_supplier/)
})

test("sales list shows a supplier dropdown for signed brokered deals", () => {
  assert.match(orderTable, /dealLineCanTakePurchasedSupplier/)
  assert.match(orderTable, /assign a purchased supplier to take it from buys/)
  assert.doesNotMatch(orderTable, /Brokered supplier/)
})
