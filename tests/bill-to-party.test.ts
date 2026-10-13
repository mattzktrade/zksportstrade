import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { billToPartyNames } from "../lib/format/bill-to-party"

test("matching account and full name only prints the full name", () => {
  assert.deepEqual(billToPartyNames("Fabiana Fernandez", "Fabiana Fernandez"), ["Fabiana Fernandez"])
  assert.deepEqual(billToPartyNames("  FABIANA   FERNANDEZ ", "Fabiana Fernandez"), ["Fabiana Fernandez"])
  assert.deepEqual(billToPartyNames("Fabiana Fernandez", "Fabiana  Fernandez"), ["Fabiana Fernandez"])
})

test("different account and full name still prints both", () => {
  assert.deepEqual(billToPartyNames("Sportfive UK Ltd", "Roisin McCarthy"), [
    "Sportfive UK Ltd",
    "Roisin McCarthy",
  ])
  assert.deepEqual(billToPartyNames("Example Agent", "Example Signer"), ["Example Agent", "Example Signer"])
})

test("missing either name still prints the remaining line", () => {
  assert.deepEqual(billToPartyNames("Acme Travel", ""), ["Acme Travel"])
  assert.deepEqual(billToPartyNames("", "Jane Client"), ["Jane Client"])
  assert.deepEqual(billToPartyNames("   ", "  "), [])
})

test("booking form and inclusion contract bill-to blocks use the shared helper", () => {
  assert.match(readFileSync("lib/booking-forms/pdf.ts", "utf8"), /billToPartyNames/)
  assert.match(readFileSync("app/sign/booking/[token]/signing-client.tsx", "utf8"), /billToPartyNames/)
  assert.match(readFileSync("lib/contracts/pdf.ts", "utf8"), /billToPartyNames/)
  assert.match(readFileSync("app/sign/contract/[token]/signing-client.tsx", "utf8"), /billToPartyNames/)
})
