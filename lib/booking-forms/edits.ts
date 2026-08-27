import { applyInclusiveVat, defaultNoVat } from "@/lib/booking-forms/line-tax"
import { BOOKING_TERMS } from "@/lib/booking-forms/template"
import type { BookingFormSnapshot } from "@/lib/booking-forms/types"

export type BookingFormLineEdit = {
  eventName: string
  packageName: string
  description: string
  quantity: number
  unitPrice: number
}

export type BookingFormBankEdit = {
  currency: string
  recipient: string
  bank: string
  iban: string
  swift: string
}

export type BookingFormTermEdit = {
  heading: string
  body: string
}

export type BookingFormEdits = {
  dealTitle: string
  billToAccountName: string
  billToContactName: string
  billToContactEmail: string
  billToAddress: string
  sellerLegalName: string
  sellerAddress: string
  sellerTrn: string
  lines: BookingFormLineEdit[]
  paymentTerms: string
  paymentMethod: string
  bankDetails: BookingFormBankEdit[]
  acknowledgement: string
  terms: BookingFormTermEdit[]
  /** When true, the form shows no VAT. Untick to display 5% VAT included without changing the total. */
  noVat: boolean
}

export type BookingFormSendMode = "signing_link" | "manual_pdf"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function clean(value: string, max: number, label: string): string {
  const text = value.replaceAll("\u0000", "").trim()
  if (!text) throw new Error(`${label} is required.`)
  if (text.length > max) throw new Error(`${label} is too long.`)
  return text
}

function optionalLines(value: string, maxLine: number, maxCount: number, label: string): string[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.replaceAll("\u0000", "").trim())
    .filter(Boolean)
  if (lines.length > maxCount) throw new Error(`${label} has too many lines.`)
  for (const line of lines) {
    if (line.length > maxLine) throw new Error(`${label} has a line that is too long.`)
  }
  return lines
}

function paragraphsFromBody(body: string): string[] {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replaceAll("\u0000", "").trim())
    .filter(Boolean)
  if (!paragraphs.length) throw new Error("Each terms section needs at least one paragraph.")
  if (paragraphs.length > 40) throw new Error("A terms section has too many paragraphs.")
  for (const paragraph of paragraphs) {
    if (paragraph.length > 12000) throw new Error("A terms paragraph is too long.")
  }
  return paragraphs
}

export function snapshotToEdits(snapshot: BookingFormSnapshot): BookingFormEdits {
  return {
    dealTitle: snapshot.deal.title,
    billToAccountName: snapshot.billTo.accountName,
    billToContactName: snapshot.billTo.contactName,
    billToContactEmail: snapshot.billTo.contactEmail,
    billToAddress: snapshot.billTo.addressLines.join("\n"),
    sellerLegalName: snapshot.seller.legalName,
    sellerAddress: snapshot.seller.addressLines.join("\n"),
    sellerTrn: snapshot.seller.trn,
    lines: snapshot.lines.map((line) => ({
      eventName: line.eventName,
      packageName: line.packageName,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
    paymentTerms: snapshot.paymentTerms,
    paymentMethod: snapshot.paymentMethod,
    bankDetails: snapshot.bankDetails.map((bank) => ({ ...bank })),
    acknowledgement: snapshot.acknowledgement,
    terms: snapshot.terms.map((section) => ({
      heading: section.heading,
      body: section.paragraphs.join("\n\n"),
    })),
    noVat: snapshot.taxAmountIncluded <= 0,
  }
}

export function standardTermEdits(): BookingFormTermEdit[] {
  return BOOKING_TERMS.map((section) => ({
    heading: section.heading,
    body: section.paragraphs.join("\n\n"),
  }))
}

export function applyBookingFormEdits(
  base: BookingFormSnapshot,
  edits: BookingFormEdits,
): BookingFormSnapshot {
  const dealTitle = clean(edits.dealTitle, 240, "Document title")
  const contactEmail = clean(edits.billToContactEmail, 240, "Signer email").toLowerCase()
  if (!EMAIL_RE.test(contactEmail)) throw new Error("Enter a valid signer email address.")

  const nextLines =
    edits.lines.length === base.lines.length
      ? base.lines.map((line, index) => {
          const edit = edits.lines[index]
          const quantity = Number(edit.quantity)
          const unitPrice = Number(edit.unitPrice)
          if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10_000) {
            throw new Error("Each product needs a quantity greater than zero.")
          }
          if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 10_000_000) {
            throw new Error("Each product needs a valid unit price.")
          }
          const eventName = clean(edit.eventName, 240, "Event name")
          const lineTotal = roundMoney(quantity * unitPrice)
          return {
            ...line,
            eventName,
            packageName: clean(edit.packageName, 240, "Package name"),
            description: clean(edit.description, 2000, "Product description"),
            quantity,
            unitPrice: roundMoney(unitPrice),
            lineTotal,
          }
        })
      : base.lines

  if (!nextLines.length) throw new Error("The booking form needs at least one product.")

  const includeVat = !(edits.noVat ?? defaultNoVat(nextLines))
  const taxedLines = nextLines.map((line) => {
    const tax = applyInclusiveVat(line.lineTotal, includeVat)
    return {
      ...line,
      taxRate: tax.taxRate,
      taxAmountIncluded: tax.taxAmountIncluded,
    }
  })
  const nextLinesWithTax = taxedLines
  const subtotal = roundMoney(nextLinesWithTax.reduce((sum, line) => sum + line.lineTotal, 0))
  const taxAmountIncluded = roundMoney(
    nextLinesWithTax.reduce((sum, line) => sum + (line.taxAmountIncluded ?? 0), 0),
  )

  if (!edits.bankDetails.length) throw new Error("Add at least one bank account.")
  if (edits.bankDetails.length > 12) throw new Error("Too many bank accounts.")
  if (!edits.terms.length) throw new Error("The booking form needs terms and conditions.")
  if (edits.terms.length > 40) throw new Error("Too many terms sections.")

  return {
    ...base,
    deal: {
      ...base.deal,
      title: dealTitle,
    },
    seller: {
      legalName: clean(edits.sellerLegalName, 240, "Seller name"),
      addressLines: optionalLines(edits.sellerAddress, 200, 8, "Seller address"),
      trn: clean(edits.sellerTrn, 80, "TRN"),
    },
    billTo: {
      ...base.billTo,
      accountName: clean(edits.billToAccountName, 240, "Account name"),
      contactName: clean(edits.billToContactName, 240, "Signer name"),
      contactEmail,
      addressLines: optionalLines(edits.billToAddress, 200, 8, "Billing address"),
    },
    lines: nextLinesWithTax,
    subtotal,
    taxRate: includeVat ? 0.05 : 0,
    taxAmountIncluded,
    taxDescription: includeVat ? "VAT included (5%)" : undefined,
    total: subtotal,
    paymentTerms: clean(edits.paymentTerms, 4000, "Payment terms"),
    paymentMethod: clean(edits.paymentMethod, 120, "Payment method"),
    bankDetails: edits.bankDetails.map((bank) => ({
      currency: clean(bank.currency, 8, "Bank currency").toUpperCase(),
      recipient: clean(bank.recipient, 200, "Bank recipient"),
      bank: clean(bank.bank, 200, "Bank name"),
      iban: clean(bank.iban, 80, "IBAN"),
      swift: clean(bank.swift, 40, "SWIFT"),
    })),
    acknowledgement: clean(edits.acknowledgement, 2000, "Acknowledgement"),
    terms: edits.terms.map((section) => ({
      heading: clean(section.heading, 240, "Terms heading"),
      paragraphs: paragraphsFromBody(section.body),
    })),
  }
}
