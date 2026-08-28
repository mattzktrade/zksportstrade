import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import {
  applyEffectiveSellable,
  commitmentSellable,
  emptyPackageSalesBreakdown,
  formatPackageSalesBreakdown,
  linkedPoolAttributedPipeline,
  linkedPoolAttributedSold,
  linkedPoolSellableForPackage,
  unsignedPipelinePlaces,
  type EffectiveSellablePackage,
  type LinkedSellableMember,
  type PackageSalesBreakdown,
} from "../lib/admin/package-sales-breakdown"
import { computeLinkedStockSourceAttributedSold } from "../lib/integrations/salesforce/stock-sources"

function sold(packageId: string, qty: number): PackageSalesBreakdown {
  const b = emptyPackageSalesBreakdown(packageId)
  b.salesforceOffline = qty
  b.total = qty
  return b
}

function members(rows: Array<{ id: string; duration: string; qty: number }>): LinkedSellableMember[] {
  return rows.map((row) => ({
    id: row.id,
    duration: row.duration,
    breakdown: sold(row.id, row.qty),
  }))
}

test("selling 5 Saturday & Sunday packages reduces 3-day, Saturday, Sunday, and 2-day by 5", () => {
  const group = members([
    { id: "three", duration: "3_day", qty: 0 },
    { id: "fri", duration: "friday_only", qty: 0 },
    { id: "sat", duration: "saturday_only", qty: 0 },
    { id: "sun", duration: "sunday_only", qty: 0 },
    { id: "two", duration: "2_day", qty: 5 },
  ])
  const input = { stock: 26, members: group }
  assert.equal(linkedPoolSellableForPackage({ ...input, targetId: "two", targetDuration: "2_day" }), 21)
  assert.equal(linkedPoolSellableForPackage({ ...input, targetId: "three", targetDuration: "3_day" }), 21)
  assert.equal(linkedPoolSellableForPackage({ ...input, targetId: "sat", targetDuration: "saturday_only" }), 21)
  assert.equal(linkedPoolSellableForPackage({ ...input, targetId: "sun", targetDuration: "sunday_only" }), 21)
  assert.equal(linkedPoolSellableForPackage({ ...input, targetId: "fri", targetDuration: "friday_only" }), 26)
})

test("linked day sales use the busiest day instead of adding every day together", () => {
  const group = members([
    { id: "three", duration: "3_day", qty: 13 },
    { id: "fri", duration: "friday_only", qty: 2 },
    { id: "sat", duration: "saturday_only", qty: 4 },
    { id: "sun", duration: "sunday_only", qty: 2 },
  ])
  const remaining = linkedPoolSellableForPackage({
    stock: 22,
    targetId: "three",
    targetDuration: "3_day",
    members: group,
  })

  assert.equal(remaining, 5)
  assert.equal(22 - remaining, 17)
})

test("3-day stock purchased sold is pool consumption, not the sum of Places Sold", () => {
  // Marsa Box: 24 Friday + 4 Saturday + 6 Sat&Sun + 47 Sunday = 81 SKU sales.
  // 3-day remaining is bottlenecked by Sunday (47 + 6), so Sold = 53, Left = 147.
  const group = members([
    { id: "three", duration: "3_day", qty: 0 },
    { id: "fri", duration: "friday_only", qty: 24 },
    { id: "sat", duration: "saturday_only", qty: 4 },
    { id: "sun", duration: "sunday_only", qty: 47 },
    { id: "two", duration: "2_day", qty: 6 },
  ])
  const input = { stock: 200, members: group }
  const skuSum = 24 + 4 + 47 + 6
  assert.equal(skuSum, 81)

  assert.equal(linkedPoolAttributedSold({ ...input, targetId: "three", targetDuration: "3_day" }), 53)
  assert.equal(linkedPoolSellableForPackage({ ...input, targetId: "three", targetDuration: "3_day" }), 147)

  assert.equal(linkedPoolAttributedSold({ ...input, targetId: "sun", targetDuration: "sunday_only" }), 53)
  assert.equal(linkedPoolSellableForPackage({ ...input, targetId: "sun", targetDuration: "sunday_only" }), 147)

  assert.equal(linkedPoolAttributedSold({ ...input, targetId: "two", targetDuration: "2_day" }), 53)
  assert.equal(linkedPoolSellableForPackage({ ...input, targetId: "two", targetDuration: "2_day" }), 147)

  assert.equal(linkedPoolAttributedSold({ ...input, targetId: "sat", targetDuration: "saturday_only" }), 10)
  assert.equal(linkedPoolSellableForPackage({ ...input, targetId: "sat", targetDuration: "saturday_only" }), 190)

  assert.equal(linkedPoolAttributedSold({ ...input, targetId: "fri", targetDuration: "friday_only" }), 24)
  assert.equal(linkedPoolSellableForPackage({ ...input, targetId: "fri", targetDuration: "friday_only" }), 176)

  const twoDayPipeline = members([
    { id: "three", duration: "3_day", qty: 0 },
    { id: "fri", duration: "friday_only", qty: 24 },
    { id: "sat", duration: "saturday_only", qty: 4 },
    { id: "sun", duration: "sunday_only", qty: 47 },
    { id: "two", duration: "2_day", qty: 6 },
  ])
  twoDayPipeline[4].breakdown.unsignedOpenPipeline = 10
  assert.equal(
    linkedPoolAttributedPipeline({
      stock: 200,
      targetId: "three",
      targetDuration: "3_day",
      members: twoDayPipeline,
    }),
    0,
  )

  const siblings = group.map((row) => ({
    id: row.id,
    duration: row.duration,
    sold: row.breakdown.salesforceOffline,
  }))
  assert.equal(
    computeLinkedStockSourceAttributedSold({
      packageId: "three",
      duration: "3_day",
      siblings,
    }),
    53,
  )
  assert.equal(
    computeLinkedStockSourceAttributedSold({
      packageId: "fri",
      duration: "friday_only",
      siblings,
    }),
    24,
  )
  assert.equal(
    computeLinkedStockSourceAttributedSold({
      packageId: "sun",
      duration: "sunday_only",
      siblings,
    }),
    53,
  )
})

