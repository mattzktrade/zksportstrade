import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  CALL_OUTCOMES,
  enquiryCallDueAt,
  enquiryNeedsCall,
  nextCallDueAfterUnanswered,
  planCallOutcome,
  summarizeCallAttempts,
  type EnquiryCallAttempt,
} from "../lib/crm/call-outcomes"
import {
  isInsideContactWindow,
  nextContactWindowTime,
  timezoneForPhone,
} from "../lib/crm/lead-timezone"
import { outreachSendWindowStart } from "../lib/integrations/marketing-leads/outreach-delay"
import { computeMarketingCallStats } from "../lib/crm/marketing-call-stats"

const DUBAI = "Asia/Dubai"

const attempt = (n: number, outcome: EnquiryCallAttempt["outcome"], at: string): EnquiryCallAttempt => ({
  id: `a${n}`,
  deal_id: "deal",
  attempt_no: n,
  outcome,
  lost_reason: null,
  notes: null,
  callback_at: null,
  actor_profile_id: null,
  created_at: at,
})

describe("lead time zone", () => {
  it("guesses the zone from the dialling code, Dubai otherwise", () => {
    assert.equal(timezoneForPhone("+971 50 123 4567"), "Asia/Dubai")
    assert.equal(timezoneForPhone("447700900123"), "Europe/London")
    assert.equal(timezoneForPhone("919812345678"), "Asia/Kolkata")
    assert.equal(timezoneForPhone("0501234567"), "Asia/Dubai")
    assert.equal(timezoneForPhone(null), "Asia/Dubai")
  })

  it("moves times outside 9:00–20:00 to the next 9:00 local", () => {
    const late = new Date("2026-10-28T17:30:00.000Z")
    assert.equal(isInsideContactWindow(late, DUBAI), false)
    assert.equal(nextContactWindowTime(late, DUBAI).toISOString(), "2026-10-29T05:00:00.000Z")
    const early = new Date("2026-10-28T03:00:00.000Z")
    assert.equal(nextContactWindowTime(early, DUBAI).toISOString(), "2026-10-28T05:00:00.000Z")
    const midday = new Date("2026-10-28T08:00:00.000Z")
    assert.equal(nextContactWindowTime(midday, DUBAI).toISOString(), midday.toISOString())
  })
})

describe("outreach send window", () => {
  it("sends stage 1 straight away and holds stages 2 and 3 outside the window", () => {
    const night = new Date("2026-10-28T20:00:00.000Z")
    assert.equal(outreachSendWindowStart(1, "971501234567", night), null)
    assert.equal(outreachSendWindowStart(2, "971501234567", night)?.toISOString(), "2026-10-29T05:00:00.000Z")
    const londonEvening = new Date("2026-10-28T19:00:00.000Z")
    assert.equal(outreachSendWindowStart(3, "447700900123", londonEvening), null)
  })
})

describe("call cadence", () => {
  const now = new Date("2026-10-28T06:00:00.000Z")

  it("schedules the next call after an unanswered attempt", () => {
    assert.equal(nextCallDueAfterUnanswered(1, now, DUBAI)?.toISOString(), "2026-10-28T09:00:00.000Z")
    assert.equal(nextCallDueAfterUnanswered(2, now, DUBAI)?.toISOString(), "2026-10-29T14:00:00.000Z")
    assert.equal(nextCallDueAfterUnanswered(3, now, DUBAI)?.toISOString(), "2026-10-30T06:00:00.000Z")
    assert.equal(nextCallDueAfterUnanswered(4, now, DUBAI)?.toISOString(), "2026-10-31T10:00:00.000Z")
    assert.equal(nextCallDueAfterUnanswered(5, now, DUBAI), null)
  })

})

