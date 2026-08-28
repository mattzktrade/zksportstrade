import assert from "node:assert/strict"
import test from "node:test"
import {
  cancellationEligibleDate,
  daysOverdue,
  paymentReminderIsDue,
} from "../lib/crm/deal-finance"
import { DEFAULT_FINANCE_CC, DEFAULT_BOOKINGS_CC, DEFAULT_OPERATIONS_CC, getInvoiceFinanceCc, getBookingConfirmationCc, getOperationsEmailCc } from "../lib/email/config"
import { invoiceDisplayStatus, pickPreferredInvoice } from "../lib/invoices/status"

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

test("invoice and reminder emails only CC finance", () => {
  const previous = process.env.XERO_INVOICE_CC
  process.env.XERO_INVOICE_CC = "matt@zk-sports.com, accounts@zk-sports.com"
  try {
    assert.deepEqual(getInvoiceFinanceCc("agent@example.com"), [DEFAULT_FINANCE_CC])
    assert.deepEqual(getInvoiceFinanceCc(DEFAULT_FINANCE_CC), [])
  } finally {
    if (previous === undefined) delete process.env.XERO_INVOICE_CC
    else process.env.XERO_INVOICE_CC = previous
  }
})

test("booking confirmations CC bookings and operations emails CC Jenny", () => {
  assert.equal(DEFAULT_BOOKINGS_CC, "bookings@zk-sports.com")
  assert.equal(DEFAULT_OPERATIONS_CC, "jenny@zk-sports.com")
  assert.deepEqual(getBookingConfirmationCc("agent@example.com"), [DEFAULT_BOOKINGS_CC])
  assert.deepEqual(getBookingConfirmationCc(DEFAULT_BOOKINGS_CC), [])
  assert.deepEqual(getOperationsEmailCc("client@example.com"), [DEFAULT_OPERATIONS_CC])
  assert.deepEqual(getOperationsEmailCc(DEFAULT_OPERATIONS_CC), [])
})

test("agent My Bookings prefers a delivered invoice over a paid one", () => {
  const chosen = pickPreferredInvoice([
    { status: "paid" },
    { status: "delivered" },
    { status: "awaiting_payment" },
  ])
  assert.equal(chosen?.status, "delivered")
  assert.equal(invoiceDisplayStatus("delivered"), "delivered")
  assert.equal(invoiceDisplayStatus("paid"), "paid")
})

