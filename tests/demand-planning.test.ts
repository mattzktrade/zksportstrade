import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import {
  aggregateDemand,
  demandConversionRate,
  demandDealOutcome,
  demandWinRate,
  lineMatchesClientFilter,
  type DemandPlanningLine,
} from "../lib/crm/demand-planning"

function line(overrides: Partial<DemandPlanningLine>): DemandPlanningLine {
  return {
    dealId: "d1",
    stage: "draft",
    enquiryStage: "price_sent",
    source: "offline",
    accountId: "a1",
    accountKinds: ["direct_client"],
    eventId: "e1",
    eventName: "Abu Dhabi GP",
    eventSeason: 2026,
    packageId: "p1",
    packageName: "Paddock Club",
    quantity: 4,
    ...overrides,
  }
}

test("demand outcomes split open, converted, won, and lost", () => {
  assert.equal(demandDealOutcome({ stage: "draft", enquiryStage: "price_sent" }), "open")
  assert.equal(demandDealOutcome({ stage: "awaiting_booking_form_send", enquiryStage: "price_sent" }), "converted")
  assert.equal(demandDealOutcome({ stage: "paid_confirmed", enquiryStage: "price_sent" }), "won")
  assert.equal(demandDealOutcome({ stage: "proposal", enquiryStage: "not_interested" }), "lost")
  assert.equal(demandDealOutcome({ stage: "closed_lost", enquiryStage: "follow_up" }), "lost")
})

test("demand aggregation counts unique deals per event and units per product", () => {
  const { totals, events } = aggregateDemand([
    line({ dealId: "open-1", quantity: 4 }),
    line({
      dealId: "open-1",
      packageId: "p2",
      packageName: "Grandstand",
      quantity: 2,
    }),
    line({
      dealId: "won-1",
      stage: "paid_confirmed",
      quantity: 6,
    }),
    line({
      dealId: "lost-1",
      enquiryStage: "not_interested",
      accountKinds: ["travel_agency"],
      quantity: 8,
    }),
  ])

  assert.equal(totals.enquiries, 3)
  assert.equal(totals.open, 1)
  assert.equal(totals.converted, 1)
  assert.equal(totals.won, 1)
  assert.equal(totals.lost, 1)
  assert.equal(totals.unitsAsked, 20)
  assert.equal(totals.unitsWon, 6)
  assert.equal(demandConversionRate(totals), 1 / 3)
  assert.equal(demandWinRate(totals), 1 / 3)

  const event = events[0]
  assert.equal(event?.eventName, "Abu Dhabi GP")
  assert.equal(event?.enquiries, 3)
  assert.equal(event?.products.length, 2)
  const paddock = event?.products.find((product) => product.packageName === "Paddock Club")
  assert.equal(paddock?.enquiries, 3)
  assert.equal(paddock?.unitsAsked, 18)
})

test("client type filter keeps direct and drops agents unless selected", () => {
  const direct = line({ accountKinds: ["direct_client"] })
  const agent = line({ dealId: "d2", accountKinds: ["ticket_agent"] })
  assert.equal(lineMatchesClientFilter(direct, ["direct_client"]), true)
  assert.equal(lineMatchesClientFilter(agent, ["direct_client"]), false)
  const { totals } = aggregateDemand([direct, agent], ["direct_client"])
  assert.equal(totals.enquiries, 1)
})

test("sales tracker has a demand tab for event and product planning", () => {
  const page = readFileSync("app/(admin)/admin/sales-tracker/page.tsx", "utf8")
  assert.match(page, /getDemandPlanningLines/)
  assert.match(page, /view === "demand"/)
  const nav = readFileSync("components/admin/sales-tracker-nav.tsx", "utf8")
  assert.match(nav, /Demand/)
  assert.match(nav, /view=demand/)
  const queries = readFileSync("lib/crm/demand-planning-queries.ts", "utf8")
  assert.match(queries, /from\("deals"\)/)
  assert.match(queries, /from\("deal_line_items"\)/)
  assert.match(queries, /from\("orders"\)/)
  assert.doesNotMatch(queries, /isEnquiryPipelineStage/)
  const client = readFileSync("components/admin/demand-planning-client.tsx", "utf8")
  assert.match(client, /demandClientFilterOptions/)
  assert.match(client, /Units won/)
  assert.match(client, /label="Deals"/)
  assert.match(client, /Total records/)
  const helpers = readFileSync("lib/crm/demand-planning.ts", "utf8")
  assert.match(helpers, /direct_client/)
  assert.match(helpers, /Agents/)
})
