import assert from "node:assert/strict"
import test from "node:test"
import {
  applyBookingFormEdits,
  snapshotToEdits,
} from "../lib/booking-forms/edits"
import {
  defaultPaymentSchedule,
  formatPaymentTermsText,
  resolvePaymentSchedule,
  splitInstallmentAmounts,
  validatePaymentSchedule,
} from "../lib/booking-forms/payment-schedule"
import {
  BOOKING_ACKNOWLEDGEMENT,
  BOOKING_BANK_DETAILS,
  BOOKING_SELLER,
  BOOKING_TERMS,
} from "../lib/booking-forms/template"
import type { BookingFormSnapshot } from "../lib/booking-forms/types"
import { isInvoiceIssuable, scaleLineAmountsToTotal } from "../lib/invoices/order-invoices"
import { aggregateInvoiceStatus, pickCurrentInvoice } from "../lib/invoices/status"

function snapshot(): BookingFormSnapshot {
  return {
    schemaVersion: 1,
    template: {
      key: "zk-standard-booking-form",
      version: 1,
      legalContentVersion: "2026-08-11",
    },
    documentRef: "ZK-TEST-0001",
    createdAt: "2026-09-22T12:00:00.000Z",
    deal: { id: "deal-1", title: "Singapore F1 GP 2026" },
    seller: BOOKING_SELLER,
    billTo: {
      accountId: "account-1",
      accountName: "Example Agent",
      contactId: "contact-1",
      contactName: "Example Signer",
      contactEmail: "signer@example.com",
      addressLines: ["Dubai", "UAE"],
    },
    lines: [
      {
        dealLineItemId: "line-1",
        packageId: "package-1",
        eventName: "Singapore F1 GP 2026",
        packageName: "Sky Suite",
        description: "Sky Suite",
        quantity: 2,
        unitPrice: 5000,
        lineTotal: 10000,
        currency: "USD",
      },
    ],
    currency: "USD",
    subtotal: 10000,
    taxRate: 0,
    taxAmountIncluded: 0,
    total: 10000,
    paymentTerms: "USD 10000.00 (100.00%) due upon signing, all tax included.",
    paymentMethod: "Wire Transfer",
    bankDetails: BOOKING_BANK_DETAILS,
    acknowledgement: BOOKING_ACKNOWLEDGEMENT,
    terms: BOOKING_TERMS,
  }
}

test("default payment schedule is 100% due 7 days after signing", () => {
  const schedule = defaultPaymentSchedule()
  assert.equal(schedule.installments.length, 1)
  assert.equal(schedule.installments[0].percent, 100)
  assert.equal(schedule.installments[0].dueDaysAfterSigning, 7)
  assert.match(
    formatPaymentTermsText(schedule, 10000, "USD"),
    /USD 10000\.00 \(100\.00%\) due 7 days after signing, all tax included\./,
  )
})

test("split payment amounts keep the exact total on the last installment", () => {
  assert.deepEqual(splitInstallmentAmounts(10000, [25, 25, 50]), [2500, 2500, 5000])
  assert.deepEqual(splitInstallmentAmounts(100, [33.33, 33.33, 33.34]), [33.33, 33.33, 33.34])
})

test("a 25/25/50 schedule resolves dated invoices that add up to the booking total", () => {
  const resolved = resolvePaymentSchedule(
    {
      notes: "",
      installments: [
        { percent: 25, dueKind: "days_after_signing", dueDaysAfterSigning: 0, dueOn: "", label: "Deposit" },
        { percent: 25, dueKind: "on_date", dueDaysAfterSigning: 0, dueOn: "2026-12-01", label: "" },
        { percent: 50, dueKind: "on_date", dueDaysAfterSigning: 0, dueOn: "2027-03-01", label: "Balance" },
      ],
    },
    10000,
    "2026-09-22",
  )
  assert.equal(resolved.length, 3)
  assert.equal(resolved.reduce((sum, row) => sum + row.amount, 0), 10000)
  assert.equal(resolved[0].dueDate, "2026-09-22")
  assert.equal(resolved[1].dueDate, "2026-12-01")
  assert.equal(resolved[2].dueDate, "2027-03-01")
  assert.match(
    formatPaymentTermsText(
      {
        notes: "",
        installments: resolved.map((row) => ({
          percent: row.percent,
          dueKind: row.dueKind,
          dueDaysAfterSigning: row.dueDaysAfterSigning,
          dueOn: row.dueOn,
          label: row.label,
        })),
      },
      10000,
      "USD",
    ),
    /payable in 3 payments/,
  )
})