describe("call outcome rules", () => {
  const now = new Date("2026-10-28T06:00:00.000Z")
  const base = { now, timeZone: DUBAI, attemptNo: 1 }

  it("stops the sequence and moves to Contacted when someone speaks to them", () => {
    const plan = planCallOutcome({ ...base, outcome: "connected_interested" })
    assert.equal(plan.enquiryStage, "contacted")
    assert.equal(plan.stopReason, "spoke")
    const callback = new Date("2026-10-30T08:00:00.000Z")
    const later = planCallOutcome({ ...base, outcome: "connected_callback", callbackAt: callback })
    assert.equal(later.stopReason, "spoke")
    assert.equal(later.nextActionDueAt?.toISOString(), callback.toISOString())
  })

  it("closes the enquiry for not interested, booked, do not contact and spam", () => {
    assert.equal(planCallOutcome({ ...base, outcome: "connected_not_interested" }).stopReason, "not_interested")
    assert.equal(planCallOutcome({ ...base, outcome: "connected_booked" }).stopReason, "purchased")
    assert.equal(planCallOutcome({ ...base, outcome: "do_not_contact" }).stopReason, "do_not_contact")
    for (const outcome of ["connected_not_interested", "connected_booked", "do_not_contact", "unqualified"] as const) {
      assert.equal(planCallOutcome({ ...base, outcome }).enquiryStage, "not_interested")
    }
  })

  it("keeps the sequence running on no answer and schedules the next call", () => {
    for (const outcome of ["no_answer", "voicemail", "busy"] as const) {
      const plan = planCallOutcome({ ...base, outcome })
      assert.equal(plan.stopReason, null)
      assert.equal(plan.enquiryStage, null)
      assert.equal(plan.nextAction, "Call attempt 2")
      assert.ok(plan.nextActionDueAt)
    }
  })

  it("closes as Not interested after the fifth unanswered call but lets the last message go out", () => {
    for (const outcome of ["no_answer", "voicemail", "busy"] as const) {
      const plan = planCallOutcome({ ...base, attemptNo: 5, outcome })
      assert.equal(plan.noResponse, true)
      assert.equal(plan.enquiryStage, "not_interested")
      assert.equal(plan.temperature, "cold")
      assert.equal(plan.stopReason, null)
      assert.equal(plan.nextAction, "No further action")
      assert.equal(plan.nextActionDueAt, null)
    }
    assert.equal(planCallOutcome({ ...base, attemptNo: 4, outcome: "no_answer" }).enquiryStage, null)
  })

  it("never closes a lead someone has already spoken to", () => {
    const plan = planCallOutcome({ ...base, attemptNo: 5, outcome: "no_answer", spokeBefore: true })
    assert.equal(plan.noResponse, false)
    assert.equal(plan.enquiryStage, null)
    assert.equal(plan.nextAction, "Try them again")
    assert.ok(plan.nextActionDueAt)
  })

  it("checks earlier calls for a conversation before closing", () => {
    const src = readFileSync("app/(admin)/admin/enquiries/call-actions.ts", "utf8")
    assert.match(src, /spokeBefore/)
    assert.match(src, /callOutcomeConnected\(row\.outcome\)/)
  })

  it("blocks WhatsApp but keeps email for a wrong number", () => {
    const plan = planCallOutcome({ ...base, outcome: "wrong_number" })
    assert.equal(plan.blockWhatsApp, true)
    assert.equal(plan.stopReason, null)
  })

  it("has a plan for every outcome", () => {
    for (const outcome of CALL_OUTCOMES) {
      assert.ok(planCallOutcome({ ...base, outcome }).nextAction)
    }
  })
})

describe("call list", () => {
  const lead = {
    source: "marketing",
    stage: "draft",
    enquiry_stage: "new",
    created_at: "2026-10-28T06:00:00.000Z",
    next_action_due_at: null as string | null,
  }

  it("lists marketing leads on New nobody has spoken to", () => {
    assert.equal(enquiryNeedsCall(lead, undefined), true)
    assert.equal(enquiryNeedsCall({ ...lead, source: "website" }, undefined), false)
    assert.equal(enquiryNeedsCall({ ...lead, enquiry_stage: "contacted" }, undefined), false)
    const spoke = summarizeCallAttempts([attempt(1, "connected_interested", "2026-10-28T06:05:00.000Z")])
    assert.equal(enquiryNeedsCall(lead, spoke), false)
  })

  it("drops leads from the call list after five unanswered calls", () => {
    const five = summarizeCallAttempts(
      [1, 2, 3, 4, 5].map((n) => attempt(n, "no_answer", `2026-10-2${n}T06:00:00.000Z`)),
    )
    assert.equal(enquiryNeedsCall({ ...lead, next_action_due_at: "2026-10-31T06:00:00.000Z" }, five), false)
    const four = summarizeCallAttempts(five.history.slice(1))
    assert.equal(enquiryNeedsCall(lead, four), true)
  })

  it("puts the first call five minutes after the lead lands", () => {
    assert.equal(enquiryCallDueAt(lead, undefined), Date.parse("2026-10-28T06:05:00.000Z"))
    const one = summarizeCallAttempts([attempt(1, "no_answer", "2026-10-28T06:05:00.000Z")])
    assert.equal(
      enquiryCallDueAt({ ...lead, next_action_due_at: "2026-10-28T09:05:00.000Z" }, one),
      Date.parse("2026-10-28T09:05:00.000Z"),
    )
  })
})

