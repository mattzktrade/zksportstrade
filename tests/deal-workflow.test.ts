import assert from "node:assert/strict"
import test from "node:test"
import {
  allowedDealTransitions,
  canTransitionDeal,
} from "../lib/crm/deal-workflow"

test("deal workflow allows jumping to any valid stage", () => {
  assert.equal(canTransitionDeal("draft", "proposal"), true)
  assert.equal(canTransitionDeal("draft", "paid_confirmed"), true)
  assert.equal(canTransitionDeal("proposal", "fulfilled"), true)
  assert.equal(canTransitionDeal("proposal", "signed"), true)
  assert.equal(canTransitionDeal("awaiting_client_signature", "awaiting_payment"), true)
  assert.equal(canTransitionDeal("paid_confirmed", "fulfilled"), true)
  assert.equal(canTransitionDeal("fulfilled", "draft"), true)
})

test("open deals can close and closed deals can be reopened", () => {
  assert.ok(allowedDealTransitions("proposal").includes("closed_lost"))
  assert.ok(allowedDealTransitions("proposal").includes("cancelled"))
  assert.ok(allowedDealTransitions("proposal").includes("paid_confirmed"))
  assert.ok(allowedDealTransitions("closed_lost").includes("draft"))
  assert.ok(allowedDealTransitions("fulfilled").includes("paid_confirmed"))
})
