import assert from "node:assert/strict"
import test from "node:test"
import { appleWalletConfigured, googleWalletConfigured, walletPassStatus } from "../lib/tickets/wallet"

test("wallet buttons stay stubbed until issuer certificates exist", () => {
  const empty = {}
  assert.equal(appleWalletConfigured(empty), false)
  assert.equal(googleWalletConfigured(empty), false)
  assert.deepEqual(walletPassStatus(empty), { apple: "not_configured", google: "not_configured" })

  const ready = {
    APPLE_PASS_TYPE_ID: "pass.trade.zk.ticket",
    APPLE_TEAM_ID: "TEAM",
    APPLE_PASS_CERT: "CERT",
    APPLE_PASS_KEY: "KEY",
    APPLE_WWDR_CERT: "WWDR",
    GOOGLE_WALLET_ISSUER_ID: "3388",
    GOOGLE_WALLET_SA_JSON: "{}",
  }
  assert.deepEqual(walletPassStatus(ready), { apple: "ready", google: "ready" })
})
