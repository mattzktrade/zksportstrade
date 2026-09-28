import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { summarizeOrderCost, type CostConsumptionRow } from "../lib/admin/cost-layers"
import {
  countPurchaseOrdersAwaitingBuyPrice,
  isPurchaseOrderBuyPriceFilter,
  purchaseOrderBuyPriceState,
} from "../lib/admin/purchase-order-buy-price"

function consumption(overrides: Partial<CostConsumptionRow> = {}): CostConsumptionRow {
  return {
    id: "consumption-1",
    order_id: "order-1",
    cost_layer_id: "layer-1",
    package_id: "package-1",
    quantity: 2,
    unit_cost: 100,
    currency: "GBP",
    supplier_source_snapshot: null,
    fulfilment_block_snapshot: null,
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  }
}

test("a purchase order awaits a buy price only while a zero is unconfirmed", () => {
  assert.equal(purchaseOrderBuyPriceState([{ unitCost: 250 }]), "recorded")
  assert.equal(purchaseOrderBuyPriceState([{ unitCost: 250 }, { unitCost: 0 }]), "awaiting")
  assert.equal(
    purchaseOrderBuyPriceState([{ unitCost: 250 }, { unitCost: 0, unitCostConfirmed: true }]),
    "confirmed",
  )
  assert.equal(
    purchaseOrderBuyPriceState([
      { unitCost: 0, unitCostConfirmed: true },
      { unitCost: 0, unitCostConfirmed: false },
    ]),
    "awaiting",
  )
  assert.equal(
    countPurchaseOrdersAwaitingBuyPrice([
      { lines: [{ unitCost: 10 }] },
      { lines: [{ unitCost: 0 }] },
      { lines: [{ unitCost: 0, unitCostConfirmed: true }] },
    ]),
    1,
  )
  assert.equal(isPurchaseOrderBuyPriceFilter("awaiting"), true)
  assert.equal(isPurchaseOrderBuyPriceFilter("recorded"), false)
})

test("profit and loss includes a confirmed zero buy price and excludes an unconfirmed zero", () => {
  const unconfirmed = summarizeOrderCost("GBP", [consumption({ unit_cost: 0 })], 2)
  assert.equal(unconfirmed.cost_known, false)
  assert.equal(unconfirmed.cogs, null)

  const confirmed = summarizeOrderCost(
    "GBP",
    [consumption({ unit_cost: 0, unit_cost_confirmed: true })],
    2,
  )
  assert.equal(confirmed.cost_known, true)
  assert.equal(confirmed.cogs, 0)

  const mixed = summarizeOrderCost(
    "GBP",
    [
      consumption({ id: "a", unit_cost: 40, quantity: 1 }),
      consumption({ id: "b", unit_cost: 0, quantity: 1 }),
    ],
    2,
  )
  assert.equal(mixed.cost_known, false)

  const priced = summarizeOrderCost("GBP", [consumption({ unit_cost: 40 })], 2)
  assert.equal(priced.cost_known, true)
  assert.equal(priced.cogs, 80)
})

test("buy price confirmation is stored on the cost layer and exposed on the purchase order", () => {
  const sql = readFileSync(
    "supabase/migrations/20260928140000_cost_layer_buy_price_confirmed.sql",
    "utf8",
  )
  const page = readFileSync("app/(admin)/admin/purchase-orders/page.tsx", "utf8")
  const client = readFileSync("app/(admin)/admin/purchase-orders/purchase-orders-client.tsx", "utf8")
  assert.match(sql, /unit_cost_confirmed boolean not null default false/)
  assert.match(sql, /admin_set_purchase_order_buy_price_confirmed/)
  assert.match(sql, /and unit_cost = 0/)
  assert.match(page, /initialBuyPrice/)
  assert.match(client, /Confirmed buy price/)
  assert.match(client, /setPurchaseOrderBuyPriceConfirmed/)
})
