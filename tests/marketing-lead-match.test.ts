import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  marketingEventQueries,
  marketingPackageQueries,
  pickMarketingPackage,
  pickMarketingRace,
  looksLikeUselessInterestLabel,
} from "../lib/integrations/marketing-leads/match"
import {
  parseMarketingLeadQuantity,
  parseMarketingLeadWebhookBody,
} from "../lib/integrations/marketing-leads/parse"

const mexicoRaces = [
  {
    id: "mexico-2026",
    name: "Mexico City Grand Prix",
    season: 2026,
    location: "Mexico City",
    country: "Mexico",
    short_name: "Mexico",
  },
  {
    id: "mexico-2027",
    name: "Mexico City Grand Prix",
    season: 2027,
    location: "Mexico City",
    country: "Mexico",
    short_name: "Mexico",
  },
  {
    id: "monaco-2026",
    name: "Monaco Grand Prix",
    season: 2026,
    location: "Monaco",
    country: "Monaco",
    short_name: "Monaco",
  },
]

const mexicoPackages = [
  {
    id: "mexico-2026-3-day-paddock-club-club-suite",
    name: "3 Day Paddock Club (Club Suite)",
    race_id: "mexico-2026",
    duration: "3_day",
  },
  {
    id: "mexico-paddock-club-house-44-2026",
    name: "3 Day Paddock Club - House 44",
    race_id: "mexico-2026",
    duration: "3_day",
  },
]

describe("marketing lead quantity", () => {
  it("uses the higher number when the guest count is a range", () => {
    assert.equal(parseMarketingLeadQuantity("2 Tickets"), 2)
    assert.equal(parseMarketingLeadQuantity("4-8"), 8)
    assert.equal(parseMarketingLeadQuantity("6 to 10 guests"), 10)
    assert.equal(parseMarketingLeadQuantity("8-10"), 10)
    assert.equal(parseMarketingLeadQuantity("up to 6"), 6)
    assert.equal(parseMarketingLeadQuantity("4+"), 4)
    assert.equal(parseMarketingLeadQuantity("8500"), null)
  })
})

describe("marketing catalog matching", () => {
  it("treats Instant Form yes answers as not a product name", () => {
    assert.equal(looksLikeUselessInterestLabel("Yes, that works for me"), true)
    assert.equal(looksLikeUselessInterestLabel("3 Day Paddock Club"), false)
  })

  it("picks 2026 Mexico City Grand Prix from a Mexico campaign", () => {
    const race = pickMarketingRace(["DF | Prospecting | Mexico"], mexicoRaces, new Date("2026-09-14T09:00:00Z"))
    assert.equal(race?.id, "mexico-2026")
  })

  it("picks Club Suite rather than House 44 from the form question", () => {
    const pkg = pickMarketingPackage(
      ["Paddock Club Club Suite 3 Days 8 500 Per Guest"],
      mexicoPackages,
    )
    assert.equal(pkg?.id, "mexico-2026-3-day-paddock-club-club-suite")
  })

  it("does not guess between two paddock clubs when the form is vague", () => {
    const pkg = pickMarketingPackage(["Paddock Club"], mexicoPackages)
    assert.equal(pkg, null)
  })

  it("reads product interest from a yes/no Instant Form question", () => {
    const parsed = parseMarketingLeadWebhookBody({
      leadId: "4565348490449449",
      first_name: "Kary",
      last_name: "Angel",
      email: "kary_avdelangel@hotmail.com",
      phone: "+524442702118",
      package: "Yes, that works for me",
      quantity: "2 Tickets",
      how_soon: "Within the next few weeks",
      campaignName: "DF | Prospecting | Mexico",
      formName: "ZK Sports Lead form - Mexico 2026",
      "Paddock Club Club Suite 3 Days 8 500 Per Guest": "Yes, that works for me",
    })
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.payload.interest.quantity, 2)
    assert.equal(looksLikeUselessInterestLabel(parsed.payload.interest.package ?? ""), true)
    assert.ok(
      marketingPackageQueries(parsed.payload).some((query) => /club suite/i.test(query)),
    )
    assert.ok(marketingEventQueries(parsed.payload).some((query) => /mexico/i.test(query)))
    const race = pickMarketingRace(marketingEventQueries(parsed.payload), mexicoRaces, new Date("2026-09-14T09:00:00Z"))
    const pkg = pickMarketingPackage(marketingPackageQueries(parsed.payload), mexicoPackages)
    assert.equal(race?.id, "mexico-2026")
    assert.equal(pkg?.id, "mexico-2026-3-day-paddock-club-club-suite")
  })
})
