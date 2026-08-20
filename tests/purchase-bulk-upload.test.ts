import assert from "node:assert/strict"
import test from "node:test"
import {
  PURCHASE_BULK_TEMPLATE_CSV,
  extractContractLink,
  matchPurchaseEvent,
  matchPurchasePackage,
  parseMoneyAmount,
  parsePurchaseBulkCsv,
  parseQuantity,
  resolveStockPackage,
  type PurchaseBulkCatalog,
  type PurchaseBulkCatalogPackage,
} from "../lib/inventory/purchase-bulk-upload"

function pkg(overrides: Partial<PurchaseBulkCatalogPackage> & { id: string; name: string }): PurchaseBulkCatalogPackage {
  return {
    duration: "3_day",
    inventoryGroupId: null,
    shellParentPackageId: null,
    currency: "USD",
    raceId: "race-aus",
    raceName: "Australian Grand Prix",
    raceShortName: "Australia",
    location: "Melbourne",
    country: "Australia",
    countryCode: "AU",
    season: 2026,
    eventDate: "2026-03-15",
    ...overrides,
  }
}

const catalog: PurchaseBulkCatalog = {
  existingPoNumbers: ["INV351345"],
  packages: [
    pkg({ id: "aus-pc", name: "Paddock Club 3-Days" }),
    pkg({ id: "aus-pc-sun", name: "Paddock Club Sunday", duration: "sunday", inventoryGroupId: "aus-group" }),
    pkg({
      id: "aus-pc-parent",
      name: "Paddock Club 3-Days Linked",
      inventoryGroupId: "aus-group",
    }),
    pkg({
      id: "mia-gs",
      name: "Turn 18 Grandstand",
      raceId: "race-mia",
      raceName: "Miami Grand Prix",
      raceShortName: "Miami",
      location: "Miami",
      country: "United States",
      countryCode: "US",
      eventDate: "2026-05-03",
    }),
    pkg({
      id: "can-pc",
      name: "Paddock Club 3-Days",
      raceId: "race-can",
      raceName: "Canadian Grand Prix",
      raceShortName: "Canada",
      location: "Montreal",
      country: "Canada",
      countryCode: "CA",
      eventDate: "2026-06-14",
    }),
    pkg({
      id: "jed-pc",
      name: "Paddock Club 3-Days",
      raceId: "race-jed",
      raceName: "Saudi Arabian Grand Prix",
      raceShortName: "Saudi Arabia",
      location: "Jeddah",
      country: "Saudi Arabia",
      countryCode: "SA",
      eventDate: "2026-04-12",
    }),
  ],
}

test("parses spreadsheet money and quantity cells", () => {
  assert.equal(parseMoneyAmount("$5,299.00"), 5299)
  assert.equal(parseMoneyAmount("$(3,143.63)"), 3143.63)
  assert.equal(parseMoneyAmount("NA"), null)
  assert.equal(parseQuantity("12"), 12)
  assert.equal(parseQuantity("No Completed"), null)
})

test("parses the template against catalog nicknames", () => {
  const parsed = parsePurchaseBulkCsv(PURCHASE_BULK_TEMPLATE_CSV, catalog)
  assert.equal(parsed.totalRows, 3)
  assert.equal(parsed.validRows, 3)
  assert.equal(parsed.errorRows, 0)

  const australia = parsed.rows[0]
  assert.equal(australia?.stockPackageId, "aus-pc")
  assert.equal(australia?.supplierName, "F1 Experiences")
  assert.equal(australia?.supplierReference, "INV351345")
  assert.equal(australia?.poNumber, "INV351345")
  assert.equal(australia?.quantity, 12)
  assert.equal(australia?.unitCost, 5299)
  assert.ok(australia?.warnings.some((warning) => warning.includes("existing purchase order")))

  const miami = parsed.rows[1]
  assert.equal(miami?.stockPackageId, "mia-gs")
  assert.equal(miami?.supplierName, "GPT")
  assert.equal(miami?.supplierReference, "")
  assert.equal(miami?.poNumber, "IMP-GPT")
  assert.ok(miami?.warnings.some((warning) => warning.includes("No supplier invoice")))

  const canada = parsed.rows[2]
  assert.equal(canada?.stockPackageId, "can-pc")
  assert.equal(canada?.packageLabel.includes("TGR HA"), true)
})

