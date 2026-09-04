import assert from "node:assert/strict"
import test from "node:test"
import {
  assignSupplierTiers,
  buildSupplierDirectoryRows,
  coverageForFilters,
  supplierMatchesDirectoryFilters,
  summarizeSupplierCoverage,
  type SupplierCoverageEvent,
  type SupplierDirectoryFilters,
  type SupplierDirectoryRow,
} from "../lib/admin/supplier-directory"
import { locationMatchesRegion, regionIdForLocation } from "../lib/catalog/regions"

function event(partial: Partial<SupplierCoverageEvent> & Pick<SupplierCoverageEvent, "raceId" | "name">): SupplierCoverageEvent {
  return {
    shortName: partial.shortName ?? partial.name,
    season: partial.season ?? 2026,
    eventDate: partial.eventDate ?? "2026-05-24",
    label: partial.label ?? `2026 ${partial.name}`,
    category: partial.category ?? "formula_1",
    country: partial.country ?? "Monaco",
    location: partial.location ?? "Monte Carlo",
    regionId: partial.regionId ?? "europe",
    packages: partial.packages ?? [],
    spend: partial.spend ?? 0,
    ...partial,
  }
}

function row(partial: Partial<SupplierDirectoryRow> & Pick<SupplierDirectoryRow, "id" | "name">): SupplierDirectoryRow {
  return {
    code: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    notes: null,
    active: true,
    purchaseOrders: 0,
    packages: [],
    spend: 0,
    currency: "USD",
    accountKinds: [],
    accountKindLabel: "Unspecified",
    tier: 3,
    events: [],
    ...partial,
  }
}

const emptyFilters: SupplierDirectoryFilters = {
  search: "",
  sport: "",
  eventIds: [],
}

test("top ten spenders are tier 1, next twenty tier 2, the rest tier 3", () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    id: `s${String(index).padStart(2, "0")}`,
    spend: 400 - index,
  }))
  const tiers = assignSupplierTiers(rows)
  assert.equal(tiers.get("s00"), 1)
  assert.equal(tiers.get("s09"), 1)
  assert.equal(tiers.get("s10"), 2)
  assert.equal(tiers.get("s29"), 2)
  assert.equal(tiers.get("s30"), 3)
  assert.equal(tiers.get("s39"), 3)
})

test("suppliers with no spend stay in tier 3 even when there are fewer than ten paid suppliers", () => {
  const tiers = assignSupplierTiers([
    { id: "paid-a", spend: 8000 },
    { id: "paid-b", spend: 2000 },
    { id: "idle", spend: 0 },
  ])
  assert.equal(tiers.get("paid-a"), 1)
  assert.equal(tiers.get("paid-b"), 1)
  assert.equal(tiers.get("idle"), 3)
})

test("coverage headline names the event instead of only the package", () => {
  const summary = summarizeSupplierCoverage([
    event({
      raceId: "monaco-2026",
      name: "Monaco Grand Prix",
      shortName: "Monaco GP",
      packages: ["Paddock Club"],
      spend: 12000,
    }),
    event({
      raceId: "singapore-2026",
      name: "Singapore Grand Prix",
      shortName: "Singapore GP",
      country: "Singapore",
      location: "Marina Bay",
      regionId: "asia-pacific",
      packages: ["Paddock Club"],
      spend: 4000,
    }),
  ])
  assert.match(summary.headline, /Monaco GP/)
  assert.match(summary.detail, /Paddock Club/)
  assert.doesNotMatch(summary.headline, /^Paddock Club$/)
})

test("searching a race focuses coverage on that event and its packages", () => {
  const summary = coverageForFilters(
    [
      event({
        raceId: "monaco-2026",
        name: "Monaco Grand Prix",
        shortName: "Monaco GP",
        packages: ["Paddock Club"],
        spend: 1000,
      }),
      event({
        raceId: "australia-2026",
        name: "Australian Grand Prix",
        shortName: "Australia",
        country: "Australia",
        location: "Melbourne",
        regionId: "asia-pacific",
        packages: ["Hospitality"],
        spend: 9000,
      }),
    ],
    { ...emptyFilters, search: "monaco" },
  )
  assert.match(summary.headline, /Monaco GP/)
  assert.match(summary.detail, /Paddock Club/)
  assert.doesNotMatch(summary.headline, /Australia/)
})