test("payment percentages must add up to 100", () => {
  assert.throws(
    () =>
      validatePaymentSchedule({
        notes: "",
        installments: [
          { percent: 40, dueKind: "days_after_signing", dueDaysAfterSigning: 7, dueOn: "", label: "" },
          { percent: 40, dueKind: "days_after_signing", dueDaysAfterSigning: 30, dueOn: "", label: "" },
        ],
      }),
    /100%/,
  )
})

test("legacy booking forms without a schedule save as 100% due 7 days after signing", () => {
  const next = applyBookingFormEdits(snapshot(), snapshotToEdits(snapshot()))
  assert.equal(next.paymentSchedule?.installments.length, 1)
  assert.equal(next.paymentSchedule?.installments[0].dueDaysAfterSigning, 7)
  assert.match(next.paymentTerms, /USD 10000\.00 \(100\.00%\) due 7 days after signing/)
})

test("saving a booking form writes the structured schedule and generated terms", () => {
  const edits = snapshotToEdits(snapshot())
  assert.equal(edits.paymentSchedule.installments[0].percent, 100)
  edits.paymentSchedule = {
    notes: "Bank transfer only.",
    installments: [
      { percent: 25, dueKind: "days_after_signing", dueDaysAfterSigning: 0, dueOn: "", label: "Deposit" },
      { percent: 75, dueKind: "on_date", dueDaysAfterSigning: 0, dueOn: "2026-12-01", label: "Balance" },
    ],
  }
  const next = applyBookingFormEdits(snapshot(), edits)
  assert.equal(next.paymentSchedule?.installments.length, 2)
  assert.match(next.paymentTerms, /payable in 2 payments/)
  assert.match(next.paymentTerms, /Deposit/)
  assert.match(next.paymentTerms, /Bank transfer only/)
})

test("later installments are not issuable until their due window", () => {
  assert.equal(
    isInvoiceIssuable({
      status: "awaiting_invoice",
      xero_invoice_id: null,
      installment_index: 1,
      due_date: "2026-12-01",
    }, "2026-09-22", 7),
    true,
  )
  assert.equal(
    isInvoiceIssuable({
      status: "awaiting_invoice",
      xero_invoice_id: null,
      installment_index: 2,
      due_date: "2026-12-01",
    }, "2026-09-22", 7),
    false,
  )
  assert.equal(
    isInvoiceIssuable({
      status: "awaiting_invoice",
      xero_invoice_id: null,
      installment_index: 2,
      due_date: "2026-12-01",
    }, "2026-11-24", 7),
    true,
  )
})

test("deal invoice status stays awaiting payment until every installment is paid", () => {
  const current = pickCurrentInvoice([
    { status: "paid", installment_index: 1, due_date: "2026-09-22" },
    { status: "awaiting_payment", installment_index: 2, due_date: "2026-12-01" },
  ])
  assert.equal(current?.installment_index, 2)
  assert.equal(
    aggregateInvoiceStatus([
      { status: "paid" },
      { status: "awaiting_payment" },
    ]),
    "awaiting_payment",
  )
  assert.equal(
    aggregateInvoiceStatus([
      { status: "paid" },
      { status: "paid" },
    ]),
    "paid",
  )
})

test("scaled invoice lines keep the installment total", () => {
  const scaled = scaleLineAmountsToTotal(
    [
      { quantity: 1, unit_price: 4000, line_total: 4000 },
      { quantity: 1, unit_price: 6000, line_total: 6000 },
    ],
    2500,
  )
  assert.equal(scaled.reduce((sum, line) => sum + Number(line.line_total), 0), 2500)
})
