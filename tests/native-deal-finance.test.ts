import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { cancellationEligibleDate, daysOverdue } from "../lib/crm/deal-finance"
import { DEFAULT_FINANCE_CC, DEFAULT_BOOKINGS_CC, DEFAULT_OPERATIONS_CC, NEVER_CC_ADDRESSES, getInvoiceFinanceCc, getBookingConfirmationCc, getOperationsEmailCc } from "../lib/email/config"
import { invoiceDisplayStatus, pickPreferredInvoice } from "../lib/invoices/status"

test("native invoice cancellation becomes eligible 28 days after due date", () => {
  assert.equal(cancellationEligibleDate("2026-08-01"), "2026-08-29")
  assert.equal(daysOverdue("2026-08-01", new Date("2026-08-29T12:00:00.000Z")), 28)
})

test("invoice emails only CC finance", () => {
  const previousInvoiceCc = process.env.XERO_INVOICE_CC
  const previousOrderCc = process.env.ORDER_CONFIRMATION_CC
  process.env.XERO_INVOICE_CC = "matt@zk-sports.com, accounts@zk-sports.com"
  process.env.ORDER_CONFIRMATION_CC = "matt@zk-sports.com"
  try {
    assert.deepEqual(getInvoiceFinanceCc("agent@example.com"), [DEFAULT_FINANCE_CC])
    assert.deepEqual(getInvoiceFinanceCc(DEFAULT_FINANCE_CC), [])
    assert.deepEqual(getInvoiceFinanceCc("matt@zk-sports.com"), [DEFAULT_FINANCE_CC])
    assert.equal(NEVER_CC_ADDRESSES.has("matt@zk-sports.com"), true)
  } finally {
    if (previousInvoiceCc === undefined) delete process.env.XERO_INVOICE_CC
    else process.env.XERO_INVOICE_CC = previousInvoiceCc
    if (previousOrderCc === undefined) delete process.env.ORDER_CONFIRMATION_CC
    else process.env.ORDER_CONFIRMATION_CC = previousOrderCc
  }
  const configSource = readFileSync("lib/email/config.ts", "utf8")
  assert.doesNotMatch(configSource, /process\.env\.XERO_INVOICE_CC/)
  assert.doesNotMatch(configSource, /process\.env\.ORDER_CONFIRMATION_CC/)
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

