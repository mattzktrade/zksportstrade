import assert from "node:assert/strict"
import test from "node:test"
import { PDFDocument } from "pdf-lib"
import { generateBookingFormPdf } from "../lib/booking-forms/pdf"
import {
  applyBookingFormEdits,
  snapshotToEdits,
} from "../lib/booking-forms/edits"
import {
  bookingLineTax,
  generateSigningToken,
  sha256,
  stableJson,
} from "../lib/booking-forms/snapshot"
import {
  BOOKING_ACKNOWLEDGEMENT,
  BOOKING_BANK_DETAILS,
  BOOKING_SELLER,
  BOOKING_TERMS,
} from "../lib/booking-forms/template"
import type { BookingFormSnapshot } from "../lib/booking-forms/types"

test("secure signer tokens are random and only hashes need persistence", () => {
  const first = generateSigningToken()
  const second = generateSigningToken()
  assert.notEqual(first.token, second.token)
  assert.equal(first.tokenHash, sha256(first.token))
  assert.match(first.token, /^[A-Za-z0-9_-]{40,60}$/)
  assert.equal(first.tokenHash.length, 64)
})

test("snapshot serialization is stable regardless of object key order", () => {
  assert.equal(
    stableJson({ b: 2, nested: { z: 3, a: 1 }, a: 1 }),
    stableJson({ a: 1, nested: { a: 1, z: 3 }, b: 2 }),
  )
})

test("mixed-event booking VAT applies only to Abu Dhabi lines", () => {
  const abuDhabi = bookingLineTax("2026 Abu Dhabi Grand Prix", 10_500)
  const singapore = bookingLineTax("2026 Singapore Grand Prix", 10_000)
  assert.equal(abuDhabi.taxRate, 0.05)
  assert.equal(abuDhabi.taxAmountIncluded, 500)
  assert.equal(singapore.taxRate, 0)
  assert.equal(singapore.taxAmountIncluded, 0)
  assert.equal(abuDhabi.taxAmountIncluded + singapore.taxAmountIncluded, 500)
})

test("native booking form renderer creates a multi-page PDF", async () => {
  const snapshot: BookingFormSnapshot = {
    schemaVersion: 1,
    template: {
      key: "zk-standard-booking-form",
      version: 1,
      legalContentVersion: "2026-08-11",
    },
    documentRef: "ZK-TEST-0001",
    createdAt: "2026-08-11T12:00:00.000Z",
    deal: { id: "deal-1", title: "Abu Dhabi F1 GP 2026" },
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
        packageId: "package-1",
        eventName: "Abu Dhabi F1 GP 2026",
        packageName: "House 44 Paddock Club",
        description: "Abu Dhabi F1 GP 2026 — House 44 Paddock Club",
        quantity: 2,
        unitPrice: 22525,
        lineTotal: 45050,
        currency: "USD",
      },
    ],
    currency: "USD",
    subtotal: 45050,
    taxRate: 0.05,
    taxAmountIncluded: 2145.24,
    total: 45050,
    paymentTerms: "USD 45050.00 (100.00%) due upon signing, all tax included.",
    paymentMethod: "Wire Transfer",
    bankDetails: BOOKING_BANK_DETAILS,
    acknowledgement: BOOKING_ACKNOWLEDGEMENT,
    terms: BOOKING_TERMS,
  }
  const bytes = await generateBookingFormPdf(snapshot)
  assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), "%PDF")
  const pdf = await PDFDocument.load(bytes)
  assert.ok(pdf.getPageCount() >= 4)
})

test("booking form edits can rename parties, products and terms without changing locked ids", () => {
  const snapshot: BookingFormSnapshot = {
    schemaVersion: 1,
    template: {
      key: "zk-standard-booking-form",
      version: 1,
      legalContentVersion: "2026-08-11",
    },
    documentRef: "ZK-TEST-0001",
    createdAt: "2026-08-11T12:00:00.000Z",
    deal: { id: "deal-1", title: "Abu Dhabi F1 GP 2026" },
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
        eventName: "Abu Dhabi F1 GP 2026",
        packageName: "House 44 Paddock Club",
        description: "Abu Dhabi F1 GP 2026 — House 44 Paddock Club",
        quantity: 2,
        unitPrice: 22525,
        lineTotal: 45050,
        currency: "USD",
      },
    ],
    currency: "USD",
    subtotal: 45050,
    taxRate: 0.05,
    taxAmountIncluded: 2145.24,
    total: 45050,
    paymentTerms: "USD 45050.00 (100.00%) due upon signing, all tax included.",
    paymentMethod: "Wire Transfer",
    bankDetails: BOOKING_BANK_DETAILS,
    acknowledgement: BOOKING_ACKNOWLEDGEMENT,
    terms: BOOKING_TERMS,
  }
  const edits = snapshotToEdits(snapshot)
  edits.dealTitle = "Abu Dhabi GP hospitality"
  edits.billToAccountName = "Renamed Agency Ltd"
  edits.billToContactName = "Jane Client"
  edits.lines[0].packageName = "Paddock Club — House 44"
  edits.lines[0].description = "Custom hospitality description"
  edits.terms[0] = {
    heading: "Special introduction",
    body: "These terms apply only to this booking.\n\nThey replace the standard introduction.",
  }
  const next = applyBookingFormEdits(snapshot, edits)
  assert.equal(next.deal.id, "deal-1")
  assert.equal(next.documentRef, "ZK-TEST-0001")
  assert.equal(next.billTo.accountId, "account-1")
  assert.equal(next.billTo.contactId, "contact-1")
  assert.equal(next.lines[0].packageId, "package-1")
  assert.equal(next.deal.title, "Abu Dhabi GP hospitality")
  assert.equal(next.billTo.accountName, "Renamed Agency Ltd")
  assert.equal(next.billTo.contactName, "Jane Client")
  assert.equal(next.lines[0].description, "Custom hospitality description")
  assert.equal(next.terms[0].heading, "Special introduction")
  assert.equal(next.terms[0].paragraphs.length, 2)
})

