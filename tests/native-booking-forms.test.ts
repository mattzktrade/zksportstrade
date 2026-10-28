import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { decodePDFRawStream, PDFDocument, PDFRawStream, StandardFonts } from "pdf-lib"
import { generateBookingFormPdf } from "../lib/booking-forms/pdf"
import {
  applyBookingFormEdits,
  snapshotToEdits,
} from "../lib/booking-forms/edits"
import {
  normalizeClientCcEmails,
  snapshotClientCcEmails,
} from "../lib/booking-forms/cc-emails"
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
import { bookingFormHandoffStatus } from "../lib/booking-forms/handoff-status"
import { isTransientStorageError } from "../lib/booking-forms/storage"
import {
  bookingFormHasZkCountersign,
  dealCanCreateOrderFromBookingForm,
  effectiveDealStageAfterCountersign,
} from "../lib/booking-forms/advance-deal"

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

test("booking form snapshots accept AED as well as USD", () => {
  const snapshot = readFileSync("lib/booking-forms/snapshot.ts", "utf8")
  assert.match(snapshot, /assertBookingFormInvoiceCurrency/)
  assert.match(snapshot, /buildDealInvoiceReporting/)
  assert.doesNotMatch(snapshot, /ZK booking forms must be issued in USD\./)
  const helper = readFileSync("lib/crm/deal-invoice-currency.ts", "utf8")
  assert.match(helper, /must be issued in USD, AED, GBP, or EUR/)
})

