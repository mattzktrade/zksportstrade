import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { readFileSync } from "node:fs"
import {
  FOLLOW_UP_CLOSED_SUMMARY,
  earliestTime,
  firstConnectedCall,
  firstFollowUpReminderAt,
  followUpAutoCloseDue,
  followUpMoveDue,
  followUpReminderDue,
  latestConnectedCall,
  latestTime,
  nextFollowUpReminderAt,
} from "../lib/crm/marketing-follow-up"
import { summarizeCallAttempts, type EnquiryCallAttempt } from "../lib/crm/call-outcomes"
import { MARKETING_LEAD_NOTIFY_EMAILS } from "../lib/integrations/marketing-leads/notify"

function attempt(outcome: EnquiryCallAttempt["outcome"], createdAt: string): EnquiryCallAttempt {
  return {
    id: createdAt,
    deal_id: "deal-1",
    attempt_no: 1,
    outcome,
    lost_reason: null,
    notes: null,
    callback_at: null,
    actor_profile_id: null,
    created_at: createdAt,
  }
}

describe("In conversation to Deciding", () => {
  it("moves a lead a day after the first conversation, not before", () => {
    const conversationAt = "2026-10-28T08:00:00.000Z"
    assert.equal(followUpMoveDue({ conversationAt, nextActionDueAt: null, now: new Date("2026-10-29T07:59:00Z") }), false)
    assert.equal(followUpMoveDue({ conversationAt, nextActionDueAt: null, now: new Date("2026-10-29T08:00:00Z") }), true)
  })

  it("starts the clock from a reply when nobody has spoken on the phone", () => {
    const replied = "2026-10-28T12:00:00.000Z"
    const conversationAt = earliestTime(firstConnectedCall(summarizeCallAttempts([]))?.created_at, replied)
    assert.equal(conversationAt, replied)
    assert.equal(followUpMoveDue({ conversationAt, nextActionDueAt: null, now: new Date("2026-10-29T12:00:00Z") }), true)
  })

  it("starts the clock from whichever came first, call or reply", () => {
    const summary = summarizeCallAttempts([
      attempt("connected_interested", "2026-10-27T08:00:00.000Z"),
      attempt("connected_callback", "2026-10-28T08:00:00.000Z"),
    ])
    assert.equal(firstConnectedCall(summary)?.created_at, "2026-10-27T08:00:00.000Z")
    assert.equal(earliestTime(firstConnectedCall(summary)?.created_at, "2026-10-28T20:00:00.000Z"), "2026-10-27T08:00:00.000Z")
  })

  it("waits for a booked callback that is later than a day", () => {
    const input = { conversationAt: "2026-10-28T08:00:00.000Z", nextActionDueAt: "2026-10-31T06:00:00.000Z" }
    assert.equal(followUpMoveDue({ ...input, now: new Date("2026-10-30T08:00:00Z") }), false)
    assert.equal(followUpMoveDue({ ...input, now: new Date("2026-10-31T06:00:00Z") }), true)
  })

  it("never moves a lead with no conversation", () => {
    assert.equal(followUpMoveDue({ conversationAt: null, nextActionDueAt: null, now: new Date() }), false)
  })

  it("only picks up In conversation leads, for every source, and sets the deal to proposal", () => {
    const src = readFileSync("lib/integrations/marketing-leads/follow-up-process.ts", "utf8")
    const move = src.slice(src.indexOf("async function moveInConversationToDeciding"), src.indexOf("async function remindOrClose"))
    assert.match(move, /\.eq\("enquiry_stage", "contacted"\)/)
    assert.doesNotMatch(move, /sourcing/)
    assert.doesNotMatch(src, /\.eq\("source", "marketing"\)/)
    assert.match(move, /stage: "proposal"/)
  })
})

