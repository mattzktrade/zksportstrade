import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  UNMATCHED_CAMPAIGN_ID,
  buildCampaignReports,
  countCampaignLeads,
  type CampaignLead,
} from "../lib/crm/marketing-campaigns"
import { summarizeCallAttempts } from "../lib/crm/call-outcomes"

const now = new Date("2026-10-28T12:00:00.000Z")

function lead(overrides: Partial<CampaignLead> = {}): CampaignLead {
  return {
    id: Math.random().toString(36).slice(2),
    created_at: "2026-10-27T10:00:00.000Z",
    stage: "draft",
    enquiry_stage: "new",
    next_action_due_at: null,
    race_id: "abu",
    owner_profile_id: null,
    owner_name: null,
    enquiry_replied_at: null,
    ad_name: null,
    ...overrides,
  }
}

function call(dealId: string, outcome: "no_answer" | "connected_interested", at: string) {
  return summarizeCallAttempts([
    {
      id: `${dealId}-1`,
      deal_id: dealId,
      attempt_no: 1,
      outcome,
      lost_reason: null,
      notes: null,
      callback_at: null,
      actor_profile_id: null,
      actor_name: null,
      created_at: at,
    },
  ])
}

describe("marketing campaign report", () => {
  it("counts responses from messages and calls once per lead", () => {
    const counts = countCampaignLeads(
      [
        lead({ id: "a", enquiry_replied_at: "2026-10-27T11:00:00.000Z", calls: call("a", "connected_interested", "2026-10-27T10:05:00.000Z") }),
        lead({ id: "b", conversation: { clientReplied: true, needsOurReply: true } }),
        lead({ id: "c", calls: call("c", "no_answer", "2026-10-27T11:00:00.000Z"), next_action_due_at: "2026-10-28T18:00:00.000Z" }),
        lead({ id: "d", stage: "paid_confirmed", enquiry_stage: null }),
        lead({ id: "e", stage: "awaiting_client_signature", enquiry_stage: null }),
        lead({ id: "f", enquiry_stage: "not_interested", sequence: { status: "stopped", stop_reason: "not_interested" } }),
      ],
      now,
    )
    assert.equal(counts.leads, 6)
    assert.equal(counts.responded, 2)
    assert.equal(counts.repliedByMessage, 2)
    assert.equal(counts.spokeOnPhone, 1)
    assert.equal(counts.called, 2)
    assert.equal(counts.calledWithin15, 1)
    assert.equal(counts.waitingForOurReply, 1)
    assert.equal(counts.booked, 1)
    assert.equal(counts.bookingForm, 1)
    assert.equal(counts.notInterested, 1)
    assert.equal(counts.callsDueNow, 1)
  })

  it("keeps each event separate and puts unmatched leads last", () => {
    const races = new Map([
      ["abu", { name: "2026 Abu Dhabi Grand Prix", eventDate: "2026-12-06" }],
      ["mex", { name: "2026 Mexico City Grand Prix", eventDate: "2026-10-25" }],
    ])
    const reports = buildCampaignReports(
      [
        lead({ race_id: "mex", created_at: "2026-10-01T10:00:00.000Z" }),
        lead({ race_id: "abu", created_at: "2026-10-27T10:00:00.000Z", ad_name: "ADGP · Lookalike" }),
        lead({ race_id: "abu", created_at: "2026-10-26T10:00:00.000Z", ad_name: "ADGP · Lookalike" }),
        lead({ race_id: null, created_at: "2026-10-28T10:00:00.000Z" }),
      ],
      races,
      now,
    )
    assert.deepEqual(
      reports.map((row) => [row.id, row.counts.leads]),
      [
        ["abu", 2],
        ["mex", 1],
        [UNMATCHED_CAMPAIGN_ID, 1],
      ],
    )
    assert.equal(reports[0].byAd[0].label, "ADGP · Lookalike")
    assert.equal(reports[0].byAd[0].leads, 2)
  })
})
