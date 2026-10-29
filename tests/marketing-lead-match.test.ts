import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  marketingEventQueries,
  marketingPackageQueries,
  pickMarketingPackage,
  pickMarketingRace,
  looksLikeUselessInterestLabel,
} from "../lib/integrations/marketing-leads/match"
import { packageQueriesFromNotes } from "../lib/integrations/marketing-leads/outreach-interest"
import {
  marketingFormPackageHint,
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

  it("matches Abu Dhabi website package names to the 2026 catalog row", () => {
    const races = [
      {
        id: "abudhabi-2026",
        name: "Abu Dhabi Grand Prix",
        season: 2026,
        location: "Yas Marina",
        country: "UAE",
        short_name: "Abu Dhabi",
      },
      {
        id: "abudhabi-2027",
        name: "Abu Dhabi Grand Prix",
        season: 2027,
        location: "Yas Marina",
        country: "UAE",
        short_name: "Abu Dhabi",
      },
    ]
    const packages = [
      { id: "mv-3", name: "3 Day Marina Views Brunch", race_id: "abudhabi-2026", duration: "3_day" },
      { id: "sb-3", name: "3 Day Skybridge Terrace", race_id: "abudhabi-2026", duration: "3_day" },
      { id: "sb-fri", name: "Friday Skybridge Terrace", race_id: "abudhabi-2026", duration: "friday_only" },
      { id: "sb-sat", name: "Saturday Skybridge Terrace", race_id: "abudhabi-2026", duration: "saturday_only" },
      { id: "sb-sun", name: "Sunday Skybridge Terrace", race_id: "abudhabi-2026", duration: "sunday_only" },
      { id: "sb-ss", name: "Saturday & Sunday Skybridge Terrace", race_id: "abudhabi-2026", duration: "2_day" },
      { id: "sb-partner", name: "Skybridge Terrace - Event Partner", race_id: "abudhabi-2026", duration: "3_day" },
      { id: "pc-3", name: "3 Day Paddock Club", race_id: "abudhabi-2026", duration: "3_day" },
      { id: "pc-ferrari", name: "3 Day Paddock Club - Ferrari", race_id: "abudhabi-2026", duration: "3_day" },
      { id: "gs", name: "3 Day South Grandstand Tickets", race_id: "abudhabi-2026", duration: "3_day" },
    ]
    const race = pickMarketingRace(
      ["Abu Dhabi Grand Prix 2026", "Abu Dhabi GP 2026 website"],
      races,
      new Date("2026-10-20T12:00:00Z"),
    )
    assert.equal(race?.id, "abudhabi-2026")
    assert.equal(pickMarketingPackage(["3 Day Marina Views Brunch"], packages)?.id, "mv-3")
    assert.equal(pickMarketingPackage(["Friday Marina Views Brunch"], packages)?.id, "mv-3")
    assert.equal(pickMarketingPackage(["Friday Skybridge Terrace"], packages)?.id, "sb-fri")
    assert.equal(pickMarketingPackage(["Saturday Skybridge Terrace"], packages)?.id, "sb-sat")
    assert.equal(pickMarketingPackage(["Sunday Skybridge Terrace"], packages)?.id, "sb-sun")
    assert.equal(pickMarketingPackage(["3 Day Skybridge Terrace"], packages)?.id, "sb-3")
    assert.equal(pickMarketingPackage(["3 Day Paddock Club"], packages)?.id, "pc-3")
    assert.equal(pickMarketingPackage(["3 Day South Grandstand Tickets"], packages)?.id, "gs")
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
    assert.equal(parsed.payload.interest.package, null)
    assert.ok(
      marketingPackageQueries(parsed.payload).some((query) => /club suite/i.test(query)),
    )
    assert.ok(marketingEventQueries(parsed.payload).some((query) => /mexico/i.test(query)))
    const race = pickMarketingRace(marketingEventQueries(parsed.payload), mexicoRaces, new Date("2026-09-14T09:00:00Z"))
    const pkg = pickMarketingPackage(marketingPackageQueries(parsed.payload), mexicoPackages)
    assert.equal(race?.id, "mexico-2026")
    assert.equal(pkg?.id, "mexico-2026-3-day-paddock-club-club-suite")
  })

  it("reads Marsa Box and Skybridge day options from Choose your tickets", () => {
    assert.equal(marketingFormPackageHint("Abu Dhabi - marsa box- new"), "3 Day Marsa Box by ZK")
    assert.equal(marketingFormPackageHint("Abu Dhabi - sky bridge"), "3 Day Skybridge Terrace")
    assert.equal(
      marketingFormPackageHint("Abu Dhabi - sky bridge", "Friday = $495"),
      "Friday Skybridge Terrace",
    )
    assert.equal(
      marketingFormPackageHint("Abu Dhabi - marsa box- new", "Saturday = $2,250"),
      "Saturday Marsa Box by ZK",
    )

    const marsa = parseMarketingLeadWebhookBody({
      leadId: "1972708413692567",
      first_name: "Farhan",
      last_name: "Zaidi",
      email: "farhan.z@outlook.com",
      phone: "+971504577456",
      package: "/",
      quantity: "1",
      campaignName: "DF | Abu Dhabi",
      formName: "Abu Dhabi - marsa box- new",
      "Choose your tickets": "3 day weekend = $3,825",
    })
    assert.equal(marsa.ok, true)
    if (!marsa.ok) return
    assert.equal(marsa.payload.interest.package, "3 Day Marsa Box by ZK")
    assert.equal(marsa.payload.interest.quantity, 1)
    assert.ok(marketingPackageQueries(marsa.payload).includes("3 Day Marsa Box by ZK"))

    const skyFriday = parseMarketingLeadWebhookBody({
      leadId: "2119830475390119",
      first_name: "Oliver",
      last_name: "Fawaz",
      email: "oliver@zk-sports.com",
      phone: "+971556089074",
      package: "Friday = $495",
      quantity: 1,
      campaignName: "DF | Abu Dhabi",
      formName: "Abu Dhabi - sky bridge",
    })
    assert.equal(skyFriday.ok, true)
    if (!skyFriday.ok) return
    assert.equal(skyFriday.payload.interest.package, "Friday Skybridge Terrace")
    assert.equal(skyFriday.payload.interest.quantity, 1)

    const skyWeekend = parseMarketingLeadWebhookBody({
      leadId: "2119830475390120",
      first_name: "Oliver",
      last_name: "Fawaz",
      email: "oliver@zk-sports.com",
      phone: "+971556089074",
      campaignName: "DF | Abu Dhabi",
      formName: "Abu Dhabi - sky bridge",
      "Choose your tickets": "3 day weekend = $5,500",
    })
    assert.equal(skyWeekend.ok, true)
    if (!skyWeekend.ok) return
    assert.equal(skyWeekend.payload.interest.package, "3 Day Skybridge Terrace")
    assert.equal(skyWeekend.payload.interest.quantity, null)
  })

  it("recovers Club Suite from Instant Form notes if the enquiry was linked to a single-ticket SKU", () => {
    const notes = [
      "Marketing lead (Meta)",
      "Campaign: DF | Prospecting | Mexico",
      "Form: ZK Sports Lead form - Mexico 2026",
      "Paddock Club Club Suite 3 Days 8 500 Per Guest: Yes, that works for me",
    ].join("\n")
    const pkg = pickMarketingPackage(packageQueriesFromNotes(notes), mexicoPackages)
    assert.equal(pkg?.id, "mexico-2026-3-day-paddock-club-club-suite")
  })

  it("recovers Marsa Box from an Abu Dhabi form name in enquiry notes", () => {
    const notes = [
      "Marketing lead (Meta)",
      "Campaign: DF | Abu Dhabi",
      "Form: Abu Dhabi - marsa box- new",
      "Tickets: 3",
      "Choose your tickets: 3 day weekend = $3,825",
    ].join("\n")
    assert.ok(packageQueriesFromNotes(notes).includes("3 Day Marsa Box by ZK"))
    assert.ok(
      packageQueriesFromNotes(
        [
          "Marketing lead (Meta)",
          "Form: Abu Dhabi - sky bridge",
          "Choose your tickets: Friday = $495",
        ].join("\n"),
      ).includes("Friday Skybridge Terrace"),
    )
  })
})
