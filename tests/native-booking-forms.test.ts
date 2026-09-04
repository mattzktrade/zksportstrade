import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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
import {
  bookingFormCc,
  bookingFormReadyNotificationRecipients,
  clientSignedNotificationRecipients,
  DEFAULT_BOOKING_FORM_READY_NOTIFY_EMAILS,
  DEFAULT_BOOKINGS_CC,
  DEFAULT_CHELLEY_CC,
  DEFAULT_CLIENT_SIGNED_NOTIFY_EMAILS,
} from "../lib/email/send-booking-form"
import type { BookingFormSnapshot } from "../lib/booking-forms/types"
import { paddedInkRect, signatureInkBounds } from "../lib/booking-forms/signature-ink"

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

test("new accounts can omit postcode and booking forms still render the rest of the address", () => {
  const dealsClient = readFileSync("app/(admin)/admin/deals/deals-client.tsx", "utf8")
  assert.match(dealsClient, /Postcode \(optional\)/)
  assert.match(
    dealsClient,
    /newBillingLine1\.trim\(\) && newBillingCity\.trim\(\) && newBillingCountry\.trim\(\)/,
  )
  assert.doesNotMatch(
    dealsClient,
    /newBillingLine1\.trim\(\) && newBillingCity\.trim\(\) && newBillingPostcode\.trim\(\) && newBillingCountry\.trim\(\)/,
  )
  const snapshot = readFileSync("lib/booking-forms/snapshot.ts", "utf8")
  assert.match(snapshot, /account\.billing_postcode/)
  assert.match(snapshot, /\.filter\(Boolean\)/)
  const xero = readFileSync("lib/integrations/xero/invoices.ts", "utf8")
  assert.match(xero, /PostalCode: postcode/)
})

function testSnapshot(overrides: Partial<BookingFormSnapshot> = {}): BookingFormSnapshot {
  return {
    schemaVersion: 1,
    template: {
      key: "zk-standard-booking-form",
      version: 1,
      legalContentVersion: "2026-08-11",
    },
    documentRef: "ZK-TEST-0001",
    createdAt: "2026-08-11T12:00:00.000Z",
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
        description: "Sky Suite - 3 day / 2026 Singapore F1 GP",
        quantity: 4,
        unitPrice: 11500,
        lineTotal: 46000,
        currency: "USD",
      },
    ],
    currency: "USD",
    subtotal: 46000,
    taxRate: 0,
    taxAmountIncluded: 0,
    total: 46000,
    paymentTerms: "USD 46000.00 (100.00%) due upon signing, all tax included.",
    paymentMethod: "Wire Transfer",
    bankDetails: BOOKING_BANK_DETAILS,
    acknowledgement: BOOKING_ACKNOWLEDGEMENT,
    terms: BOOKING_TERMS,
    ...overrides,
  }
}

test("no-VAT is the default edit and 5% included VAT does not change the total", async () => {
  const snapshot = testSnapshot()
  const edits = snapshotToEdits(snapshot)
  assert.equal(edits.noVat, true)
  const withVat = applyBookingFormEdits(snapshot, { ...edits, noVat: false })
  assert.equal(withVat.total, 46000)
  assert.equal(withVat.subtotal, 46000)
  assert.equal(withVat.taxRate, 0.05)
  assert.equal(withVat.taxAmountIncluded, 2190.48)
  assert.equal(withVat.taxDescription, "VAT included (5%)")
  assert.equal(withVat.lines[0].taxRate, 0.05)
  const withoutVat = applyBookingFormEdits(snapshot, { ...edits, noVat: true })
  assert.equal(withoutVat.total, 46000)
  assert.equal(withoutVat.taxRate, 0)
  assert.equal(withoutVat.taxAmountIncluded, 0)
  assert.equal(withoutVat.taxDescription, undefined)
  const vatPdf = await generateBookingFormPdf(withVat)
  const noVatPdf = await generateBookingFormPdf(withoutVat)
  assert.equal(Buffer.from(vatPdf).subarray(0, 4).toString(), "%PDF")
  assert.equal(Buffer.from(noVatPdf).subarray(0, 4).toString(), "%PDF")
})

