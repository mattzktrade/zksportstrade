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
