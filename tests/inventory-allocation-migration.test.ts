import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const sql = readFileSync(
  new URL("../supabase/migrations/20260824130000_inventory_allocation_integrity.sql", import.meta.url),
  "utf8",
).toLowerCase()
const historicalSql = readFileSync(
  new URL("../supabase/migrations/20260824140000_historical_reconciliation_capacity.sql", import.meta.url),
  "utf8",
).toLowerCase()
const batchSql = readFileSync(
  new URL(
    "../supabase/migrations/20260824150000_historical_reconciliation_batch_performance.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase()

test("canonical allocation schema is additive, constrained, and audited", () => {
  assert.match(sql, /create table if not exists public\.inventory_allocations/)
  assert.match(sql, /create table if not exists public\.inventory_shortages/)
  assert.match(sql, /create table if not exists public\.inventory_allocation_events/)
  assert.match(sql, /inventory_allocations_state_check/)
  assert.match(sql, /inventory_allocations_idempotency_unique_idx/)
  assert.match(sql, /inventory_allocation_events_append_only_trg/)
  assert.match(sql, /inventory_allocations_capacity_constraint_trg/)
  assert.match(sql, /deferrable initially deferred/)
  assert.match(sql, /inventory_set_allocation_enforcement/)
})

test("allocator locks layers, prefers one source, and refuses unpurchased stock", () => {
  assert.match(sql, /for update/)
  assert.match(sql, /v_preferred_block/)
  assert.match(sql, /v_preferred_po/)
  assert.match(sql, /v_preferred_supplier/)
  assert.match(sql, /v_preferred_source/)
  assert.match(sql, /raise exception 'insufficient_purchased_stock/)
  assert.doesNotMatch(
    sql,
    /new\.cost_layer_id is null then\s+insert into public\.inventory_shortages/,
  )
})

test("reservations, orders, cancellation, and fulfilment use compatibility guards", () => {
  assert.match(sql, /inventory_reservations_allocation_projection_trg/)
  assert.match(sql, /order_cost_consumptions_inventory_projection_trg/)
  assert.match(sql, /order_cost_consumptions_lock_guard_trg/)
  assert.match(sql, /supplier_fulfilment_allocation_lock_trg/)
  assert.match(sql, /inventory_convert_reservation_allocations/)
  assert.match(sql, /inventory_release_allocations/)
})

test("historical reconciliation supports preview, apply, shortages, and purchase clearing", () => {
  assert.match(sql, /inventory_reconcile_historical_won/)
  assert.match(sql, /inventory_reconcile_historical_inventory/)
  assert.match(sql, /p_apply boolean default false/)
  assert.match(sql, /historical_reconciliation/)
  assert.match(sql, /package_cost_layers_cover_shortages_trg/)
  assert.match(sql, /inventory_cover_historical_shortages/)
  assert.match(historicalSql, /inventory_historical_allocatable_quantity/)
  assert.match(historicalSql, /inventory_allocate_historical_quantity/)
  assert.match(historicalSql, /layer\.quantity - coalesce/)
  assert.match(historicalSql, /least\(\s*layer\.quantity_remaining/)
  assert.match(historicalSql, /v_capacity - v_prior_pending/)
  assert.match(batchSql, /inventory_apply_historical_deal/)
  assert.match(batchSql, /sum\(line\.quantity\) over/)
  assert.match(batchSql, /remaining_deal_count/)
  assert.match(batchSql, /least\(coalesce\(p_limit, 25\), 25\)/)
})

test("canonical view exposes an explainable stock equation", () => {
  assert.match(sql, /create or replace view public\.inventory_availability/)
  for (const field of [
    "layer_original_quantity",
    "layer_quantity_remaining",
    "reserved_quantity",
    "manual_hold_quantity",
    "committed_quantity",
    "available_quantity",
    "historical_shortage_quantity",
    "brokered_shortage_quantity",
  ]) {
    assert.match(sql, new RegExp(`\\b${field}\\b`))
  }
})
