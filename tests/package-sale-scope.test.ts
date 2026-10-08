import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import {
  dealAmountForPackages,
  dealQuantityForPackages,
  orderAmountForPackages,
  orderQuantityForPackages,
  packageIdSet,
  signedPackageSaleCount,
} from "../lib/admin/package-sale-scope"
import { emptyPackageSalesBreakdown, linkedPoolOwnedShortage } from "../lib/admin/package-sales-breakdown"

const saturday = "singapore-2026-saturday-paddock-club-paterson-suite"
const sunday = "singapore-2026-sunday-paddock-club-paterson-suite"
const friday = "singapore-national-gallery-vip-friday-2026"
const group = packageIdSet([saturday, sunday])

function deal(lines: Array<{ packageId: string; quantity: number; unitSalePrice: number }>) {
  return {
    quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    totalAmount: lines.reduce((sum, line) => sum + line.quantity * line.unitSalePrice, 0),
    lines: lines.map((line, index) => ({
      id: `line-${index}`,
      packageId: line.packageId,
      packageName: line.packageId,
      quantity: line.quantity,
      unitSalePrice: line.unitSalePrice,
      expectedUnitCost: null,
      sourcingMode: "owned" as const,
      supplierId: null,
      supplierName: null,
      supplierKey: "",
      supplierAllocations: [],
      costLayerId: null,
    })),
  }
}

test("a multi-product deal only counts guests for the product being viewed", () => {
  const abAgency = deal([
    { packageId: saturday, quantity: 2, unitSalePrice: 5500 },
    { packageId: friday, quantity: 2, unitSalePrice: 950 },
  ])
  assert.equal(dealQuantityForPackages(abAgency, group, saturday), 2)
  assert.equal(dealQuantityForPackages(abAgency, group, sunday), 2)
  assert.equal(dealAmountForPackages(abAgency, group, saturday), 11000)
  assert.equal(dealQuantityForPackages(abAgency, group), 2)
})

test("a deal that spans two days on the same weekend counts only this product", () => {
  const bothDays = deal([
    { packageId: saturday, quantity: 2, unitSalePrice: 5500 },
    { packageId: sunday, quantity: 2, unitSalePrice: 8500 },
  ])
  assert.equal(dealQuantityForPackages(bothDays, group, sunday), 2)
  assert.equal(dealQuantityForPackages(bothDays, group, saturday), 2)
  assert.equal(dealAmountForPackages(bothDays, group, sunday), 17000)
})

test("order header guests are ignored when line items exist for this product", () => {
  const order = {
    guests: 4,
    package_id: saturday,
    total_amount: 12900,
    lines: [
      { packageId: saturday, quantity: 2, unitPrice: 5500, lineTotal: 11000 },
      { packageId: friday, quantity: 2, unitPrice: 950, lineTotal: 1900 },
    ],
  }
  assert.equal(orderQuantityForPackages(order, group, saturday), 2)
  assert.equal(orderAmountForPackages(order, group, saturday), 11000)
  assert.equal(orderQuantityForPackages(order, group, sunday), 2)
  assert.equal(orderAmountForPackages(order, group, sunday), 11000)
})

test("the orders tab counts unique signed booking forms and ignores enquiries", () => {
  assert.equal(
    signedPackageSaleCount({
      orders: [
        { id: "ord-sat", deal_id: "deal-sat", status: "pending" },
        { id: "ord-sun", deal_id: "deal-sun", status: "pending" },
      ],
      deals: [
        { id: "deal-sat", orderId: "ord-sat", stage: "awaiting_payment" },
        { id: "deal-sun", orderId: "ord-sun", stage: "awaiting_payment" },
        { id: "deal-2day", orderId: null, stage: "proposal" },
      ],
    }),
    2,
  )
})

test("two-day stock covering saturday and sunday is not a shortage", () => {
  const saturdaySold = emptyPackageSalesBreakdown(saturday)
  saturdaySold.salesforceOffline = 2
  saturdaySold.total = 2
  const sundaySold = emptyPackageSalesBreakdown(sunday)
  sundaySold.salesforceOffline = 2
  sundaySold.total = 2
  const members = [
    { id: saturday, duration: "saturday_only", breakdown: saturdaySold },
    { id: sunday, duration: "sunday_only", breakdown: sundaySold },
    { id: "two-day", duration: "2_day", breakdown: emptyPackageSalesBreakdown("two-day") },
  ]
  assert.equal(
    linkedPoolOwnedShortage({
      stock: 2,
      targetId: sunday,
      targetDuration: "sunday_only",
      members,
    }),
    0,
  )
  assert.equal(
    linkedPoolOwnedShortage({
      stock: 2,
      targetId: saturday,
      targetDuration: "saturday_only",
      members,
    }),
    0,
  )
})

test("product pages count signed sales once and guest rows for this package only", () => {
  const detail = readFileSync("components/admin/package-detail-client.tsx", "utf8")
  const table = readFileSync("components/admin/package-orders-table.tsx", "utf8")
  const page = readFileSync("app/(admin)/admin/catalog/[packageId]/page.tsx", "utf8")
  const panel = readFileSync("components/admin/package-admin-panel.tsx", "utf8")
  assert.match(detail, /signedPackageSaleCount/)
  assert.match(detail, /currentPackageId=\{livePkg\.id\}/)
  assert.doesNotMatch(detail, /orders\.length \+ deals\.length/)
  assert.match(table, /dealQuantityForPackages/)
  assert.match(table, /signedPackageSaleCount/)
  assert.match(page, /packages: \[\{ id: pkg\.id/)
  assert.doesNotMatch(page, /guestListPackageMeta/)
  assert.match(panel, /linkedPoolOwnedShortage/)
})