test("payment terms heading follows the snapshot currency", async () => {
  const usd = await generateBookingFormPdf(testSnapshot({ currency: "USD" }))
  const aed = await generateBookingFormPdf(
    testSnapshot({
      currency: "AED",
      lines: [
        {
          dealLineItemId: "line-1",
          packageId: "package-1",
          eventName: "Singapore F1 GP 2026",
          packageName: "Sky Suite",
          description: "Sky Suite",
          quantity: 4,
          unitPrice: 11500,
          lineTotal: 46000,
          currency: "AED",
        },
      ],
    }),
  )
  const gbp = await generateBookingFormPdf(testSnapshot({ currency: "GBP" }))
  const usdText = allPageText(await PDFDocument.load(usd))
  const aedText = allPageText(await PDFDocument.load(aed))
  const gbpText = allPageText(await PDFDocument.load(gbp))
  assert.match(usdText, /PAYMENT TERMS \(ALL AMOUNTS IN USD\)/)
  assert.match(aedText, /PAYMENT TERMS \(ALL AMOUNTS IN AED\)/)
  assert.match(gbpText, /PAYMENT TERMS \(ALL AMOUNTS IN GBP\)/)
  assert.doesNotMatch(aedText, /PAYMENT TERMS \(ALL AMOUNTS IN USD\)/)
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

test("bill to is right-aligned with the seller address", async () => {
  const bytes = await generateBookingFormPdf(
    testSnapshot({
      documentRef: "ZK-20260907-A7146F05",
      billTo: {
        accountId: "account-1",
        accountName: "Sportfive UK Ltd",
        contactId: "contact-1",
        contactName: "Roisin McCarthy",
        contactEmail: "roisin.mccarthy@sportfive.com",
        addressLines: ["London", "United Kingdom"],
      },
    }),
  )
  const pdf = await PDFDocument.load(bytes)
  const placements = firstPageTextPlacements(pdf)
  const quote = placements.find((item) => item.text.startsWith("Quote No "))
  const billTo = placements.find((item) => item.text === "BILL TO:")
  const trn = placements.find((item) => item.text.startsWith("TRN "))
  const london = placements.find((item) => item.text === "London")
  assert.ok(quote)
  assert.ok(billTo)
  assert.ok(trn)
  assert.ok(london)
  assert.equal(billTo.y, quote.y)
  assert.ok(billTo.x > 480)
  assert.ok(london.x > 500)

  const fonts = await PDFDocument.create()
  const regular = await fonts.embedFont(StandardFonts.Helvetica)
  const bold = await fonts.embedFont(StandardFonts.HelveticaBold)
  const addressRight = trn.x + regular.widthOfTextAtSize(trn.text, 8)
  const billRight = billTo.x + bold.widthOfTextAtSize("BILL TO:", 10)
  assert.ok(Math.abs(addressRight - billRight) < 0.6)
})

test("matching account and contact names print once on the booking form", async () => {
  const same = await generateBookingFormPdf(
    testSnapshot({
      billTo: {
        accountId: "account-1",
        accountName: "Fabiana Fernandez",
        contactId: "contact-1",
        contactName: "Fabiana Fernandez",
        contactEmail: "valeriaff@gmail.com",
        addressLines: ["Argentina"],
      },
    }),
  )
  const samePlacements = firstPageTextPlacements(await PDFDocument.load(same)).filter(
    (item) => item.text === "Fabiana Fernandez",
  )
  assert.equal(samePlacements.length, 1)

  const different = await generateBookingFormPdf(
    testSnapshot({
      billTo: {
        accountId: "account-1",
        accountName: "Sportfive UK Ltd",
        contactId: "contact-1",
        contactName: "Roisin McCarthy",
        contactEmail: "roisin.mccarthy@sportfive.com",
        addressLines: ["London"],
      },
    }),
  )
  const differentPlacements = firstPageTextPlacements(await PDFDocument.load(different))
  assert.equal(differentPlacements.filter((item) => item.text === "Sportfive UK Ltd").length, 1)
  assert.equal(differentPlacements.filter((item) => item.text === "Roisin McCarthy").length, 1)
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
  assert.equal(next.ccEmails, undefined)
})

test("booking form CC emails are saved on the snapshot and excluded from the signer and PDF", () => {
  const snapshot = testSnapshot()
  const edits = snapshotToEdits(snapshot)
  assert.deepEqual(edits.ccEmails, [])
  edits.ccEmails = ["ops@agency.com", "  Finance@Agency.com ", edits.billToContactEmail, "ops@agency.com"]
  const next = applyBookingFormEdits(snapshot, edits)
  assert.deepEqual(next.ccEmails, ["ops@agency.com", "finance@agency.com"])
  assert.deepEqual(snapshotClientCcEmails(next), ["ops@agency.com", "finance@agency.com"])
  assert.deepEqual(normalizeClientCcEmails(["OPS@agency.com", "signer@example.com"], "signer@example.com"), [
    "ops@agency.com",
  ])
  assert.throws(
    () => applyBookingFormEdits(snapshot, { ...edits, ccEmails: ["not-an-email"] }),
    /valid CC email/,
  )
  const cleared = applyBookingFormEdits(snapshot, { ...edits, ccEmails: [] })
  assert.equal(cleared.ccEmails, undefined)
  const pdfSource = readFileSync("lib/booking-forms/pdf.ts", "utf8")
  assert.doesNotMatch(pdfSource, /ccEmails/)
})

test("new accounts can omit billing details and booking forms still render whatever address exists", () => {
  const createModal = readFileSync("components/admin/deal-create-modal.tsx", "utf8")
  assert.match(createModal, /Billing address <span className="font-normal text-slate-500">\(optional\)<\/span>/)
  assert.match(createModal, /Leave this blank if you only have a name and an email or phone/)
  assert.match(createModal, /Postcode \(optional\)/)
  assert.doesNotMatch(createModal, /Add the billing street, city and country/)
  assert.doesNotMatch(
    createModal,
    /newBillingLine1\.trim\(\) && newBillingCity\.trim\(\) && newBillingCountry\.trim\(\)/,
  )
  const snapshot = readFileSync("lib/booking-forms/snapshot.ts", "utf8")
  assert.match(snapshot, /account\.billing_postcode/)
  assert.match(snapshot, /\.filter\(Boolean\)/)
  const xero = readFileSync("lib/integrations/xero/invoices.ts", "utf8")
  assert.match(xero, /PostalCode: postcode/)
})

function pageTextPlacements(
  pdf: PDFDocument,
  pageIndex: number,
): Array<{ x: number; y: number; text: string }> {
  const contents = pdf.getPages()[pageIndex].node.Contents()
  const refs =
    contents && typeof contents === "object" && "array" in contents
      ? (contents as unknown as { array: unknown[] }).array
      : [contents]
  let content = ""
  for (const ref of refs) {
    const raw = pdf.context.lookup(ref as never)
    if (!(raw instanceof PDFRawStream)) continue
    const decoded = decodePDFRawStream(raw)
    const bytes = "decode" in decoded && typeof decoded.decode === "function" ? decoded.decode() : decoded
    content += Buffer.from(bytes as Uint8Array).toString("latin1")
  }
  return [...content.matchAll(/1 0 0 1 ([0-9.]+) ([0-9.]+) Tm\s+<([0-9A-Fa-f]+)>/g)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
    text: Buffer.from(match[3], "hex").toString("latin1"),
  }))
}

