import assert from "node:assert/strict"
import test from "node:test"
import { decideAssistantAction } from "../lib/assistant/policy"
import { ASSISTANT_EVAL_CASES } from "../lib/assistant/eval-set"
import type { PolicyInput } from "../lib/assistant/types"

test("eval set has at least 50 send-versus-escalate cases", () => {
  assert.ok(ASSISTANT_EVAL_CASES.length >= 50, `got ${ASSISTANT_EVAL_CASES.length}`)
  const ids = ASSISTANT_EVAL_CASES.map((row) => row.id)
  assert.equal(new Set(ids).size, ids.length)
})

test("policy layer matches the eval set", () => {
  for (const row of ASSISTANT_EVAL_CASES) {
    const input = row.input as PolicyInput
    const result = decideAssistantAction(input)
    assert.equal(result.decision, row.expectedDecision, `${row.id}: ${row.prompt}`)
    if (result.decision === "sent") {
      assert.equal(result.autoSend, true, row.id)
      assert.equal(result.notifyStaff, false, row.id)
    } else if (result.decision === "skipped") {
      assert.equal(result.autoSend, false, row.id)
    } else {
      assert.equal(result.autoSend, false, row.id)
    }
  }
})

test("human takeover always wins over a confident FAQ", () => {
  const result = decideAssistantAction({
    killSwitch: false,
    autoSendEnabled: true,
    llmConfigured: true,
    envKillSwitch: false,
    confidence: 0.99,
    identity: "unique",
    packageResolution: "unique",
    factsMissing: false,
    toolFailed: false,
    wantsPriceCommit: false,
    allowPublishedTradePrices: false,
    wantsBooking: false,
    dealHasPricedLines: false,
    dealHasPackage: true,
    dealHasQuantity: true,
    sensitiveTopic: false,
    humanTakeover: true,
    withinCustomerWindow: true,
    stockStatus: "in_stock",
    mediaOnly: false,
    intent: "answer",
    needsHuman: false,
  })
  assert.equal(result.decision, "escalated")
  assert.equal(result.autoSend, false)
})
