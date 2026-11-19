import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { nativeEventId, stripTrailingYear } from "../lib/catalog/event-id"
import { ENQUIRY_EVENT_CATEGORIES, isEnquiryEventCategory } from "../lib/catalog/event-categories"
import {
  catalogMatchMessage,
  findEventCatalogMatches,
  findProductCatalogMatches,
  normalizeEventName,
  normalizeProductName,
} from "../lib/catalog/enquiry-catalog-match"

const wimbledon = {
  id: "wimbledon-2026",
  name: "Wimbledon",
  shortName: "Wimbledon",
  season: 2026,
  circuit: "All England Lawn Tennis Club",
  location: "London",
  eventDate: "2026-06-29",
  isArchived: false,
  category: "tennis",
}

describe("enquiry catalog ids and names", () => {
  it("strips a trailing year so Wimbledon 2026 does not become wimbledon-2026-2026", () => {
    assert.equal(stripTrailingYear("Wimbledon 2026", 2026), "Wimbledon")
    assert.equal(nativeEventId("Wimbledon 2026", 2026), "wimbledon-2026")
    assert.equal(nativeEventId("Wimbledon", 2026), "wimbledon-2026")
  })

  it("treats championships wording as the same event name", () => {
    assert.equal(normalizeEventName("The Championships, Wimbledon"), "wimbledon")
    assert.equal(normalizeEventName("Wimbledon"), "wimbledon")
  })

  it("only allows non-F1 categories on the enquiry create path", () => {
    assert.equal(isEnquiryEventCategory("tennis"), true)
    assert.equal(isEnquiryEventCategory("cricket"), true)
    assert.equal(isEnquiryEventCategory("nfl"), true)
    assert.equal(isEnquiryEventCategory("horse_racing"), true)
    assert.equal(isEnquiryEventCategory("formula_1"), false)
    const src = readFileSync("components/admin/enquiry-catalog-create.tsx", "utf8")
    assert.match(src, /useState<EventCategory \| "">\(""\)/)
    assert.match(src, /Select a category/)
    assert.doesNotMatch(src, /useState<EventCategory>\("other"\)/)
    assert.deepEqual(ENQUIRY_EVENT_CATEGORIES, [
      "football",
      "tennis",
      "cricket",
      "rugby",
      "concert",
      "nfl",
      "basketball",
      "baseball",
      "horse_racing",
      "motorsports",
      "boxing",
      "golf",
      "other",
    ])
  })
})

describe("event duplicate matching", () => {
  it("matches the same name and season, including archived rows", () => {
    const matches = findEventCatalogMatches(
      { name: "Wimbledon", season: 2026 },
      [{ ...wimbledon, isArchived: true }],
    )
    assert.equal(matches.length, 1)
    assert.equal(matches[0]?.kind, "exact")
    assert.equal(matches[0]?.isArchived, true)
  })

  it("matches similar names in the same season", () => {
    const matches = findEventCatalogMatches(
      { name: "The Championships Wimbledon", season: 2026 },
      [wimbledon],
    )
    assert.equal(matches[0]?.id, "wimbledon-2026")
    assert.ok(matches[0]?.kind === "exact" || matches[0]?.kind === "close")
  })

  it("matches venue and nearby dates when names overlap", () => {
    const matches = findEventCatalogMatches(
      {
        name: "Wimbledon Tennis",
        season: 2026,
        circuit: "All England Lawn Tennis Club",
        eventDate: "2026-07-02",
      },
      [wimbledon],
    )
    assert.equal(matches[0]?.id, "wimbledon-2026")
  })

  it("does not match a different season", () => {
    const matches = findEventCatalogMatches(
      { name: "Wimbledon", season: 2027 },
      [wimbledon],
    )
    assert.equal(matches.length, 0)
  })
})