test("event search matches suppliers from saved coverage, not only purchased stock", () => {
  const supplier = row({
    id: "agpc",
    name: "AGPC Travel",
    events: [
      event({
        raceId: "australia-2026",
        name: "Australian Grand Prix",
        shortName: "Australia",
        country: "Australia",
        location: "Melbourne",
        regionId: "asia-pacific",
        packages: [],
        spend: 0,
      }),
    ],
  })
  assert.equal(
    supplierMatchesDirectoryFilters(supplier, { ...emptyFilters, search: "melbourne" }),
    true,
  )
  assert.equal(
    supplierMatchesDirectoryFilters(supplier, { ...emptyFilters, eventIds: ["australia-2026"] }),
    true,
  )
  assert.equal(
    supplierMatchesDirectoryFilters(supplier, { ...emptyFilters, eventIds: ["monaco-2026"] }),
    false,
  )
})

test("sport filter uses linked event data", () => {
  const supplier = row({
    id: "bam",
    name: "BAM Hospitality",
    accountKinds: ["hospitality_agency"],
    accountKindLabel: "Hospitality agency",
    events: [
      event({
        raceId: "silverstone-2026",
        name: "British Grand Prix",
        shortName: "Silverstone",
        country: "United Kingdom",
        location: "Silverstone",
        regionId: "europe",
        packages: ["Grandstands"],
      }),
    ],
  })
  assert.equal(supplierMatchesDirectoryFilters(supplier, { ...emptyFilters, sport: "formula_1" }), true)
  assert.equal(supplierMatchesDirectoryFilters(supplier, { ...emptyFilters, sport: "tennis" }), false)
})

test("directory rows combine coverage events with purchased packages and spend tiers", () => {
  const rows = buildSupplierDirectoryRows({
    suppliers: [
      {
        id: "f1e",
        name: "F1 Experiences",
        code: "F1E",
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        notes: null,
        active: true,
        accountKinds: ["supplier"],
      },
      {
        id: "idle",
        name: "Idle Co",
        code: null,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        notes: null,
        active: true,
        accountKinds: [],
      },
    ],
    purchaseOrderCounts: new Map([["f1e", 4]]),
    layers: [
      {
        supplierId: "f1e",
        quantity: 2,
        unitCost: 5000,
        currency: "USD",
        packageName: "Paddock Club",
        raceId: "monaco-2026",
      },
    ],
    coverage: [
      { supplierId: "f1e", raceId: "monaco-2026" },
      { supplierId: "f1e", raceId: "singapore-2026" },
    ],
    races: [
      {
        id: "monaco-2026",
        name: "Monaco Grand Prix",
        shortName: "Monaco GP",
        season: 2026,
        eventDate: "2026-05-24",
        category: "formula_1",
        country: "Monaco",
        location: "Monte Carlo",
      },
      {
        id: "singapore-2026",
        name: "Singapore Grand Prix",
        shortName: "Singapore GP",
        season: 2026,
        eventDate: "2026-10-04",
        category: "formula_1",
        country: "Singapore",
        location: "Marina Bay",
      },
    ],
  })

  assert.equal(rows[0]?.name, "F1 Experiences")
  assert.equal(rows[0]?.tier, 1)
  assert.equal(rows[0]?.spend, 10000)
  assert.deepEqual(rows[0]?.packages, ["Paddock Club"])
  assert.equal(rows[0]?.events.length, 2)
  const monaco = rows[0]?.events.find((item) => item.raceId === "monaco-2026")
  assert.deepEqual(monaco?.packages, ["Paddock Club"])
  assert.equal(rows[1]?.name, "Idle Co")
  assert.equal(rows[1]?.tier, 3)
})

test("three or more events in one region use the region as the coverage headline", () => {
  const summary = summarizeSupplierCoverage([
    event({
      raceId: "monaco-2026",
      name: "Monaco Grand Prix",
      shortName: "Monaco GP",
      packages: ["Paddock Club"],
      spend: 3000,
    }),
    event({
      raceId: "silverstone-2026",
      name: "British Grand Prix",
      shortName: "Silverstone",
      country: "United Kingdom",
      location: "Silverstone",
      packages: ["Paddock Club"],
      spend: 2000,
    }),
    event({
      raceId: "spa-2026",
      name: "Belgian Grand Prix",
      shortName: "Spa",
      country: "Belgium",
      location: "Spa",
      packages: ["Hospitality"],
      spend: 1000,
    }),
  ])
  assert.equal(summary.headline, "Europe")
  assert.match(summary.detail, /Paddock Club/)
})

test("United Kingdom, UAE and Netherlands map into catalog regions", () => {
  assert.equal(regionIdForLocation("United Kingdom", "Silverstone"), "europe")
  assert.equal(regionIdForLocation("UAE", "Yas Marina"), "middle-east")
  assert.equal(regionIdForLocation("Netherlands", "Zandvoort"), "europe")
  assert.equal(locationMatchesRegion("United States", "Austin", "americas"), true)
  assert.equal(locationMatchesRegion("Australia", "Melbourne", "europe"), false)
})
