import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { OVERDUE_XERO_RECONCILE_LIMIT } from "../lib/integrations/process-native-invoice-reminders"
import {
  cooldownMsFromRetryAfter,
  decideXeroInlineRetry,
  isRetryableXeroStatus,
  isXeroRateLimitError,
  isXeroRateLimitMessage,
  parseRetryAfterMs,
  XERO_DEFAULT_COOLDOWN_MS,
  XERO_MAX_INLINE_WAIT_MS,
  XERO_MIN_COOLDOWN_MS,
  XERO_RATE_LIMIT_USER_MESSAGE,
} from "../lib/integrations/xero/rate-limit"

test("Too Many Requests and HTTP 429 are treated as Xero rate limits", () => {
  assert.equal(isXeroRateLimitError("Too Many Requests"), true)
  assert.equal(isXeroRateLimitError(XERO_RATE_LIMIT_USER_MESSAGE), true)
  assert.equal(isXeroRateLimitError({ status: 429, message: "rate limited" }), true)
  assert.equal(isXeroRateLimitError(new Error("Too Many Requests")), true)
  assert.equal(isXeroRateLimitError("Contact email is missing"), false)
  assert.equal(isXeroRateLimitMessage("REQUEST_LIMIT_EXCEEDED"), false)
})

test("Retry-After is parsed as seconds or an HTTP date", () => {
  assert.equal(parseRetryAfterMs("2"), 2000)
  assert.equal(parseRetryAfterMs("1.5"), 1500)
  const now = Date.parse("2026-09-07T10:00:00.000Z")
  assert.equal(parseRetryAfterMs("Mon, 07 Sep 2026 10:00:05 GMT", now), 5000)
  assert.equal(parseRetryAfterMs(""), null)
  assert.equal(parseRetryAfterMs("nope"), null)
})

test("inline Xero retries wait briefly, then back off to the outbox cooldown", () => {
  assert.equal(isRetryableXeroStatus(429), true)
  assert.equal(isRetryableXeroStatus(503), true)
  assert.equal(isRetryableXeroStatus(400), false)

  const first = decideXeroInlineRetry({ tryIndex: 0, status: 429, retryAfterHeader: "1" })
  assert.equal(first.retry, true)
  assert.ok(first.waitMs >= 1000)
  assert.ok(first.waitMs <= XERO_MAX_INLINE_WAIT_MS)

  const longWait = decideXeroInlineRetry({ tryIndex: 0, status: 429, retryAfterHeader: "60" })
  assert.equal(longWait.retry, false)
  assert.equal(longWait.waitMs, 60_000)

  const exhausted = decideXeroInlineRetry({ tryIndex: 2, status: 429, retryAfterHeader: "1" })
  assert.equal(exhausted.retry, false)
})

test("shared Xero cooldown is at least 20s and at most 120s", () => {
  assert.equal(cooldownMsFromRetryAfter(null), XERO_DEFAULT_COOLDOWN_MS)
  assert.equal(cooldownMsFromRetryAfter(1000), XERO_MIN_COOLDOWN_MS)
  assert.equal(cooldownMsFromRetryAfter(45_000), 45_000)
  assert.equal(cooldownMsFromRetryAfter(10 * 60_000), 120_000)
})

test("overdue Xero reconciliation stays well under the 60 calls/minute cap", () => {
  assert.ok(OVERDUE_XERO_RECONCILE_LIMIT <= 20)
  assert.ok(OVERDUE_XERO_RECONCILE_LIMIT >= 5)
})

test("cron creates Xero invoices before reconciling overdue invoices", () => {
  const source = readFileSync("lib/integrations/run-integration-cron.ts", "utf8")
  const fn = source.slice(source.indexOf("export async function runIntegrationCronJob"))
  assert.ok(fn.indexOf("await drainIntegrationOutbox") < fn.indexOf("await processNativeInvoiceReminders"))
})

test("outbox keeps Xero 429 invoice jobs pending and requeues previously failed ones", () => {
  const source = readFileSync("lib/integrations/process-outbox.ts", "utf8")
  assert.match(source, /isXeroRateLimitError/)
  assert.match(source, /requeueRateLimitedInvoiceJobs/)
  assert.match(source, /xero_sync_status: rateLimited \? "pending" : "failed"/)
  assert.match(source, /attempts: row\.attempts/)
  assert.doesNotMatch(source, /isXeroRateLimitError\(e\) \|\|/)
})
