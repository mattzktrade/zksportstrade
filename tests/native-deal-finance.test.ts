import assert from "node:assert/strict"
import test from "node:test"
import {
  cancellationEligibleDate,
  daysOverdue,
  paymentReminderIsDue,
} from "../lib/crm/deal-finance"
import { DEFAULT_FINANCE_CC, getInvoiceFinanceCc } from "../lib/email/config"

test("native invoice cancellation becomes eligible 28 days after due date", () => {
  assert.equal(cancellationEligibleDate("2026-08-01"), "2026-08-29")
  assert.equal(daysOverdue("2026-08-01", new Date("2026-08-29T12:00:00.000Z")), 28)
})

test("payment reminders run weekly and stop after five sends", () => {
  const now = new Date("2026-08-20T12:00:00.000Z")
  assert.equal(paymentReminderIsDue({ reminderCount: 0, lastReminderAt: null, now }), true)
  assert.equal(
    paymentReminderIsDue({
      reminderCount: 1,
      lastReminderAt: "2026-08-14T13:00:00.000Z",
      now,
    }),
    false,
  )
  assert.equal(
    paymentReminderIsDue({
      reminderCount: 1,
      lastReminderAt: "2026-08-13T12:00:00.000Z",
      now,
    }),
    true,
  )
  assert.equal(paymentReminderIsDue({ reminderCount: 5, lastReminderAt: null, now }), false)
})

test("invoice and reminder emails always CC finance", () => {
  const previous = process.env.XERO_INVOICE_CC
  delete process.env.XERO_INVOICE_CC
  try {
    assert.deepEqual(getInvoiceFinanceCc("agent@example.com"), [DEFAULT_FINANCE_CC])
    assert.deepEqual(getInvoiceFinanceCc(DEFAULT_FINANCE_CC), [])
    process.env.XERO_INVOICE_CC = "accounts@zk-sports.com, finance@zk-sports.com"
    assert.deepEqual(getInvoiceFinanceCc("agent@example.com"), [
      DEFAULT_FINANCE_CC,
      "accounts@zk-sports.com",
    ])
  } finally {
    if (previous === undefined) delete process.env.XERO_INVOICE_CC
    else process.env.XERO_INVOICE_CC = previous
  }
})

