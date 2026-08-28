import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { safeEqualStrings } from "../lib/crypto/timing-safe"

describe("safeEqualStrings", () => {
  it("accepts identical secrets", () => {
    assert.equal(safeEqualStrings("cron-secret", "cron-secret"), true)
  })

  it("rejects different values and different lengths", () => {
    assert.equal(safeEqualStrings("cron-secret", "cron-secreT"), false)
    assert.equal(safeEqualStrings("short", "much-longer-secret"), false)
    assert.equal(safeEqualStrings("", "secret"), false)
  })
})