test("booking form emails CC bookings and Chelley", () => {
  assert.equal(DEFAULT_BOOKINGS_CC, "bookings@zk-sports.com")
  assert.equal(DEFAULT_CHELLEY_CC, "chelley@zk-sports.com")
  assert.deepEqual(bookingFormCc(["client@example.com"]), [DEFAULT_BOOKINGS_CC, DEFAULT_CHELLEY_CC])
  assert.deepEqual(bookingFormCc(["client@example.com", DEFAULT_BOOKINGS_CC]), [DEFAULT_CHELLEY_CC])
  assert.deepEqual(bookingFormCc(["client@example.com", DEFAULT_CHELLEY_CC]), [DEFAULT_BOOKINGS_CC])
  assert.deepEqual(bookingFormCc([DEFAULT_BOOKINGS_CC, DEFAULT_CHELLEY_CC]), [])
  const source = readFileSync("lib/email/send-booking-form.ts", "utf8")
  const functionSource = (name: string) => {
    const start = source.indexOf(`export function ${name}`)
    const next = source.indexOf("export function ", start + 1)
    return source.slice(start, next === -1 ? undefined : next)
  }
  assert.match(functionSource("sendNativeBookingFormEmail"), /cc: bookingFormCc\(to\)/)
  assert.match(functionSource("sendManualNativeBookingFormEmail"), /cc: bookingFormCc\(to\)/)
  assert.match(functionSource("sendNativeBookingFormReminder"), /cc: bookingFormCc\(to\)/)
  assert.match(functionSource("sendCompletedBookingFormEmail"), /cc: bookingFormCc\(to\)/)
  assert.match(functionSource("sendCompletedBookingFormEmail"), /const to = \[input\.clientEmail\]/)
  assert.doesNotMatch(functionSource("sendCompletedBookingFormEmail"), /adminEmail\.toLowerCase/)
  const clientSignedStart = source.indexOf("export async function sendClientSignedBookingFormNotification")
  const clientSigned = source.slice(clientSignedStart, source.indexOf("export async function sendBookingFormReadyToSendNotification"))
  assert.match(clientSigned, /cc: bookingFormCc\(recipients\)/)
})

test("client-signed booking form alerts go only to Ollie and Michel by default", () => {
  assert.deepEqual(clientSignedNotificationRecipients(""), [...DEFAULT_CLIENT_SIGNED_NOTIFY_EMAILS])
  assert.deepEqual(DEFAULT_CLIENT_SIGNED_NOTIFY_EMAILS, [
    "michel@zk-sports.com",
    "oliver@zk-sports.com",
  ])
  assert.deepEqual(clientSignedNotificationRecipients("ops@zk-sports.com"), ["ops@zk-sports.com"])
  const notifySource = readFileSync("lib/email/send-booking-form.ts", "utf8")
  assert.match(notifySource, /BOOKING_FORM_ADMIN_EMAILS/)
  assert.doesNotMatch(notifySource, /eq\("role", "admin"\)/)
  assert.doesNotMatch(notifySource, /FINANCE_NOTIFICATION_EMAILS/)
})

