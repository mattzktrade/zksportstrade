import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { maxBookableGuestsFromSellable } from "../lib/catalog/booking-guests"

test("guest cap follows sellable stock and ignores suite capacity", () => {
  assert.equal(maxBookableGuestsFromSellable(8, 2), 8)
  assert.equal(maxBookableGuestsFromSellable(8, 0), 8)
  assert.equal(maxBookableGuestsFromSellable(0, 50), 0)
})

test("new package paddock templates no longer auto-tick enquiry", () => {
  const src = readFileSync("app/(admin)/admin/catalog/catalog-new-package.tsx", "utf8")
  assert.doesNotMatch(src, /setIsEnquiry\(t\.requiresBookingApproval\)/)
  assert.match(src, /setIsEnquiry\(false\)/)
})

test("portal package details no longer show suite capacity", () => {
  const src = readFileSync("app/(portal)/packages/race/[id]/race-packages-client.tsx", "utf8")
  assert.doesNotMatch(src, /Suite capacity/)
})
