import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  filterPortalPackages,
  groupPortalPackages,
  portalPackageFamily,
  portalPackageIsInStock,
  portalStockLabel,
} from "../lib/catalog/portal-package-list"
import type { Package } from "../lib/types/catalog"

function pkg(name: string, extra?: Partial<Package>): Package {
  return {
    id: name,
    name,
    circuit: "Yas Marina",
    location: "Abu Dhabi",
    country: "UAE",
    countryCode: "AE",
    date: "2026-12-06",
    dateRange: "4-6 Dec",
    price: extra?.price ?? 1000,
    currency: "USD",
    availability: extra?.availability ?? 10,
    totalCapacity: 100,
    image: "/placeholder.svg",
    tier: "paddock",
    includes: [],
    ...extra,
  }
}

describe("portal package list", () => {
  it("groups duration and team variants of the same product", () => {
    assert.equal(portalPackageFamily("Saturday Velocity Terrace"), "Velocity Terrace")
    assert.equal(portalPackageFamily("3 Days Velocity Terrace"), "Velocity Terrace")
    assert.equal(portalPackageFamily("Sunday Velocity Terrace"), "Velocity Terrace")
    assert.equal(portalPackageFamily("3 Day Paddock Club - Ferrari"), "Paddock Club")
    assert.equal(portalPackageFamily("3 Day Paddock Club - Aston Martin"), "Paddock Club")
    assert.equal(portalPackageFamily("3 Day Paddock Club - Haas"), "Paddock Club")
    assert.equal(portalPackageFamily("3 Day Legend Paddock Club (Saturday Pass)"), "Paddock Club")
    assert.equal(portalPackageFamily("3 Day Paddock Club - House 44"), "Paddock Club")
    assert.equal(portalPackageFamily("House 44 Paddock Club"), "Paddock Club")
    assert.equal(portalPackageFamily("3 Day F1 Experiences Paddock Club"), "Paddock Club")
    assert.equal(portalPackageFamily("3 Day F1 Experiences House 44"), "Paddock Club")
    assert.equal(portalPackageFamily("3 Day F1 Experiences Team Haas"), "Paddock Club")
    assert.equal(portalPackageFamily("3 Day F1 Experiences Lounge"), "F1 Experiences Lounge")
    assert.equal(portalPackageFamily("3 Day West Grandstand Tickets"), "West Grandstand Tickets")
  })

  it("keeps related products together and lists 3-day before single days", () => {
    const grouped = groupPortalPackages([
      pkg("Sunday Velocity Terrace", { duration: "sunday_only", price: 2655 }),
      pkg("3 Day West Grandstand Tickets", { duration: "3_day", price: 1075 }),
      pkg("Saturday Velocity Terrace", { duration: "saturday_only", price: 2025 }),
      pkg("3 Day Paddock Club - Mercedes", { duration: "3_day", price: null, availability: "Enquire" }),
      pkg("3 Days Velocity Terrace", { duration: "3_day", price: 4455 }),
      pkg("3 Day Legend Paddock Club", { duration: "3_day", price: 8000 }),
      pkg("3 Day Paddock Club - Ferrari", { duration: "3_day", price: null, availability: "Enquire" }),
      pkg("3 Day F1 Experiences Team Haas", { duration: "3_day", price: 7000 }),
      pkg("3 Day F1 Experiences Lounge", { duration: "3_day", price: 3000 }),
    ])

    assert.deepEqual(
      grouped.map((group) => group.family),
      ["Paddock Club", "F1 Experiences Lounge", "Velocity Terrace", "West Grandstand Tickets"],
    )
    assert.equal(grouped[0]?.packages.length, 4)
    assert.deepEqual(
      grouped[2]?.packages.map((item) => item.name),
      ["3 Days Velocity Terrace", "Saturday Velocity Terrace", "Sunday Velocity Terrace"],
    )
  })

  it("labels zero stock as Enquire without treating it as in stock", () => {
    assert.equal(portalStockLabel(0), "Enquire")
    assert.equal(portalStockLabel(-1), "Enquire")
    assert.equal(portalStockLabel(6), "6")
    assert.equal(portalStockLabel("Enquire"), "Enquire")
    assert.equal(portalPackageIsInStock(pkg("sold out", { availability: 0 })), false)
    assert.equal(portalPackageIsInStock(pkg("open", { availability: 2 })), true)
    assert.equal(portalPackageIsInStock(pkg("ask", { availability: "Enquire" })), true)
  })

  it("filters by search, stock, duration and family", () => {
    const rows = [
      pkg("3 Days Velocity Terrace", { duration: "3_day", availability: 195 }),
      pkg("Saturday Velocity Terrace", { duration: "saturday_only", availability: 0 }),
      pkg("3 Day West Grandstand Tickets", { duration: "3_day", availability: 20 }),
    ]
    const velocity = filterPortalPackages(rows, {
      query: "velocity",
      inStockOnly: false,
      duration: "",
      family: "",
    })
    assert.equal(velocity.length, 2)
    assert.equal(
      filterPortalPackages(rows, { query: "", inStockOnly: true, duration: "", family: "" }).length,
      2,
    )
    assert.equal(
      filterPortalPackages(rows, {
        query: "",
        inStockOnly: false,
        duration: "saturday_only",
        family: "",
      }).length,
      1,
    )
    assert.equal(
      filterPortalPackages(rows, {
        query: "",
        inStockOnly: false,
        duration: "",
        family: "West Grandstand Tickets",
      })[0]?.name,
      "3 Day West Grandstand Tickets",
    )
  })
})
