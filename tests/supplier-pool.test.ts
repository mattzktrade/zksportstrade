import assert from "node:assert/strict"
import test from "node:test"
import {
  costLayerSupplierPoolKey,
  effectiveCostLayerSupplierId,
  groupSupplierPoolOptions,
} from "../lib/inventory/supplier-pool"

test("purchase-order supplier wins over a stale cost-layer supplier id", () => {
  assert.equal(
    effectiveCostLayerSupplierId({
      layerSupplierId: "bam-id",
      purchaseSupplierId: "abc-id",
    }),
    "abc-id",
  )
  assert.equal(
    costLayerSupplierPoolKey({
      layerSupplierId: "bam-id",
      purchaseSupplierId: "abc-id",
      purchaseSupplier: "abc ltd",
      layerSource: "abc ltd",
    }),
    "id:abc-id",
  )
})

test("renaming imported stock to another company splits it from the original supplier pool", () => {
  const bamId = "11111111-1111-1111-1111-111111111111"
  const abcId = "22222222-2222-2222-2222-222222222222"
  const pools = groupSupplierPoolOptions(
    [
      {
        id: "abc-layer",
        quantity: 10,
        quantity_remaining: 0,
        supplier_id: bamId,
        purchase_order_id: "abc-po",
        source: "abc ltd",
      },
      {
        id: "bam-10",
        quantity: 10,
        quantity_remaining: 6,
        supplier_id: bamId,
        purchase_order_id: "bam-po-1",
        source: "BAM Motorsport",
      },
      {
        id: "bam-2a",
        quantity: 2,
        quantity_remaining: 2,
        supplier_id: bamId,
        purchase_order_id: "bam-po-1",
        source: "BAM Motorsport",
      },
      {
        id: "bam-2b",
        quantity: 2,
        quantity_remaining: 2,
        supplier_id: bamId,
        purchase_order_id: "bam-po-2",
        source: "BAM Motorsport",
      },
    ],
    [
      { id: "abc-po", supplier: "abc ltd", supplier_id: abcId },
      { id: "bam-po-1", supplier: "BAM Motorsport", supplier_id: bamId },
      { id: "bam-po-2", supplier: "BAM Motorsport", supplier_id: bamId },
    ],
    ["unit"],
  )

  assert.equal(pools.length, 2)
  const abc = pools.find((pool) => pool.name === "abc ltd")
  const bam = pools.find((pool) => pool.name === "BAM Motorsport")
  assert.equal(abc?.purchased, 10)
  assert.equal(abc?.key, `id:${abcId}`)
  assert.equal(bam?.purchased, 14)
  assert.equal(bam?.key, `id:${bamId}`)
  assert.equal(bam?.purchaseCount, 3)
})

test("layers that still share one supplier company stay in one pool", () => {
  const bamId = "11111111-1111-1111-1111-111111111111"
  const pools = groupSupplierPoolOptions(
    [
      {
        id: "a",
        quantity: 10,
        quantity_remaining: 6,
        supplier_id: bamId,
        purchase_order_id: "po-1",
        source: "BAM Motorsport",
      },
      {
        id: "b",
        quantity: 4,
        quantity_remaining: 4,
        supplier_id: bamId,
        purchase_order_id: "po-2",
        source: "BAM Motorsport",
      },
    ],
    [
      { id: "po-1", supplier: "BAM Motorsport", supplier_id: bamId },
      { id: "po-2", supplier: "BAM Motorsport", supplier_id: bamId },
    ],
    ["unit"],
  )
  assert.equal(pools.length, 1)
  assert.equal(pools[0]?.purchased, 14)
})