test("carries supplier from above and skips incomplete qty", () => {
  const csv = [
    "Event,Package,QTY,Total,Cost Per Unit,Supplier,Order / Contract,Invoice Number",
    "Jeddah,Paddock Club 3-Days,8,83292.4,10411.55,F1 Experiences,DJT 26-64,INV332308",
    "Jeddah,Paddock Club 3-Days | Club Suite,No Completed,,,from above,can't find contract signed doc,",
  ].join("\n")
  const parsed = parsePurchaseBulkCsv(csv, catalog)
  assert.equal(parsed.totalRows, 2)
  assert.equal(parsed.validRows, 1)
  assert.equal(parsed.rows[0]?.poNumber, "INV332308")
  assert.equal(parsed.rows[0]?.supplierReference, "INV332308")
  assert.ok(parsed.rows[1]?.errors.some((error) => error.includes("Quantity")))
  assert.equal(parsed.rows[1]?.supplierName, "F1 Experiences")
})

test("calculates unit cost from total when the unit cell is blank", () => {
  const csv = [
    "Event,Package,QTY,Total,Cost Per Unit,Supplier,Invoice Number",
    "Australia,Paddock Club 3-Days,10,52990,,F1 Experiences,INV-TEST",
  ].join("\n")
  const parsed = parsePurchaseBulkCsv(csv, catalog)
  assert.equal(parsed.validRows, 1)
  assert.equal(parsed.rows[0]?.unitCost, 5299)
  assert.ok(parsed.rows[0]?.warnings.some((warning) => warning.includes("Total")))
})

test("matches spreadsheet event nicknames to catalog races", () => {
  const jeddah = matchPurchaseEvent("Jeddah", catalog.packages)
  assert.equal(jeddah[0]?.raceId, "race-jed")
  const canada = matchPurchaseEvent("Canada - Montreal", catalog.packages)
  assert.equal(canada[0]?.raceId, "race-can")
})

test("creates a new product when the event exists but the package does not", () => {
  const csv = [
    "Event,Package,QTY,Total,Cost Per Unit,Supplier,Invoice Number",
    "Australia,Gordon Ramsay at F1 Garage,1,6500,6500,F1 Experiences,INV-GR",
  ].join("\n")
  const parsed = parsePurchaseBulkCsv(csv, catalog)
  assert.equal(parsed.validRows, 1)
  assert.equal(parsed.rows[0]?.willCreatePackage, true)
  assert.equal(parsed.rows[0]?.createPackageName, "Gordon Ramsay at F1 Garage")
  assert.equal(parsed.rows[0]?.raceId, "race-aus")
})

test("extracts contract URLs and ignores them as PO numbers", () => {
  assert.equal(
    extractContractLink('=HYPERLINK("https://files.example.com/djt.pdf","DJT 26-20")').url,
    "https://files.example.com/djt.pdf",
  )
  assert.equal(extractContractLink("DJT 26-20", "https://files.example.com/contract.pdf").url, "https://files.example.com/contract.pdf")
  assert.equal(extractContractLink("C:\\Users\\Matt\\contract.pdf").local, true)

  const csv = [
    "Event,Package,QTY,Cost Per Unit,Supplier,Order / Contract,Invoice Number",
    "Australia,Paddock Club 3-Days,2,1000,F1 Experiences,https://files.example.com/po.pdf,INV-LINK",
  ].join("\n")
  const parsed = parsePurchaseBulkCsv(csv, catalog)
  assert.equal(parsed.rows[0]?.poNumber, "INV-LINK")
  assert.equal(parsed.rows[0]?.supplierReference, "INV-LINK")
  assert.equal(parsed.rows[0]?.contractUrl, "https://files.example.com/po.pdf")
})

test("prefers the 3-day parent when a day ticket is in a linked group", () => {
  const matched = matchPurchasePackage("Paddock Club Sunday", catalog.packages.filter((row) => row.raceId === "race-aus"))
  assert.ok(!("error" in matched))
  if ("error" in matched) return
  const stock = resolveStockPackage(matched.pkg, catalog.packages)
  assert.equal(stock.pkg.id, "aus-pc-parent")
  assert.ok(stock.warning)
})
