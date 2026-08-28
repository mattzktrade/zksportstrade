import assert from "node:assert/strict"
import test from "node:test"
import { buildGuestDrafts } from "../app/(admin)/admin/operations/guest-editor"
import type { OperationsGuest } from "../lib/admin/workflow-views"
import { guestDetailsStatusFromNamedCount } from "../lib/operations/guest-status"

function guest(overrides: Partial<OperationsGuest> = {}): OperationsGuest {
  return {
    id: "g1",
    orderId: null,
    dealId: "deal-1",
    fullName: "Alex Reed",
    email: null,
    phone: null,
    nationality: null,
    dateOfBirth: null,
    dietaryRequirements: null,
    specialRequests: null,
    isLeadGuest: false,
    detailsComplete: true,
    sortOrder: 0,
    ...overrides,
  }
}

test("opens enough empty guest slots for the booking quantity", () => {
  const drafts = buildGuestDrafts([], 5)
  assert.equal(drafts.length, 5)
  assert.equal(drafts[0]?.isLeadGuest, true)
  assert.equal(drafts.slice(1).every((row) => !row.isLeadGuest), true)
  assert.equal(drafts.every((row) => row.fullName === ""), true)
})

test("keeps existing guests and fills the remaining slots", () => {
  const drafts = buildGuestDrafts(
    [guest({ id: "a", fullName: "Alex Reed", isLeadGuest: true, sortOrder: 0 })],
    4,
  )
  assert.equal(drafts.length, 4)
  assert.equal(drafts[0]?.fullName, "Alex Reed")
  assert.equal(drafts[0]?.isLeadGuest, true)
  assert.equal(drafts.filter((row) => !row.id).length, 3)
})

test("guest details status becomes complete when every name is in", () => {
  assert.equal(guestDetailsStatusFromNamedCount(2, 2, "requested"), "complete")
  assert.equal(guestDetailsStatusFromNamedCount(2, 2, "not_requested"), "complete")
  assert.equal(guestDetailsStatusFromNamedCount(2, 2, "partial"), "complete")
  assert.equal(guestDetailsStatusFromNamedCount(1, 2, "requested"), "partial")
  assert.equal(guestDetailsStatusFromNamedCount(0, 2, "complete"), "requested")
  assert.equal(guestDetailsStatusFromNamedCount(0, 2, "not_requested"), "not_requested")
  assert.equal(guestDetailsStatusFromNamedCount(2, 2, "not_required"), "not_required")
})
