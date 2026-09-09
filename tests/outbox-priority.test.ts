import assert from "node:assert/strict"
import test from "node:test"
import {
  INVOICE_CREATE_PER_BATCH,
  mergePrioritizedOutboxBatch,
  sortOutboxJobsForProcessing,
} from "../lib/integrations/outbox-priority"
import {
  parseXeroOrgDefaultsCache,
  xeroOrgEnvFingerprint,
  XERO_ORG_DEFAULTS_TTL_MS,
} from "../lib/integrations/xero/invoice-line-defaults"
import { isXeroProcessBudgetExhausted, XERO_PROCESS_CALL_BUDGET } from "../lib/integrations/xero/client"

test("outbox sorts invoice.create jobs ahead of catalog and order sync", () => {
  const rows = sortOutboxJobsForProcessing([
    { id: "p1", event_type: "product.upsert", created_at: "2026-09-09T09:00:00.000Z" },
    { id: "i2", event_type: "invoice.create", created_at: "2026-09-09T09:02:00.000Z" },
    { id: "i1", event_type: "invoice.create", created_at: "2026-09-09T09:01:00.000Z" },
    { id: "o1", event_type: "order.placed", created_at: "2026-09-09T08:00:00.000Z" },
  ])
  assert.deepEqual(
    rows.map((row) => row.id),
    ["i1", "i2", "o1", "p1"],
  )
})

test("outbox batch prefers a just-signed deal invoice and caps invoice creates", () => {
  const preferred = [{ id: "new", event_type: "invoice.create", created_at: "2026-09-09T10:00:00.000Z" }]
  const invoices = [
    { id: "old", event_type: "invoice.create", created_at: "2026-09-09T08:00:00.000Z" },
    { id: "new", event_type: "invoice.create", created_at: "2026-09-09T10:00:00.000Z" },
    { id: "mid", event_type: "invoice.create", created_at: "2026-09-09T09:00:00.000Z" },
    { id: "extra1", event_type: "invoice.create", created_at: "2026-09-09T09:10:00.000Z" },
    { id: "extra2", event_type: "invoice.create", created_at: "2026-09-09T09:20:00.000Z" },
    { id: "extra3", event_type: "invoice.create", created_at: "2026-09-09T09:30:00.000Z" },
  ]
  const others = [
    { id: "p1", event_type: "product.upsert", created_at: "2026-09-09T07:00:00.000Z" },
    { id: "p2", event_type: "product.upsert", created_at: "2026-09-09T07:01:00.000Z" },
  ]
  const merged = mergePrioritizedOutboxBatch({
    preferredInvoices: preferred,
    invoices,
    others,
    invoiceLimit: INVOICE_CREATE_PER_BATCH,
  })
  assert.equal(merged[0]?.id, "new")
  assert.equal(merged.filter((row) => row.event_type === "invoice.create").length, INVOICE_CREATE_PER_BATCH)
  assert.ok(merged.some((row) => row.id === "p1"))
  assert.equal(new Set(merged.map((row) => row.id)).size, merged.length)
})

test("Xero org defaults cache expires and ignores a different env fingerprint", () => {
  const fingerprint = xeroOrgEnvFingerprint()
  const fresh = JSON.stringify({
    accountCode: "200",
    taxType: "OUTPUT2",
    itemCode: "1001",
    currencies: ["USD", "GBP"],
    envFingerprint: fingerprint,
    fetchedAt: new Date().toISOString(),
  })
  assert.equal(parseXeroOrgDefaultsCache(fresh)?.taxType, "OUTPUT2")

  const stale = JSON.stringify({
    accountCode: "200",
    taxType: "OUTPUT2",
    itemCode: "1001",
    currencies: ["USD"],
    envFingerprint: fingerprint,
    fetchedAt: new Date(Date.now() - XERO_ORG_DEFAULTS_TTL_MS - 1000).toISOString(),
  })
  assert.equal(parseXeroOrgDefaultsCache(stale), null)

  const otherEnv = JSON.stringify({
    accountCode: "200",
    taxType: "OUTPUT2",
    itemCode: "1001",
    currencies: ["USD"],
    envFingerprint: "different",
    fetchedAt: new Date().toISOString(),
  })
  assert.equal(parseXeroOrgDefaultsCache(otherEnv), null)
  assert.equal(parseXeroOrgDefaultsCache("not-json"), null)
})

test("one process stops creating Xero invoices before the 60 calls/minute cap", () => {
  assert.ok(XERO_PROCESS_CALL_BUDGET < 60)
  assert.ok(XERO_PROCESS_CALL_BUDGET >= 20)
  assert.equal(isXeroProcessBudgetExhausted(XERO_PROCESS_CALL_BUDGET - 1), false)
  assert.equal(isXeroProcessBudgetExhausted(XERO_PROCESS_CALL_BUDGET), true)
})
