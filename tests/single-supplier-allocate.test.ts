import assert from "node:assert/strict"
import { test } from "node:test"
import {
  allocatePartyPreferSingleSupplier,
  cogsFromTakes,
  summarizeSupplierTakes,
  type AllocatableSupplierLayer,
} from "../lib/inventory/single-supplier-allocate"

function layer(
  partial: Partial<AllocatableSupplierLayer> & Pick<AllocatableSupplierLayer, "id" | "available" | "supplier">,
): AllocatableSupplierLayer {
  return {
    unit_cost: 1000,
    currency: "USD",
    source: partial.supplier,
    purchase_order_id: null,
    fulfilment_block_id: null,
    received_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  }
}

test("keeps a party on one supplier when that pool can cover the order", () => {
  const layers = [
    layer({ id: "a", available: 4, supplier: "Formula 1", received_at: "2026-01-01" }),
    layer({ id: "b", available: 20, supplier: "P1", received_at: "2026-02-01" }),
  ]
  const takes = allocatePartyPreferSingleSupplier(layers, 10)
  assert.equal(takes.length, 1)
  assert.equal(takes[0].supplier, "P1")
  assert.equal(takes[0].quantity, 10)
  assert.equal(summarizeSupplierTakes(takes), "P1")
})

test("prefers a single fulfilment block over mixing suppliers", () => {
  const layers = [
    layer({
      id: "a",
      available: 5,
      supplier: "Formula 1",
      fulfilment_block_id: "block-1",
      received_at: "2026-01-01",
    }),
    layer({
      id: "b",
      available: 5,
      supplier: "P1",
      fulfilment_block_id: "block-1",
      received_at: "2026-01-02",
    }),
    layer({
      id: "c",
      available: 30,
      supplier: "Other",
      fulfilment_block_id: "block-2",
      received_at: "2026-01-03",
    }),
  ]
  const takes = allocatePartyPreferSingleSupplier(layers, 8)
  assert.deepEqual(
    takes.map((t) => t.supplier),
    ["Formula 1", "P1"],
  )
  assert.equal(takes.reduce((sum, t) => sum + t.quantity, 0), 8)
})

test("falls back to FIFO only when no single pool can cover the party", () => {
  const layers = [
    layer({ id: "a", available: 2, supplier: "Formula 1", received_at: "2026-01-01" }),
    layer({ id: "b", available: 2, supplier: "P1", received_at: "2026-02-01" }),
  ]
  const takes = allocatePartyPreferSingleSupplier(layers, 3)
  assert.equal(takes[0].supplier, "Formula 1")
  assert.equal(takes[0].quantity, 2)
  assert.equal(takes[1].supplier, "P1")
  assert.equal(takes[1].quantity, 1)
  assert.equal(cogsFromTakes(takes), 3000)
})