function allPageText(pdf: PDFDocument): string {
  return pdf
    .getPages()
    .flatMap((_, index) => pageTextPlacements(pdf, index).map((item) => item.text))
    .join("\n")
}

function firstPageTextPlacements(pdf: PDFDocument): Array<{ x: number; y: number; text: string }> {
  return pageTextPlacements(pdf, 0)
}

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

test("booking form emails CC bookings, Chelley, and any extra client addresses", () => {
  assert.equal(DEFAULT_BOOKINGS_CC, "bookings@zk-sports.com")
  assert.equal(DEFAULT_CHELLEY_CC, "chelley@zk-sports.com")
  assert.deepEqual(bookingFormCc(["client@example.com"]), [DEFAULT_BOOKINGS_CC, DEFAULT_CHELLEY_CC])
  assert.deepEqual(bookingFormCc(["client@example.com", DEFAULT_BOOKINGS_CC]), [DEFAULT_CHELLEY_CC])
  assert.deepEqual(bookingFormCc(["client@example.com", DEFAULT_CHELLEY_CC]), [DEFAULT_BOOKINGS_CC])
  assert.deepEqual(bookingFormCc([DEFAULT_BOOKINGS_CC, DEFAULT_CHELLEY_CC]), [])
  assert.deepEqual(
    bookingFormCc(["client@example.com"], ["ops@agency.com", "client@example.com", DEFAULT_BOOKINGS_CC]),
    ["ops@agency.com", DEFAULT_BOOKINGS_CC, DEFAULT_CHELLEY_CC],
  )
  const source = readFileSync("lib/email/send-booking-form.ts", "utf8")
  const functionSource = (name: string) => {
    const start = source.indexOf(`export function ${name}`)
    const next = source.indexOf("export function ", start + 1)
    return source.slice(start, next === -1 ? undefined : next)
  }
  assert.match(functionSource("sendNativeBookingFormEmail"), /cc: bookingFormCc\(to, input\.ccEmails\)/)
  assert.match(functionSource("sendManualNativeBookingFormEmail"), /cc: bookingFormCc\(to, input\.ccEmails\)/)
  assert.match(functionSource("sendNativeBookingFormReminder"), /cc: bookingFormCc\(to, input\.ccEmails\)/)
  assert.match(functionSource("sendNativeBookingFormFinalReminder"), /cc: bookingFormCc\(to, input\.ccEmails\)/)
  assert.match(functionSource("sendNativeBookingFormHoldReleased"), /cc: bookingFormCc\(to, input\.ccEmails\)/)
  assert.match(source, /stock is no longer held/)
  assert.match(source, /contact the team again to extend/)
  assert.match(source, /stock hold will be released/)
  assert.doesNotMatch(functionSource("sendNativeBookingFormHoldReleased"), /signingUrl/)
  assert.match(functionSource("sendCompletedBookingFormEmail"), /cc: bookingFormCc\(to, input\.ccEmails\)/)
  assert.match(functionSource("sendCompletedBookingFormEmail"), /const to = \[input\.clientEmail\]/)
  assert.doesNotMatch(functionSource("sendCompletedBookingFormEmail"), /adminEmail\.toLowerCase/)
  const clientSignedStart = source.indexOf("export async function sendClientSignedBookingFormNotification")
  const clientSigned = source.slice(clientSignedStart, source.indexOf("export async function sendBookingFormReadyToSendNotification"))
  assert.match(clientSigned, /cc: bookingFormCc\(recipients\)/)
  const actions = readFileSync("app/(admin)/admin/deals/booking-form-actions.ts", "utf8")
  assert.match(actions, /ccEmails: snapshotClientCcEmails\(snapshot\)/)
  assert.match(actions, /loadAccountEmailOptions/)
  const automation = readFileSync("lib/integrations/process-native-booking-forms.ts", "utf8")
  assert.match(automation, /ccEmails: snapshotClientCcEmails\(snapshot\)/)
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
  assert.match(signing, /sm:hidden/)
  assert.match(signing, /Recording your signature/)
  assert.doesNotMatch(signing, /emerald/)
  const editor = readFileSync("app/(admin)/admin/deals/booking-form-editor.tsx", "utf8")
  assert.match(editor, /No VAT/)
  assert.match(editor, /noVat/)
  assert.match(editor, /Send for approval/)
  assert.match(editor, /onNotify/)
  assert.match(editor, /CC emails/)
  assert.match(editor, /People on this account/)
  assert.match(editor, /Add another email/)
  assert.match(editor, /accountEmails/)
  assert.match(editor, /AdminModalScrim/)
  const panel = readFileSync("app/(admin)/admin/deals/booking-form-panel.tsx", "utf8")
  assert.match(panel, /Copy signing link/)
  assert.match(panel, /getNativeBookingFormSigningUrl/)
  assert.match(panel, /currentCanSend \? \(/)
  assert.match(panel, /currentCanSign \? \(/)
  assert.match(panel, /Send for approval/)
  assert.match(panel, /sendSavedNativeBookingForm/)
  assert.match(panel, /currentCanManageDeals/)
  assert.match(panel, /onMovedToDeals/)
  assert.match(panel, /AdminModalScrim/)
  assert.match(panel, /sticky bottom-0/)
  assert.match(panel, /Agreement signed/)
  assert.doesNotMatch(panel, /Notify admins to send/)
  const actions = readFileSync("app/(admin)/admin/deals/booking-form-actions.ts", "utf8")
  assert.match(actions, /await completeZkSignedBookingForm/)
  assert.match(actions, /completeZkSignedBookingForm/)
  assert.doesNotMatch(actions, /scheduleAfterResponse/)
  assert.match(panel, /Create order &amp; send invoice/)
  assert.match(panel, /Signing and creating the invoice/)
  const overlays = readFileSync("components/admin/admin-list-preview.tsx", "utf8")
  assert.match(overlays, /admin-overlay/)
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

test("booking form PDF upload retries Supabase storage database timeouts", () => {
  assert.equal(isTransientStorageError("The connection to the database timed out"), true)
  assert.equal(isTransientStorageError("The resource already exists"), false)
  const storage = readFileSync("lib/booking-forms/storage.ts", "utf8")
  assert.match(storage, /STORAGE_UPLOAD_ATTEMPTS/)
  assert.match(storage, /upsert: upsert \|\| attempt > 0/)
  const actions = readFileSync("app/(admin)/admin/deals/booking-form-actions.ts", "utf8")
  assert.match(actions, /uploadBookingDocument\(unsignedPath, unsignedPdf, "application\/pdf", true\)/)
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
  assert.match(dealsClient, /BookingFormHandoffCallout/)
})

test("saving a booking form draft stays on the enquiry until send or approval", () => {
  const sql = readFileSync(
    "supabase/migrations/20260904150000_booking_form_convert_on_notify.sql",
    "utf8",
  )
  assert.match(sql, /admin_create_native_booking_form/)
  assert.match(sql, /admin_update_native_booking_form_draft/)
  assert.match(sql, /perform public.mark_deal_awaiting_booking_form_send\(v_form.deal_id\)/)
  assert.doesNotMatch(sql, /perform public.mark_deal_awaiting_booking_form_send\(p_deal_id\)/)
  assert.match(sql, /Sent for approval to Ollie and Michel/)
  const enquiriesPage = readFileSync("app/(admin)/admin/enquiries/page.tsx", "utf8")
  assert.match(enquiriesPage, /getBookingFormsForDeals/)
  const approval = bookingFormHandoffStatus(
    { status: "draft" },
    [{ event_type: "ready_notified" }],
  )
  assert.equal(approval?.kind, "approval")
  assert.match(approval?.title ?? "", /Ollie and Michel/)
  const sent = bookingFormHandoffStatus({ status: "sent" }, [])
  assert.equal(sent?.kind, "sent")
  assert.match(sent?.title ?? "", /sent to the client/i)
  const draft = bookingFormHandoffStatus({ status: "draft" }, [])
  assert.equal(draft?.kind, "draft")
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

test("ZK countersign advances the deal immediately and completion can finish a stuck form", () => {
  const sql = readFileSync(
    "supabase/migrations/20261027120000_countersign_advances_signed_deal.sql",
    "utf8",
  )
  assert.match(sql, /advance_deal_after_zk_signature/)
  assert.match(sql, /status in \('zk_signed', 'completed'\)/)
  assert.match(sql, /set stage = 'signed'/)
  assert.match(sql, /Create and send invoice/)
  assert.match(sql, /admin_record_zk_signature/)
  assert.match(sql, /is_cms_operator/)
  const complete = readFileSync("lib/booking-forms/complete.ts", "utf8")
  assert.match(complete, /status !== "zk_signed" && status !== "completed"/)
  assert.match(complete, /markDealSignedAfterZkCountersign/)
  assert.match(complete, /ensureNativeDealOrderAndInvoice/)
  assert.doesNotMatch(complete, /if \(String\(form\.status\) === "completed"\) return/)
  const automation = readFileSync("lib/crm/deal-order-automation.ts", "utf8")
  assert.match(automation, /markDealSignedAfterZkCountersign/)
  assert.match(automation, /drainOutboxNow/)
  assert.match(automation, /loadOrderInvoices/)
  const panel = readFileSync("app/(admin)/admin/deals/deal-finance-panel.tsx", "utf8")
  assert.match(panel, /dealCanCreateOrderFromBookingForm/)
  const dealsClient = readFileSync("app/(admin)/admin/deals/deals-client.tsx", "utf8")
  assert.match(dealsClient, /bookingFormHasZkCountersign/)
  assert.equal(bookingFormHasZkCountersign("awaiting_zk_signature"), false)
  assert.equal(bookingFormHasZkCountersign("zk_signed"), true)
  assert.equal(bookingFormHasZkCountersign("completed"), true)
  assert.equal(
    effectiveDealStageAfterCountersign("awaiting_zk_signature", "completed"),
    "signed",
  )
  assert.equal(
    effectiveDealStageAfterCountersign("awaiting_payment", "completed"),
    "awaiting_payment",
  )
  assert.equal(
    dealCanCreateOrderFromBookingForm({
      stage: "awaiting_zk_signature",
      orderId: null,
      bookingFormStatus: "completed",
    }),
    true,
  )
  assert.equal(
    dealCanCreateOrderFromBookingForm({
      stage: "awaiting_zk_signature",
      orderId: null,
      bookingFormStatus: "awaiting_zk_signature",
    }),
    false,
  )
  assert.equal(
    dealCanCreateOrderFromBookingForm({
      stage: "signed",
      orderId: "ord-1",
      bookingFormStatus: "completed",
    }),
    false,
  )
})

test("client signature keeps unsigned deals on Awaiting ZK signature with the form", () => {
  const sql = readFileSync(
    "supabase/migrations/20260909130000_sync_deal_stage_awaiting_zk_signature.sql",
    "utf8",
  )
  assert.match(sql, /keep_client_signed_deal_reservations/)
  assert.match(sql, /record_native_client_signature/)
  assert.match(sql, /and stage in \(/)
  assert.match(sql, /set stage = 'awaiting_zk_signature'/)
  assert.doesNotMatch(sql, /paid_confirmed/)
  const queries = readFileSync("lib/booking-forms/queries.ts", "utf8")
  assert.match(queries, /awaiting_zk_signature/)
  assert.match(queries, /awaitingZkForms/)
})

