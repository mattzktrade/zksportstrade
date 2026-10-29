import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildSalesDigest, digestDateKey, digestIsEmpty, salesDigestDue, type DigestDeal } from "../lib/crm/sales-digest"
import { summarizeCallAttempts } from "../lib/crm/call-outcomes"

const NOW = new Date("2026-10-29T05:30:00Z")

function deal(overrides: Partial<DigestDeal>): DigestDeal {
  return {
    id: "d1",
    reference: "DL0001",
    stage: "draft",
    enquiry_stage: "new",
    source: "marketing",
    created_at: "2026-10-29T04:00:00.000Z",
    next_action: null,
    next_action_due_at: null,
    owner_profile_id: null,
    name: "Jane",
    phone: "+971500000000",
    interest: "Abu Dhabi Grand Prix",
    ...overrides,
  }
}

describe("sales digest", () => {
  it("sends from 9:00 Dubai and keys by the Dubai date", () => {
    assert.equal(salesDigestDue(new Date("2026-10-29T04:59:00Z")), false)
    assert.equal(salesDigestDue(new Date("2026-10-29T05:00:00Z")), true)
    assert.equal(digestDateKey(new Date("2026-10-29T21:00:00Z")), "2026-10-30")
  })

  it("shows unclaimed new leads only to people who pick them up", () => {
    const deals = [deal({})]
    const sam = buildSalesDigest({ deals, calls: {}, ownerProfileId: "sam", includeUnclaimed: true, now: NOW })
    assert.equal(sam.unclaimed.length, 1)
    assert.equal(sam.unclaimed[0].task, "First call")
    const matt = buildSalesDigest({ deals, calls: {}, ownerProfileId: "matt", includeUnclaimed: false, now: NOW })
    assert.equal(digestIsEmpty(matt), true)
  })

  it("lists my calls, callbacks and follow-ups due today, not tomorrow", () => {
    const calls = {
      d1: summarizeCallAttempts([
        {
          id: "c1",
          deal_id: "d1",
          attempt_no: 1,
          outcome: "no_answer",
          lost_reason: null,
          notes: null,
          callback_at: null,
          actor_profile_id: "ollie",
          created_at: "2026-10-28T10:00:00.000Z",
        },
      ]),
    }
    const deals = [
      deal({ id: "d1", owner_profile_id: "ollie", next_action_due_at: "2026-10-29T06:00:00.000Z" }),
      deal({
        id: "d2",
        owner_profile_id: "ollie",
        enquiry_stage: "contacted",
        next_action: "Call back",
        next_action_due_at: "2026-10-29T12:00:00.000Z",
      }),
      deal({ id: "d3", owner_profile_id: "ollie", enquiry_stage: "follow_up", next_action_due_at: "2026-10-27T06:00:00.000Z" }),
      deal({ id: "d4", owner_profile_id: "ollie", enquiry_stage: "follow_up", next_action_due_at: "2026-10-30T06:00:00.000Z" }),
      deal({ id: "d5", owner_profile_id: "sam", enquiry_stage: "follow_up", next_action_due_at: "2026-10-27T06:00:00.000Z" }),
      deal({ id: "d6", owner_profile_id: "ollie", source: "website" }),
    ]
    const digest = buildSalesDigest({ deals, calls, ownerProfileId: "ollie", includeUnclaimed: true, now: NOW })
    assert.deepEqual(digest.calls.map((row) => row.dealId), ["d1"])
    assert.equal(digest.calls[0].task, "Call 2, last: No answer")
    assert.deepEqual(digest.nextSteps.map((row) => [row.dealId, row.task]), [["d2", "Call back"]])
    assert.deepEqual(digest.followUps.map((row) => row.dealId), ["d3"])
    assert.equal(digest.unclaimed.length, 0)
  })
})
