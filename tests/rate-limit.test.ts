import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { checkRateLimit, clientIpFromHeaders } from "../lib/auth/rate-limit"

describe("clientIpFromHeaders", () => {
  it("prefers the first forwarded-for hop", () => {
    const headers = new Headers({
      "x-forwarded-for": " 203.0.113.10, 10.0.0.1 ",
      "x-real-ip": "10.0.0.9",
    })
    assert.equal(clientIpFromHeaders(headers), "203.0.113.10")
  })

  it("falls back to x-real-ip and then unknown", () => {
    assert.equal(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2")
    assert.equal(clientIpFromHeaders(new Headers()), "unknown")
  })
})

describe("checkRateLimit", () => {
  it("allows a burst then blocks the same key", () => {
    const key = `test:${Date.now()}-${Math.random()}`
    assert.equal(checkRateLimit(key, 2, 60_000), true)
    assert.equal(checkRateLimit(key, 2, 60_000), true)
    assert.equal(checkRateLimit(key, 2, 60_000), false)
  })
})