test("stock purchased ledger uses pool sold, not the sum of linked SKUs", () => {
  const costLayers = readFileSync("components/admin/package-cost-layers.tsx", "utf8")
  assert.match(costLayers, /linkedPoolAttributedSold/)
  assert.match(costLayers, /linkedPoolAttributedPipeline/)
  assert.doesNotMatch(
    costLayers,
    /if \(dur === "3_day"\) \{\s*let total = 0/,
  )
})

test("proposal-stage pipeline is not stored as reserving demand", () => {
  const queries = readFileSync("lib/admin/package-sales-breakdown-queries.ts", "utf8")
  assert.match(queries, /dealStageReservesSellable/)
  assert.match(queries, /dealStageCountsAsSold/)
  assert.match(queries, /dealStageIsUnsignedPipeline/)
  assert.doesNotMatch(queries, /"proposal"/)
})

test("places sold pipeline column shows unsigned open deals", () => {
  const costLayers = readFileSync("components/admin/package-cost-layers.tsx", "utf8")
  assert.match(costLayers, /unsignedPipelinePlaces/)
  assert.doesNotMatch(
    costLayers,
    /soldCount\(Math\.max\(0, Math\.floor\(row\.salesBreakdown\.salesforceOpenPipeline\)\)\)/,
  )
  const eventDetail = readFileSync("lib/admin/event-detail.ts", "utf8")
  assert.match(eventDetail, /unsignedPipelinePlaces/)
})

test("event remaining uses product-page sellable, not stale qty_available", () => {
  const eventDetail = readFileSync("lib/admin/event-detail.ts", "utf8")
  assert.match(eventDetail, /effectiveSellableByPackageId/)
  assert.doesNotMatch(eventDetail, /available:\s*Number\(inventory\?\.qty_available/)
})

test("signed contracts hold sellable as sold; unsigned demand does not", () => {
  const stock = 95
  const unsigned = emptyPackageSalesBreakdown("pkg")
  unsigned.unsignedOpenPipeline = 4
  assert.equal(commitmentSellable({ stock, breakdown: unsigned }), 95)
  assert.equal(unsignedPipelinePlaces(unsigned), 4)
  assert.equal(formatPackageSalesBreakdown(unsigned), "4 in pipeline")

  const signedHold = emptyPackageSalesBreakdown("pkg")
  signedHold.salesforceOffline = 4
  signedHold.total = 4
  assert.equal(commitmentSellable({ stock, breakdown: signedHold }), 91)
  assert.equal(unsignedPipelinePlaces(signedHold), 0)

  const sfPipeline = emptyPackageSalesBreakdown("pkg")
  sfPipeline.salesforceOpenPipeline = 4
  assert.equal(commitmentSellable({ stock, breakdown: sfPipeline }), 91)
})

test("stale package_inventory is ignored when purchased stock and sibling sales are known", () => {
  const three = emptyPackageSalesBreakdown("three")
  three.salesforceOffline = 10
  three.total = 10
  const weekend = emptyPackageSalesBreakdown("two")
  weekend.salesforceOffline = 100
  weekend.total = 100
  const rows: EffectiveSellablePackage[] = [
    {
      id: "three",
      duration: "3_day",
      inventory_group_id: "singapore-velocity",
      inventory: { qty_available: 130, qty_held: 0 },
      layer_units_purchased: 130,
      sales_breakdown: three,
    },
    {
      id: "two",
      duration: "2_day",
      inventory_group_id: "singapore-velocity",
      inventory: { qty_available: 130, qty_held: 0 },
      layer_units_purchased: 0,
      sales_breakdown: weekend,
    },
  ]
  applyEffectiveSellable(rows)
  assert.equal(rows[0].effective_sellable, 20)
  assert.equal(rows[1].effective_sellable, 20)
})

test("linked weekend sales reduce 3-day remaining even without single-day SKUs", () => {
  const queries = readFileSync("lib/catalog/queries.ts", "utf8")
  assert.match(queries, /attachStorefrontAvailability/)
  const reconcile = readFileSync("lib/inventory/linked-group-inventory.ts", "utf8")
  assert.match(reconcile, /applyEffectiveSellable/)
  assert.doesNotMatch(
    reconcile,
    /if \(!threeDay\?\.id \|\| dayMembers\.length === 0\) return false/,
  )
})

test("portal home computes sellable for featured packages only", () => {
  const queries = readFileSync("lib/catalog/queries.ts", "utf8")
  const home = readFileSync("app/(portal)/page.tsx", "utf8")
  const packages = readFileSync("app/(portal)/packages/page.tsx", "utf8")
  const hero = readFileSync("components/dashboard/dashboard-hero.tsx", "utf8")
  assert.match(queries, /sellable === "featured"/)
  assert.match(queries, /sellable === "none"/)
  assert.match(queries, /fetchHomeCatalog/)
  assert.match(queries, /PORTAL_HOME_PACKAGE_COLUMNS/)
  assert.match(home, /sellable: "featured"/)
  assert.match(home, /DashboardHero/)
  assert.match(packages, /sellable: "none"/)
  assert.match(hero, /fetchPriority="high"/)
  assert.match(hero, /priority/)
})