describe("marketing call stats", () => {
  it("measures speed to first call, contact rate and bookings by owner", () => {
    const stats = computeMarketingCallStats({
      days: 30,
      deals: [
        { id: "d1", created_at: "2026-10-28T06:00:00.000Z", owner_profile_id: "o1", owner_name: "Oliver" },
        { id: "d2", created_at: "2026-10-28T06:00:00.000Z", owner_profile_id: "o1", owner_name: "Oliver" },
        { id: "d3", created_at: "2026-10-28T06:00:00.000Z", owner_profile_id: null, owner_name: null },
      ],
      attempts: [
        { deal_id: "d1", outcome: "connected_interested", lost_reason: null, created_at: "2026-10-28T06:10:00.000Z" },
        { deal_id: "d2", outcome: "no_answer", lost_reason: null, created_at: "2026-10-28T07:00:00.000Z" },
        { deal_id: "d2", outcome: "connected_not_interested", lost_reason: "price", created_at: "2026-10-29T07:00:00.000Z" },
      ],
      purchasedDealIds: ["d1"],
    })
    assert.equal(stats.total.leads, 3)
    assert.equal(stats.total.called, 2)
    assert.equal(stats.total.calledWithin15, 1)
    assert.equal(stats.total.medianFirstCallMinutes, 35)
    assert.equal(stats.total.connected, 2)
    assert.equal(stats.total.purchases, 1)
    assert.equal(stats.lostReasons.price, 1)
    assert.equal(stats.byOwner[0].ownerName, "Oliver")
    assert.equal(stats.byOwner[1].ownerName, "Unassigned")
  })
})

describe("call tracking wiring", () => {
  it("no longer marks leads Contacted when the bot sends stage 1", () => {
    const process = readFileSync("lib/integrations/marketing-leads/outreach-process.ts", "utf8")
    assert.doesNotMatch(process, /markEnquiryContacted/)
    assert.match(process, /outreachSendWindowStart/)
    assert.match(process, /whatsapp_blocked/)
  })

  it("stops the sequence when a lead books on the website", () => {
    const orders = readFileSync("lib/integrations/adgp/orders.ts", "utf8")
    assert.equal(orders.match(/stopOutreachForWebsiteBuyer\(admin/g)?.length, 2)
    const purchase = readFileSync("lib/integrations/marketing-leads/outreach-purchase.ts", "utf8")
    assert.match(purchase, /stopMarketingOutreach\(enrollment\.deal_id, "purchased"\)/)
  })

  it("does not enrol the same person twice", () => {
    const enroll = readFileSync("lib/integrations/marketing-leads/outreach-enroll.ts", "utf8")
    assert.match(enroll, /findActiveOutreachByEmail/)
    assert.match(enroll, /findActiveOutreachByPhone/)
    assert.match(enroll, /Already in follow-up on another enquiry/)
  })

  it("creates the call log table and backfills auto-Contacted leads", () => {
    const sql = readFileSync("supabase/migrations/20261028150000_enquiry_call_attempts.sql", "utf8")
    assert.match(sql, /create table if not exists public.enquiry_call_attempts/)
    assert.match(sql, /add column if not exists whatsapp_blocked/)
    assert.match(sql, /set enquiry_stage = 'new'/)
    const action = readFileSync("app/(admin)/admin/enquiries/call-actions.ts", "utf8")
    assert.match(action, /hasCmsPermission\(profile, "deals\.manage"\)/)
    assert.match(action, /stopMarketingOutreach\(dealId, plan\.stopReason\)/)
  })
})
