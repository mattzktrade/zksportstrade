import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { formatXeroApiErrorBody } from "../lib/integrations/xero/format-error"
import { xeroAttemptIdempotencyKey } from "../lib/integrations/xero/invoices"
import {
  parseXeroOrgDefaultsCache,
  selectXeroAbuDhabiTaxType,
  xeroInvoiceItemCodeForLine,
  xeroOrgEnvFingerprint,
  XERO_ORG_DEFAULTS_MAX_STALE_MS,
  XERO_ORG_DEFAULTS_TTL_MS,
} from "../lib/integrations/xero/invoice-line-defaults"

test("Xero validation errors include nested invoice line messages", () => {
  assert.equal(
    formatXeroApiErrorBody(
      {
        Message: "An error occurred in Xero. Check the API Status page http://status.developer.xero.com for current service status.",
        Elements: [
          {
            ValidationErrors: [{ Message: "Invoice not of valid status for modification" }],
            LineItems: [
              { ValidationErrors: [{ Message: "TaxType is not valid" }] },
            ],
          },
        ],
      },
      "fallback",
    ),
    "Invoice not of valid status for modification; TaxType is not valid",
  )
  assert.equal(
    formatXeroApiErrorBody("<html><body>File or directory not found.</body></html>", "Not Found"),
    "Not Found",
  )
  assert.equal(formatXeroApiErrorBody({ Message: "An error occurred in Xero." }, "fallback"), "fallback")
})

test("Abu Dhabi tax uses a real 5% revenue rate instead of a missing TAX001 code", () => {
  assert.equal(
    selectXeroAbuDhabiTaxType({
      preferred: "TAX001",
      rates: [
        { TaxType: "OUTPUT", Status: "ACTIVE", CanApplyToRevenue: true, EffectiveRate: 0, Name: "Zero Rated Sales" },
        { TaxType: "TAX001", Status: "ACTIVE", CanApplyToRevenue: true, EffectiveRate: 5, Name: "DXB 5%" },
      ],
    }),
    "TAX001",
  )
  assert.equal(
    selectXeroAbuDhabiTaxType({
      preferred: "TAX001",
      rates: [
        { TaxType: "OUTPUT", Status: "ACTIVE", CanApplyToRevenue: true, EffectiveRate: 0, Name: "Zero Rated Sales" },
        { TaxType: "TAX005", Status: "ACTIVE", CanApplyToRevenue: true, EffectiveRate: 5, Name: "UAE VAT 5%" },
      ],
    }),
    "TAX005",
  )
  assert.equal(
    selectXeroAbuDhabiTaxType({
      preferred: "TAX001",
      rates: [
        { TaxType: "OUTPUT", Status: "ACTIVE", CanApplyToRevenue: true, EffectiveRate: 0, Name: "Zero Rated Sales" },
        { TaxType: "TAX001", Status: "DELETED", CanApplyToRevenue: true, EffectiveRate: 5, Name: "Old DXB" },
      ],
    }),
    null,
  )
})

test("tax-inclusive Abu Dhabi lines omit the Tickets item code", () => {
  assert.equal(xeroInvoiceItemCodeForLine({ itemCode: "1001", taxInclusive: true }), undefined)
  assert.equal(xeroInvoiceItemCodeForLine({ itemCode: "1001", taxInclusive: false }), "1001")
  assert.equal(xeroInvoiceItemCodeForLine({ itemCode: "  ", taxInclusive: false }), undefined)
})

test("expired Xero org defaults stay usable so invoice create does not wait on TaxRates", () => {
  const fingerprint = xeroOrgEnvFingerprint()
  const stale = JSON.stringify({
    accountCode: "200",
    taxType: "OUTPUT",
    itemCode: "1001",
    currencies: ["USD", "AED"],
    baseCurrency: "AED",
    envFingerprint: "old-fingerprint",
    fetchedAt: new Date(Date.now() - XERO_ORG_DEFAULTS_TTL_MS - 60_000).toISOString(),
  })
  assert.equal(parseXeroOrgDefaultsCache(stale), null)
  assert.equal(
    parseXeroOrgDefaultsCache(stale, Date.now(), fingerprint, { allowStale: true })?.taxType,
    "OUTPUT",
  )

  const tooOld = JSON.stringify({
    accountCode: "200",
    taxType: "OUTPUT",
    itemCode: "1001",
    currencies: ["USD"],
    envFingerprint: fingerprint,
    fetchedAt: new Date(Date.now() - XERO_ORG_DEFAULTS_MAX_STALE_MS - 1000).toISOString(),
  })
  assert.equal(parseXeroOrgDefaultsCache(tooOld, Date.now(), fingerprint, { allowStale: true }), null)

  const defaults = readFileSync("lib/integrations/xero/invoice-line-defaults.ts", "utf8")
  assert.match(defaults, /using env fallbacks/)
  assert.match(defaults, /refreshXeroOrgDefaultsBestEffort/)
  assert.match(defaults, /allowStale/)
})

test("each Xero invoice attempt sends a new idempotency key so a stored 500 is not replayed", () => {
  const base = "zk-invoice-cfb31716-689b-45c1-8651-a7883d850f60"
  const first = xeroAttemptIdempotencyKey(base, 1_000)
  const retry = xeroAttemptIdempotencyKey(base, 2_000)
  assert.notEqual(first, retry)
  assert.ok(first.startsWith(base))
  assert.ok(xeroAttemptIdempotencyKey(`${base}-r1793181770905-${"x".repeat(36)}`).length <= 128)

  const invoices = readFileSync("lib/integrations/xero/invoices.ts", "utf8")
  assert.doesNotMatch(invoices, /idempotencyKey: `zk-invoice-\$\{orderId\}`/)
  assert.ok(invoices.indexOf("Invoices?where=") < invoices.indexOf("xeroAttemptIdempotencyKey(baseKey)"))
})

test("automatic invoice create drains immediately and Retry Xero requeues stuck jobs", () => {
  const invoices = readFileSync("lib/integrations/xero/invoices.ts", "utf8")
  assert.match(invoices, /getXeroAbuDhabiTaxType/)
  assert.match(invoices, /xeroInvoiceItemCodeForLine/)
  assert.match(invoices, /Contact address update skipped/)
  assert.match(invoices, /retrying without address/)
  assert.doesNotMatch(invoices, /XERO_ABU_DHABI_TAX_TYPE\?\.trim\(\) \|\| "TAX001"/)

  const enqueue = readFileSync("lib/integrations/enqueue-server.ts", "utf8")
  assert.match(enqueue, /options\?: \{ retry\?: boolean \}/)
  assert.match(enqueue, /requeueExisting/)
  assert.match(enqueue, /existing.status !== "pending"/)

  const finance = readFileSync("app/(admin)/admin/deals/deal-finance-actions.ts", "utf8")
  assert.match(finance, /enqueueInvoiceCreateServer\(String\(deal\.order_id\), \{ retry: true \}\)/)
  assert.match(finance, /drainOutboxNow\(\{ orderId: String\(deal\.order_id\), maxRounds: 20 \}\)/)

  const client = readFileSync("lib/integrations/xero/client.ts", "utf8")
  assert.match(client, /XERO_FETCH_TIMEOUT_MS/)
  assert.match(client, /AbortSignal.timeout/)
})