describe("Deciding reminders and auto-close", () => {
  it("uses the latest connected call, ignoring later unanswered ones", () => {
    const summary = summarizeCallAttempts([
      attempt("connected_interested", "2026-10-20T08:00:00.000Z"),
      attempt("connected_callback", "2026-10-22T08:00:00.000Z"),
      attempt("no_answer", "2026-10-25T08:00:00.000Z"),
    ])
    assert.equal(latestConnectedCall(summary)?.created_at, "2026-10-22T08:00:00.000Z")
    assert.equal(latestConnectedCall(summarizeCallAttempts([attempt("voicemail", "2026-10-22T08:00:00.000Z")])), null)
    assert.equal(latestTime("2026-10-22T08:00:00.000Z", null, "2026-10-24T08:00:00.000Z"), "2026-10-24T08:00:00.000Z")
  })

  it("holds the first reminder until 9:00 Dubai", () => {
    assert.equal(firstFollowUpReminderAt(new Date("2026-10-29T01:00:00Z")).toISOString(), "2026-10-29T05:00:00.000Z")
    const daytime = new Date("2026-10-29T08:00:00Z")
    assert.equal(firstFollowUpReminderAt(daytime).toISOString(), daytime.toISOString())
  })

  it("spaces reminders to day 1, 3 and 7 at 10:00 Dubai", () => {
    const first = new Date("2026-10-29T08:00:00Z")
    const second = nextFollowUpReminderAt(1, first)
    assert.equal(second.toISOString(), "2026-10-31T06:00:00.000Z")
    const third = nextFollowUpReminderAt(2, second)
    assert.equal(third.toISOString(), "2026-11-04T06:00:00.000Z")
  })

  it("sends three reminders and no more", () => {
    const overdue = "2026-10-29T08:00:00.000Z"
    const now = new Date("2026-10-30T08:00:00Z")
    assert.equal(followUpReminderDue({ nextActionDueAt: overdue, remindersSent: 0, lastReminderAt: null, now }), true)
    assert.equal(followUpReminderDue({ nextActionDueAt: overdue, remindersSent: 1, lastReminderAt: overdue, now }), false)
    assert.equal(
      followUpReminderDue({
        nextActionDueAt: overdue,
        remindersSent: 1,
        lastReminderAt: overdue,
        now: new Date("2026-10-31T06:00:00Z"),
      }),
      true,
    )
    assert.equal(
      followUpReminderDue({
        nextActionDueAt: overdue,
        remindersSent: 3,
        lastReminderAt: "2026-11-04T06:00:00.000Z",
        now: new Date("2026-12-01T06:00:00Z"),
      }),
      false,
    )
  })

  it("does not remind before the follow-up date or when there is no date", () => {
    const now = new Date("2026-10-30T08:00:00Z")
    assert.equal(
      followUpReminderDue({ nextActionDueAt: "2026-11-01T08:00:00.000Z", remindersSent: 0, lastReminderAt: null, now }),
      false,
    )
    assert.equal(followUpReminderDue({ nextActionDueAt: null, remindersSent: 0, lastReminderAt: null, now }), false)
  })

  it("restarts the cycle a day after a call or reply", () => {
    const base = { nextActionDueAt: "2026-10-29T08:00:00.000Z", remindersSent: 0, lastReminderAt: null }
    const lastConversationAt = "2026-11-05T09:00:00.000Z"
    assert.equal(followUpReminderDue({ ...base, lastConversationAt, now: new Date("2026-11-05T20:00:00Z") }), false)
    assert.equal(followUpReminderDue({ ...base, lastConversationAt, now: new Date("2026-11-06T09:00:00Z") }), true)
  })

  it("closes exactly 7 days after the third reminder", () => {
    const base = {
      nextActionDueAt: "2026-10-29T08:00:00.000Z",
      remindersSent: 3,
      lastReminderAt: "2026-11-04T06:00:00.000Z",
    }
    assert.equal(followUpAutoCloseDue({ ...base, now: new Date("2026-11-11T05:59:00Z") }), false)
    assert.equal(followUpAutoCloseDue({ ...base, now: new Date("2026-11-11T06:00:00Z") }), true)
  })

  it("does not close before three reminders or while a callback is booked", () => {
    const now = new Date("2026-12-01T06:00:00Z")
    assert.equal(
      followUpAutoCloseDue({ nextActionDueAt: null, remindersSent: 2, lastReminderAt: "2026-11-01T06:00:00.000Z", now }),
      false,
    )
    assert.equal(
      followUpAutoCloseDue({
        nextActionDueAt: "2026-12-02T06:00:00.000Z",
        remindersSent: 3,
        lastReminderAt: "2026-11-01T06:00:00.000Z",
        now,
      }),
      false,
    )
  })

  it("closes as Not interested, cold, no further action, and stops the sequence", () => {
    const src = readFileSync("lib/integrations/marketing-leads/follow-up-process.ts", "utf8")
    assert.match(src, /enquiry_stage: "not_interested"/)
    assert.match(src, /enquiry_temperature: "cold"/)
    assert.match(src, /next_action: "No further action"/)
    assert.match(src, /summary: FOLLOW_UP_CLOSED_SUMMARY/)
    assert.match(src, /stopMarketingOutreach\(dealId, "not_interested"\)/)
    assert.equal(FOLLOW_UP_CLOSED_SUMMARY, "Closed as Not interested: no response 7 days after the last follow-up")
  })

  it("only counts reminders sent since the latest conversation", () => {
    const src = readFileSync("lib/integrations/marketing-leads/follow-up-process.ts", "utf8")
    assert.match(src, /last_client_message_at/)
    assert.match(src, /filter\(\(at\) => Date\.parse\(at\) > since\)/)
  })

  it("emails the owner, or Samantha and Oliver for an unowned marketing lead", () => {
    assert.deepEqual([...MARKETING_LEAD_NOTIFY_EMAILS], ["samantha@zk-sports.com", "oliver@zk-sports.com"])
    const src = readFileSync("lib/integrations/marketing-leads/follow-up-process.ts", "utf8")
    assert.match(src, /deal\.source === "marketing" \? \[\.\.\.MARKETING_LEAD_NOTIFY_EMAILS\] : \[\]/)
  })

  it("warns on the third reminder", () => {
    const src = readFileSync("lib/email/send-follow-up-reminder.ts", "utf8")
    assert.match(src, /Last reminder/)
    assert.match(src, /Still deciding/)
  })
})

describe("marketing leads", () => {
  it("imports marketing leads unassigned", () => {
    const src = readFileSync("lib/integrations/marketing-leads/ingest.ts", "utf8")
    assert.match(src, /owner_profile_id: null/)
    assert.doesNotMatch(src, /resolveOwnerProfileId/)
  })

  it("runs on the integration cron", () => {
    const src = readFileSync("lib/integrations/run-integration-cron.ts", "utf8")
    assert.match(src, /processDecidingFollowUps\(\)/)
  })
})
