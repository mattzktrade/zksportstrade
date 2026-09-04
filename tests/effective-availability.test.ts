import assert from "node:assert/strict"
import test from "node:test"
import {
  adminPackageNetQuantity,
  adminPackageSellable,
  adminPackageSoldQuantity,
} from "../lib/inventory/effective-availability"

test("does not expose purchased stock already consumed by reported sales", () => {
  assert.equal(
    adminPackageSellable({
      inventory: { qty_available: 12, qty_held: 0 },
      sales_breakdown: { total: 12, salesforceOpenPipeline: 0 },
      canonical_availability: { bought: 12, available: 0, net: 0 },
    }),
    0,
  )
})

test("uses canonical sellable as the single source when present", () => {
  assert.equal(
    adminPackageSellable({
      inventory: { qty_available: 8, qty_held: 1 },
      sales_breakdown: { total: 3, salesforceOpenPipeline: 1 },
      canonical_availability: { bought: 10, available: 9, net: 9 },
    }),
    9,
  )
})

test("never exposes physical stock reserved for an open shortage", () => {
  assert.equal(
    adminPackageSellable({
      canonical_availability: { bought: 28, available: 2, net: 0 },
      sales_breakdown: { total: 28, salesforceOpenPipeline: 0 },
    }),
    0,
  )
})

test("uses the unified linked display balance across admin screens", () => {
  assert.equal(
    adminPackageSellable({
      inventory: { qty_available: 0, qty_held: 0 },
      canonical_availability: { bought: 26, available: 0, net: 0 },
      effective_sellable: 24,
      effective_net: 24,
    }),
    24,
  )
  assert.equal(
    adminPackageNetQuantity({
      canonical_availability: { bought: 26, available: 0, net: 0 },
      effective_sellable: 24,
      effective_net: 24,
    }),
    24,
  )
})

test("exposes a signed canonical balance for operational stock displays", () => {
  assert.equal(
    adminPackageNetQuantity({
      inventory: { qty_available: 2, qty_held: 0 },
      canonical_availability: { bought: 2, available: 0, net: -1 },
    }),
    -1,
  )
})

test("admin net quantity stays negative when sold exceeds purchased stock", () => {
  assert.equal(
    adminPackageNetQuantity({
      sales_breakdown: { total: 4, salesforceOpenPipeline: 0 },
      layer_units_purchased: 0,
      effective_net: -4,
    }),
    -4,
  )
})

test("total sold comes only from confirmed channel sales, not shortages", () => {
  assert.equal(
    adminPackageSoldQuantity({
      sales_breakdown: { total: 42, salesforceOpenPipeline: 3 },
      canonical_availability: { bought: 40, available: 0, net: -2 },
    }),
    42,
  )
})

test("falls back to compatibility inventory before canonical rollout", () => {
  assert.equal(
    adminPackageSellable({
      inventory: { qty_available: 5, qty_held: 2 },
    }),
    3,
  )
})

test("uses purchased minus sold when a cached row lacks canonical availability", () => {
  assert.equal(
    adminPackageSellable({
      inventory: { qty_available: 12, qty_held: 0 },
      layer_units_purchased: 12,
      sales_breakdown: { total: 12, salesforceOpenPipeline: 0 },
    }),
    0,
  )
})