describe("product duplicate matching", () => {
  const royalBox = {
    id: "wimbledon-2026-royal-box",
    raceId: "wimbledon-2026",
    name: "Royal Box Hospitality",
    duration: null,
    shellParentPackageId: null,
  }

  it("matches exact and similar hospitality names on the same event", () => {
    const exact = findProductCatalogMatches(
      { raceId: "wimbledon-2026", name: "Royal Box Hospitality" },
      [royalBox],
    )
    assert.equal(exact[0]?.kind, "exact")

    const similar = findProductCatalogMatches(
      { raceId: "wimbledon-2026", name: "Royal Box" },
      [royalBox],
    )
    assert.equal(similar[0]?.id, royalBox.id)
    assert.equal(normalizeProductName("Royal Box Hospitality"), "royal box")

    const clubhouse = findProductCatalogMatches(
      { raceId: "abudhabi-2026", name: "3 Day Paddock Club - Clubhouse", duration: "3_day" },
      [{
        id: "abudhabi-2026-3-day-paddock-club",
        raceId: "abudhabi-2026",
        name: "3 Day Paddock Club",
        duration: "3_day",
        shellParentPackageId: null,
      }],
    )
    assert.equal(clubhouse.length, 0)
  })

  it("blocks a second F1 Paddock Club of the same duration", () => {
    const existing = {
      id: "abudhabi-2026-3-day-paddock-club",
      raceId: "abudhabi-2026",
      name: "3 Day Paddock Club",
      duration: "3_day",
      shellParentPackageId: null,
    }
    const matches = findProductCatalogMatches(
      { raceId: "abudhabi-2026", name: "3 Day F1 Experiences Paddock Club", duration: "3_day" },
      [existing],
    )
    assert.equal(matches[0]?.id, existing.id)
  })

  it("allows a different duration or a different product name", () => {
    const existing = {
      id: "abudhabi-2026-3-day-paddock-club",
      raceId: "abudhabi-2026",
      name: "3 Day Paddock Club",
      duration: "3_day",
      shellParentPackageId: null,
    }
    const sunday = findProductCatalogMatches(
      { raceId: "abudhabi-2026", name: "Sunday Paddock Club", duration: "sunday_only" },
      [existing],
    )
    assert.equal(sunday.length, 0)

    const garage = findProductCatalogMatches(
      { raceId: "abudhabi-2026", name: "Garage Walk Experience", duration: "sunday_only" },
      [existing],
    )
    assert.equal(garage.length, 0)
  })

  it("ignores shell children", () => {
    const matches = findProductCatalogMatches(
      { raceId: "abudhabi-2026", name: "Friday Single Ticket" },
      [{
        id: "abudhabi-2026-friday-shell",
        raceId: "abudhabi-2026",
        name: "Friday Single Ticket",
        duration: "friday_only",
        shellParentPackageId: "abudhabi-2026-3-day-paddock-club",
      }],
    )
    assert.equal(matches.length, 0)
  })
})

describe("catalog create uses the same matcher", () => {
  it("blocks duplicate events and products from inventory create as well", () => {
    const src = readFileSync("app/(admin)/actions.ts", "utf8")
    assert.match(src, /from "@\/lib\/catalog\/event-id"/)
    assert.match(src, /findEventCatalogMatches/)
    assert.match(src, /findProductCatalogMatches/)
    assert.match(src, /catalogMatchMessage\("event"/)
    assert.match(src, /catalogMatchMessage\("product"/)
  })
})

describe("enquiry catalog actions stay restricted", () => {
  it("expands races.category to the full sports list", () => {
    const sql = readFileSync("supabase/migrations/20261119130000_event_category_sports.sql", "utf8")
    assert.match(sql, /races_category_check/)
    for (const category of [
      "formula_1",
      "football",
      "tennis",
      "cricket",
      "rugby",
      "concert",
      "nfl",
      "basketball",
      "baseball",
      "horse_racing",
      "motorsports",
      "boxing",
      "golf",
      "other",
    ]) {
      assert.match(sql, new RegExp(`'${category}'`))
    }
  })

  it("adds unique name indexes only when the catalog is already clean", () => {
    const sql = readFileSync("supabase/migrations/20261119120000_enquiry_catalog_unique_names.sql", "utf8")
    assert.match(sql, /races_name_season_unique_idx/)
    assert.match(sql, /packages_race_name_unique_idx/)
    assert.match(sql, /shell_parent_package_id is null/)
    assert.match(sql, /Skipping races_name_season_unique_idx/)
  })

  it("creates hidden standalone products without Salesforce or Wix sync", () => {
    const src = readFileSync("app/(admin)/admin/enquiries/enquiry-catalog-actions.ts", "utf8")
    assert.match(src, /requireAdminAction\("deals.manage"\)/)
    assert.match(src, /is_hidden: true/)
    assert.match(src, /inventory_is_standalone: true/)
    assert.match(src, /sell_on_trade_portal: false/)
    assert.match(src, /sell_on_wix: false/)
    assert.match(src, /integration_sync_status: "idle"/)
    assert.doesNotMatch(src, /enqueueProductUpsert/)
    assert.doesNotMatch(src, /createWixProduct/)
    assert.doesNotMatch(src, /ensureShellSingleTickets/)
    assert.match(src, /formula_1/)
  })

  it("explains why a match cannot be created twice", () => {
    assert.match(
      catalogMatchMessage("event", [{ name: "Wimbledon", kind: "exact" }]),
      /Wimbledon/,
    )
  })
})
