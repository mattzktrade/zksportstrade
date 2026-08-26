import assert from "node:assert/strict"
import { test } from "node:test"
import { resolveSoldByCostLayer } from "../lib/inventory/sold-by-cost-layer"

const unknown = {
  id: "legacy",
  quantity: 40,
  quantity_remaining: 1,
  received_at: "2026-05-15T00:00:00.000Z",
}
const f1 = {
  id: "f1",
  quantity: 40,
  quantity_remaining: 40,
  received_at: "2026-08-20T00:00:00.000Z",
}

test("without fulfilment, sold FIFO onto the oldest leftover layer", () => {
  const sold = resolveSoldByCostLayer({
    layers: [unknown, f1],
    totalPackageSold: 40,
  })
  assert.equal(sold.get("legacy"), 40)
  assert.equal(sold.get("f1"), 0)
})

test("fulfilment assignment moves sold onto the chosen purchase", () => {
  const sold = resolveSoldByCostLayer({
    layers: [unknown, f1],
    fulfilmentSoldByLayer: new Map([["f1", 40]]),
    totalPackageSold: 40,
  })
  assert.equal(sold.get("legacy"), 0)
  assert.equal(sold.get("f1"), 40)
})

test("fully allocated later purchases leave the oldest imported lot unsold", () => {
  const bamA = {
    id: "bam-a",
    quantity: 10,
    quantity_remaining: 2,
    received_at: "2026-08-20T00:00:00.000Z",
  }
  const bamB = {
    id: "bam-b",
    quantity: 4,
    quantity_remaining: 0,
    received_at: "2026-08-20T00:00:00.000Z",
  }
  const sold = resolveSoldByCostLayer({
    layers: [unknown, bamA, bamB],
    fulfilmentSoldByLayer: new Map([
      ["bam-a", 10],
      ["bam-b", 4],
    ]),
    totalPackageSold: 14,
  })
  assert.equal(sold.get("legacy"), 0)
  assert.equal(sold.get("bam-a"), 10)
  assert.equal(sold.get("bam-b"), 4)
})

test("does not invent supplier stock when sold exceeds purchased", () => {
  const sold = resolveSoldByCostLayer({
    layers: [f1],
    fulfilmentSoldByLayer: new Map([["f1", 42]]),
    totalPackageSold: 42,
  })
  assert.equal(sold.get("f1"), 40)
})
