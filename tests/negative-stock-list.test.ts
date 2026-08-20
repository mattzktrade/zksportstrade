import assert from "node:assert/strict"
import { test } from "node:test"
import {
  filterNegativeStockRows,
  hasActiveNegativeStockFilters,
  sortNegativeStockRows,
  statusLabel,
  summarizeNegativeStock,
  urgencyForEvent,
  type NegativeStockRow,
} from "../lib/admin/negative-stock"

const now = new Date("2026-08-13T12:00:00.000Z")

function row(overrides: Partial<NegativeStockRow> = {}): NegativeStockRow {
  return {
    id: "ns-1",
    dealId: "deal-1",
    packageId: "pkg-1",
    quantity: 2,
    unitCost: 1000,
    unitSale: 1500,
    currency: "USD",
    supplierId: "sup-1",
    supplierName: "Paddock Co",
    supplierQuoteAt: "2026-08-13T09:00:00.000Z",
    quoteFresh: true,
    status: "confirmed",
    createdAt: "2026-08-01T00:00:00.000Z",
    note: null,
    eventName: "2026 British Grand Prix",
    eventDate: "2026-07-05",
    location: "Silverstone",
    packageName: "3-Day Paddock",
    dealReference: "D-1001",
    accountName: "Apex Travel",
    accountId: "acc-1",
    ownerName: "Matt",
    ownerProfileId: "owner-1",
    ...overrides,
  }
}

test("urgency bands match 7-day critical and 45-day urgent", () => {
  assert.equal(urgencyForEvent("2026-08-18", now), "critical")
  assert.equal(urgencyForEvent("2026-09-10", now), "urgent")
  assert.equal(urgencyForEvent("2026-12-01", now), "later")
  assert.equal(urgencyForEvent(null, now), "unknown")
})

test("search and dropdown filters actually narrow the list", () => {
  const rows = [
    row(),
    row({
      id: "ns-2",
      eventName: "2026 Abu Dhabi Grand Prix",
      eventDate: "2026-12-06",
      supplierName: "Gulf Tickets",
      accountName: "Desert Agency",
      ownerName: "Sam",
      dealReference: "D-2002",
      status: "quoted",
      unitCost: 800,
      unitSale: 900,
    }),
  ]

  const byEvent = filterNegativeStockRows(
    rows,
    {
      search: "",
      eventNames: ["2026 British Grand Prix"],
      supplierName: "",
      urgency: "",
      assignedTo: "",
      status: "",
    },
    now,
  )
  assert.equal(byEvent.length, 1)
  assert.equal(byEvent[0].id, "ns-1")

  const bySearch = filterNegativeStockRows(
    rows,
    {
      search: "desert",
      eventNames: [],
      supplierName: "",
      urgency: "",
      assignedTo: "",
      status: "",
    },
    now,
  )
  assert.equal(bySearch.length, 1)
  assert.equal(bySearch[0].dealReference, "D-2002")

  const byUrgency = filterNegativeStockRows(
    rows,
    {
      search: "",
      eventNames: [],
      supplierName: "",
      urgency: "later",
      assignedTo: "",
      status: "",
    },
    now,
  )
  assert.equal(byUrgency.length, 1)
  assert.equal(byUrgency[0].eventName, "2026 Abu Dhabi Grand Prix")
})

test("sort by event date puts undated rows last when ascending", () => {
  const rows = [
    row({ id: "later", eventDate: "2026-12-01" }),
    row({ id: "soon", eventDate: "2026-08-20" }),
    row({ id: "none", eventDate: null }),
  ]
  const sorted = sortNegativeStockRows(rows, "eventDate", false)
  assert.deepEqual(
    sorted.map((item) => item.id),
    ["soon", "later", "none"],
  )
})

test("summary counts urgent items and values from the full list", () => {
  const summary = summarizeNegativeStock(
    [
      row({ eventDate: "2026-08-20", quantity: 2, unitCost: 1000, unitSale: 1500 }),
      row({ id: "ns-2", eventDate: "2026-12-01", quantity: 1, unitCost: 400, unitSale: 700 }),
    ],
    now,
  )
  assert.equal(summary.count, 2)
  assert.equal(summary.urgent, 1)
  assert.equal(summary.purchaseValue, 2400)
  assert.equal(summary.saleValue, 3700)
})

test("status labels and active-filter helper stay consistent", () => {
  assert.equal(statusLabel("open"), "Needs quote")
  assert.equal(statusLabel("quoted"), "Quoted")
  assert.equal(statusLabel("confirmed"), "Pending purchase")
  assert.equal(
    hasActiveNegativeStockFilters({
      search: "",
      eventNames: [],
      supplierName: "",
      urgency: "",
      assignedTo: "",
      status: "",
    }),
    false,
  )
  assert.equal(
    hasActiveNegativeStockFilters({
      search: "apex",
      eventNames: [],
      supplierName: "",
      urgency: "",
      assignedTo: "",
      status: "",
    }),
    true,
  )
})
