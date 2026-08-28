import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { AccountKind } from "../lib/crm/account-kinds"
import {
  classifyExistingAccount,
  compareLeadQueueRows,
  DEFAULT_LEAD_STAGE_FILTER,
  dealStageCountsAsBooked,
  isLeadWorkQueueAccount,
  isSupplierOnlyAccount,
  leadStageMatchesFilter,
  newAccountLifecycle,
  orderCountsAsBooked,
  promoteLeadToClient,
  type AccountLeadStage,
  type AccountLifecycle,
} from "../lib/crm/account-lifecycle"

function row(input: {
  name: string
  lifecycle?: AccountLifecycle
  lead_stage?: AccountLeadStage
  account_types?: AccountKind[]
  owner_profile_id?: string | null
  created_at?: string
}) {
  return {
    name: input.name,
    lifecycle: input.lifecycle ?? "lead",
    lead_stage: input.lead_stage ?? "new",
    account_types: input.account_types ?? ["travel_agency"],
    owner_profile_id: input.owner_profile_id ?? null,
    created_at: input.created_at ?? "2026-08-27T10:00:00.000Z",
  }
}

describe("account lifecycle", () => {
  it("starts new records as lead / new", () => {
    assert.deepEqual(newAccountLifecycle(), { lifecycle: "lead", leadStage: "new" })
  })

  it("backfills booked accounts as clients and everyone else as later leads", () => {
    assert.deepEqual(classifyExistingAccount({ hasBookedDeal: true, hasNonCancelledOrder: false }), {
      lifecycle: "client",
      leadStage: "later",
    })
    assert.deepEqual(classifyExistingAccount({ hasBookedDeal: false, hasNonCancelledOrder: true }), {
      lifecycle: "client",
      leadStage: "later",
    })
    assert.deepEqual(classifyExistingAccount({ hasBookedDeal: false, hasNonCancelledOrder: false }), {
      lifecycle: "lead",
      leadStage: "later",
    })
  })

  it("treats signed deals as booked, not only paid", () => {
    assert.equal(dealStageCountsAsBooked("signed"), true)
    assert.equal(dealStageCountsAsBooked("awaiting_payment"), true)
    assert.equal(dealStageCountsAsBooked("paid_confirmed"), true)
    assert.equal(dealStageCountsAsBooked("draft"), false)
    assert.equal(dealStageCountsAsBooked("proposal"), false)
    assert.equal(dealStageCountsAsBooked("awaiting_client_signature"), false)
    assert.equal(orderCountsAsBooked("paid"), true)
    assert.equal(orderCountsAsBooked("cancelled"), false)
  })

  it("auto-promotes lead to client and never the reverse", () => {
    assert.equal(promoteLeadToClient("lead"), "client")
    assert.equal(promoteLeadToClient("client"), "client")
  })

  it("keeps supplier-only companies out of the leads work queue", () => {
    assert.equal(isSupplierOnlyAccount(["supplier"]), true)
    assert.equal(isSupplierOnlyAccount(["supplier", "travel_agency"]), false)
    assert.equal(isSupplierOnlyAccount([]), false)
    assert.equal(
      isLeadWorkQueueAccount(row({ name: "Formula Stock Co", account_types: ["supplier"] })),
      false,
    )
    assert.equal(
      isLeadWorkQueueAccount(row({ name: "Apex Travel", lifecycle: "client" })),
      false,
    )
    assert.equal(isLeadWorkQueueAccount(row({ name: "Apex Travel" })), true)
  })

  it("defaults the leads tab to the New + Reach out work queue", () => {
    assert.equal(DEFAULT_LEAD_STAGE_FILTER, "work")
    assert.equal(leadStageMatchesFilter("new", "work"), true)
    assert.equal(leadStageMatchesFilter("reach_out", "work"), true)
    assert.equal(leadStageMatchesFilter("talking", "work"), false)
    assert.equal(leadStageMatchesFilter("later", "work"), false)
    assert.equal(leadStageMatchesFilter("later", "later"), true)
    assert.equal(leadStageMatchesFilter("not_a_fit", "all"), true)
    assert.equal(leadStageMatchesFilter("not_a_fit", "work"), false)
  })

  it("sorts the queue with New first, then unassigned within a stage", () => {
    const sorted = [
      row({ name: "Later Co", lead_stage: "later", created_at: "2026-08-27T12:00:00.000Z" }),
      row({ name: "Assigned New", lead_stage: "new", owner_profile_id: "staff-1", created_at: "2026-08-26T10:00:00.000Z" }),
      row({ name: "Unassigned New", lead_stage: "new", created_at: "2026-08-25T10:00:00.000Z" }),
      row({ name: "Talking Co", lead_stage: "talking" }),
    ].sort(compareLeadQueueRows)

    assert.deepEqual(
      sorted.map((item) => item.name),
      ["Unassigned New", "Assigned New", "Talking Co", "Later Co"],
    )
  })
})