test("booking form signing page uses a product table, colour logo, and client signature near the total", () => {
  const signing = readFileSync("app/sign/booking/[token]/signing-client.tsx", "utf8")
  assert.match(signing, /LOGO_MAIN/)
  assert.match(signing, />Product<\/th>/)
  assert.match(signing, /Client signature/)
  assert.doesNotMatch(signing, /emerald/)
  const editor = readFileSync("app/(admin)/admin/deals/booking-form-editor.tsx", "utf8")
  assert.match(editor, /No VAT/)
  assert.match(editor, /noVat/)
  assert.match(editor, /Notify admins to send/)
  assert.match(editor, /onNotify/)
  const panel = readFileSync("app/(admin)/admin/deals/booking-form-panel.tsx", "utf8")
  assert.match(panel, /Copy signing link/)
  assert.match(panel, /getNativeBookingFormSigningUrl/)
  assert.match(panel, /currentCanSend \? \(/)
  assert.match(panel, /currentCanSign \? \(/)
  assert.match(panel, /Notify admins to send/)
  assert.match(panel, /sendSavedNativeBookingForm/)
  assert.match(panel, /currentCanManageDeals/)
})

test("ready-to-send booking form alerts go to Matt, Michel, and Ollie by default", () => {
  assert.deepEqual(bookingFormReadyNotificationRecipients(""), [...DEFAULT_BOOKING_FORM_READY_NOTIFY_EMAILS])
  assert.deepEqual(DEFAULT_BOOKING_FORM_READY_NOTIFY_EMAILS, [
    "matt@zk-sports.com",
    "michel@zk-sports.com",
    "oliver@zk-sports.com",
  ])
  assert.deepEqual(bookingFormReadyNotificationRecipients("ops@zk-sports.com"), ["ops@zk-sports.com"])
  const notifySource = readFileSync("lib/email/send-booking-form.ts", "utf8")
  assert.match(notifySource, /BOOKING_FORM_READY_NOTIFY_EMAILS/)
  assert.match(notifySource, /sendBookingFormReadyToSendNotification/)
})

test("saving a booking form draft is CMS-staff work; sending to the client is admin-only", () => {
  const sql = readFileSync("supabase/migrations/20260831120000_booking_form_ready_to_send.sql", "utf8")
  assert.match(sql, /awaiting_booking_form_send/)
  assert.match(sql, /if not public\.is_cms_staff\(\) then/)
  assert.match(sql, /if not public\.is_admin\(\) then/)
  assert.match(sql, /admin_update_native_booking_form_draft/)
  assert.match(sql, /admin_record_booking_form_ready_notification/)
  assert.match(sql, /drop function if exists public\.admin_send_native_booking_form\(uuid\);/)
  const actions = readFileSync("app/(admin)/admin/deals/booking-form-actions.ts", "utf8")
  assert.match(actions, /canPrepareNativeBookingForm/)
  assert.match(actions, /canSendNativeBookingForm/)
  assert.match(actions, /canSignNativeBookingForm/)
  assert.match(actions, /saveNativeBookingFormDraft/)
  assert.match(actions, /notifyNativeBookingFormReady/)
  assert.match(actions, /sendSavedNativeBookingForm/)
  assert.match(actions, /bookingFormGate\("send"\)/)
  const dealsClient = readFileSync("app/(admin)/admin/deals/deals-client.tsx", "utf8")
  assert.match(dealsClient, /id: "ready_to_send"/)
  assert.match(dealsClient, /awaiting_booking_form_send/)
})

test("signature ink detection ignores white canvas noise and keeps a real stroke", () => {
  const width = 40
  const height = 20
  const blank = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < blank.length; i += 4) {
    blank[i] = 255
    blank[i + 1] = 255
    blank[i + 2] = 255
    blank[i + 3] = 255
  }
  assert.equal(signatureInkBounds(blank, width, height), null)

  const speckle = new Uint8ClampedArray(blank)
  speckle[0] = 17
  speckle[1] = 17
  speckle[2] = 17
  speckle[3] = 255
  assert.equal(signatureInkBounds(speckle, width, height), null)

  const signed = new Uint8ClampedArray(blank)
  for (let x = 4; x < 24; x++) {
    for (let y = 6; y < 10; y++) {
      const offset = (y * width + x) * 4
      signed[offset] = 17
      signed[offset + 1] = 17
      signed[offset + 2] = 17
      signed[offset + 3] = 255
    }
  }
  const bounds = signatureInkBounds(signed, width, height)
  assert.ok(bounds)
  assert.equal(bounds?.minX, 4)
  assert.equal(bounds?.maxX, 23)
  const crop = paddedInkRect(bounds!, width, height)
  assert.ok(crop.width >= 20)
  assert.ok(crop.height >= 4)
})

test("booking form send and sign refresh the deal page instead of only the deals list", () => {
  const actions = readFileSync("app/(admin)/admin/deals/booking-form-actions.ts", "utf8")
  const panel = readFileSync("app/(admin)/admin/deals/booking-form-panel.tsx", "utf8")
  const signRoute = readFileSync("app/api/booking-forms/sign/route.ts", "utf8")
  const pad = readFileSync("components/signature-pad.tsx", "utf8")
  const signing = readFileSync("app/sign/booking/[token]/signing-client.tsx", "utf8")
  assert.match(actions, /revalidateNativeBookingFormPages/)
  assert.match(signRoute, /revalidateNativeBookingFormPages/)
  assert.doesNotMatch(actions, /revalidatePath\("\/admin\/deals"\)/)
  assert.doesNotMatch(panel, /startTransition/)
  assert.match(panel, /router\.refresh\(\)/)
  assert.match(pad, /saveBackup/)
  assert.match(pad, /exportCroppedPng/)
  assert.match(signing, /signatureDataUrl/)
  assert.match(signing, /padRef\.current\?\.toDataURL\(\)/)
})

