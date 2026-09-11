import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const sql = readFileSync(
  "supabase/migrations/20260911160000_prevent_deal_line_overallocation.sql",
  "utf8",
).toLowerCase()

test("allocator refuses to commit more units than the deal line sold", () => {
  assert.match(sql, /inventory_deal_line_live_quantity/)
  assert.match(sql, /v_line_live >= v_line_qty/)
  assert.match(sql, /v_needed := least\(v_needed, v_line_qty - v_line_live\)/)
  assert.match(sql, /deal_line_overallocated/)
  assert.match(
    sql,
    /inventory_allocations_no_deal_line_overalloc_trg/,
  )
})

test("order conversion and cost backfill reuse existing deal allocations", () => {
  assert.match(sql, /inventory_link_deal_line_allocations_to_order/)
  assert.match(sql, /v_live >= p_guests then/)
  assert.match(sql, /v_line_live >= v_order.quantity then/)
  assert.match(
    sql,
    /where request_key = btrim\(p_request_key\)\s+and state in \('reserved', 'committed'\)/,
  )
  assert.match(sql, /gen_random_uuid\(\)::text/)
})

test("existing double allocations are trimmed then uncovered signed lines are filled", () => {
  assert.match(sql, /inventory_trim_deal_line_overallocation/)
  assert.match(sql, /inventory_allocate_deal_line_remainder/)
  assert.match(sql, /deal_line_supplier_pool_reassignment/)
  assert.match(sql, /migration:20260911160000:/)
  assert.match(sql, /inventory_cover_historical_shortages/)
})

test("marking a signed deal paid fills the remainder instead of releasing covering stock", () => {
  assert.match(sql, /if v_allocated > v_line.quantity then/)
  assert.match(sql, /inventory_allocate_deal_line_remainder\(v_line.id\)/)
  assert.match(
    sql,
    /fill uncovered signed deal quantity without releasing existing stock/,
  )
})
