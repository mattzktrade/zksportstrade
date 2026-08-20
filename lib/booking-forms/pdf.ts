import { PDFDocument, PDFImage, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib"
import type {
  BookingFormSignatureEvidence,
  BookingFormSnapshot,
} from "@/lib/booking-forms/types"

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 48
const FOOTER_Y = 24
const CONTENT_BOTTOM = 48
const BLACK = rgb(0.08, 0.1, 0.13)
const MUTED = rgb(0.38, 0.42, 0.48)
const ACCENT = rgb(0.1, 0.65, 0.43)
const LINE = rgb(0.85, 0.87, 0.9)

export type PdfSignature = BookingFormSignatureEvidence & {
  pngBytes: Uint8Array
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

function safeText(value: string): string {
  return value
    .replaceAll("\u00a0", " ")
    .replaceAll("\u202f", " ")
    .replaceAll("\u200b", "")
}

function splitLongToken(token: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const parts: string[] = []
  let current = ""
  for (const char of token) {
    if (current && font.widthOfTextAtSize(current + char, size) > maxWidth) {
      parts.push(current)
      current = char
    } else {
      current += char
    }
  }
  if (current) parts.push(current)
  return parts
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const output: string[] = []
  for (const paragraph of safeText(text).split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    let line = ""
    for (const rawWord of words) {
      const wordParts =
        font.widthOfTextAtSize(rawWord, size) > maxWidth
          ? splitLongToken(rawWord, font, size, maxWidth)
          : [rawWord]
      for (const word of wordParts) {
        const candidate = line ? `${line} ${word}` : word
        if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          output.push(line)
          line = word
        } else {
          line = candidate
        }
      }
    }
    output.push(line)
  }
  return output.length ? output : [""]
}

class Writer {
  page: PDFPage
  y: number

  constructor(
    private readonly pdf: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.page = pdf.addPage(A4)
    this.y = A4[1] - MARGIN
  }

  newPage() {
    this.page = this.pdf.addPage(A4)
    this.y = A4[1] - MARGIN
  }

  ensure(height: number) {
    if (this.y - height < CONTENT_BOTTOM) this.newPage()
  }

  text(
    value: string,
    options: {
      size?: number
      font?: PDFFont
      color?: ReturnType<typeof rgb>
      x?: number
      width?: number
      lineHeight?: number
      gapAfter?: number
    } = {},
  ) {
    const size = options.size ?? 9
    const font = options.font ?? this.regular
    const color = options.color ?? BLACK
    const x = options.x ?? MARGIN
    const width = options.width ?? A4[0] - MARGIN * 2
    const lineHeight = options.lineHeight ?? size * 1.35
    const lines = wrap(value, font, size, width)
    this.ensure(lines.length * lineHeight)
    for (const line of lines) {
      this.page.drawText(line, { x, y: this.y, size, font, color })
      this.y -= lineHeight
    }
    this.y -= options.gapAfter ?? 3
  }

  heading(value: string, size = 13) {
    this.ensure(size * 2)
    this.text(value, { size, font: this.bold, gapAfter: 8 })
  }

  rule(gap = 12) {
    this.ensure(gap * 2)
    this.y -= gap / 2
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: A4[0] - MARGIN, y: this.y },
      thickness: 0.8,
      color: LINE,
    })
    this.y -= gap
  }
}

async function embedSignature(
  pdf: PDFDocument,
  signature: PdfSignature | undefined,
): Promise<PDFImage | null> {
  if (!signature?.pngBytes?.length) return null
  try {
    return await pdf.embedPng(signature.pngBytes)
  } catch {
    return null
  }
}

function drawSignatureBlock(
  writer: Writer,
  label: string,
  signature: PdfSignature | undefined,
  image: PDFImage | null,
  x: number,
  yTop: number,
) {
  const width = (A4[0] - MARGIN * 2 - 18) / 2
  writer.page.drawRectangle({
    x,
    y: yTop - 126,
    width,
    height: 126,
    borderColor: LINE,
    borderWidth: 1,
  })
  writer.page.drawText(label, {
    x: x + 12,
    y: yTop - 20,
    size: 9,
    font: writer.bold,
    color: BLACK,
  })
  if (signature && image) {
    const scaled = image.scaleToFit(width - 24, 48)
    writer.page.drawImage(image, {
      x: x + 12,
      y: yTop - 75,
      width: scaled.width,
      height: scaled.height,
    })
    writer.page.drawText(safeText(signature.signerName), {
      x: x + 12,
      y: yTop - 94,
      size: 8,
      font: writer.bold,
      color: BLACK,
    })
    writer.page.drawText(safeText(signature.signerEmail), {
      x: x + 12,
      y: yTop - 106,
      size: 7,
      font: writer.regular,
      color: MUTED,
    })
    writer.page.drawText(new Date(signature.signedAt).toISOString(), {
      x: x + 12,
      y: yTop - 117,
      size: 7,
      font: writer.regular,
      color: MUTED,
    })
  } else {
    writer.page.drawText("Signature pending", {
      x: x + 12,
      y: yTop - 73,
      size: 9,
      font: writer.regular,
      color: MUTED,
    })
  }
}

export async function generateBookingFormPdf(
  snapshot: BookingFormSnapshot,
  signatures: { client?: PdfSignature; zkAdmin?: PdfSignature } = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${snapshot.documentRef} — ${snapshot.deal.title}`)
  pdf.setAuthor(snapshot.seller.legalName)
  pdf.setSubject("Booking Form and Ticketing & Hospitality Terms and Conditions")
  pdf.setCreationDate(new Date(snapshot.createdAt))
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const writer = new Writer(pdf, regular, bold)

  writer.text(snapshot.seller.legalName, { size: 18, font: bold, color: ACCENT, gapAfter: 4 })
  writer.text(snapshot.seller.addressLines.join("\n"), { size: 8, color: MUTED, gapAfter: 1 })
  writer.text(`TRN ${snapshot.seller.trn}`, { size: 8, color: MUTED, gapAfter: 14 })
  writer.heading("BOOKING FORM", 16)
  writer.text(`Reference: ${snapshot.documentRef}`, { font: bold })
  writer.text(
    `Date: ${new Date(snapshot.createdAt).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })}`,
  )
  writer.rule()
  writer.heading("BILL TO", 10)
  writer.text(snapshot.billTo.accountName, { font: bold, gapAfter: 1 })
  writer.text(snapshot.billTo.contactName, { gapAfter: 1 })
  writer.text(snapshot.billTo.contactEmail, {
    gapAfter: snapshot.billTo.addressLines.length ? 1 : 12,
  })
  if (snapshot.billTo.addressLines.length) {
    writer.text(snapshot.billTo.addressLines.join("\n"), { gapAfter: 12 })
  }

  for (const line of snapshot.lines) {
    writer.ensure(44)
    writer.text(line.description, { font: bold, width: 310, gapAfter: 1 })
    writer.text(
      `${money(line.unitPrice, line.currency)} × ${line.quantity}    ${money(line.lineTotal, line.currency)}`,
      { size: 9, color: MUTED, gapAfter: 10 },
    )
  }
  writer.rule()
  writer.text(`Subtotal: ${money(snapshot.subtotal, snapshot.currency)}`, {
    font: bold,
    x: 310,
    width: 235,
  })
  if (snapshot.taxAmountIncluded > 0) {
    writer.text(
      `${snapshot.taxDescription ?? `VAT included (${(snapshot.taxRate * 100).toFixed(0)}%)`}: ${money(
        snapshot.taxAmountIncluded,
        snapshot.currency,
      )}`,
      { x: 310, width: 235 },
    )
  }
  writer.text(`Total: ${money(snapshot.total, snapshot.currency)}`, {
    size: 13,
    font: bold,
    color: ACCENT,
    x: 310,
    width: 235,
    gapAfter: 18,
  })
  writer.text(snapshot.acknowledgement, { size: 10, font: bold, lineHeight: 14 })

  writer.newPage()
  writer.heading("PAYMENT TERMS (ALL AMOUNTS IN USD)", 12)
  writer.text(snapshot.paymentTerms, { font: bold })
  writer.text(
    "Contracts for which payments are not received within ten (10) business days of contract execution are subject to cancellation. I acknowledge that I have agreed to the payment and terms as represented and will make payment accordingly.",
  )
  writer.text(
    "DELIVERY OF PACKAGE: ZK Sports shall not be obligated to provide the Package or an element or portion thereof, unless and until ZK Sports receives the full and timely payment.",
  )
  writer.text(
    "The undersigned each represent and warrant that they have the authority to enter into this agreement on behalf of the respective parties.",
  )
  writer.rule()
  writer.heading(`PAYMENT METHOD: ${snapshot.paymentMethod}`, 10)
  for (const bank of snapshot.bankDetails) {
    writer.ensure(64)
    writer.text(`${bank.currency}: ${bank.recipient}`, { font: bold, gapAfter: 1 })
    writer.text(`BANK: ${bank.bank}`, { gapAfter: 1 })
    writer.text(`IBAN: ${bank.iban}`, { gapAfter: 1 })
    writer.text(`SWIFT: ${bank.swift}`, { gapAfter: 8 })
  }

  writer.newPage()
  writer.heading("Ticketing & Hospitality Terms and Conditions", 13)
  for (const section of snapshot.terms) {
    writer.ensure(32)
    writer.text(section.heading, { size: 9, font: bold, gapAfter: 3 })
    for (const paragraph of section.paragraphs) {
      writer.text(paragraph, { size: 7.4, lineHeight: 9.6, gapAfter: 4 })
    }
  }

  writer.newPage()
  writer.heading("SIGNATURES", 14)
  writer.text(
    "I ACKNOWLEDGE THAT I HAVE READ AND UNDERSTAND THE TERMS AND CONDITIONS AND I AM IN AGREEMENT.",
    { size: 10, font: bold, lineHeight: 14, gapAfter: 18 },
  )
  const [clientImage, adminImage] = await Promise.all([
    embedSignature(pdf, signatures.client),
    embedSignature(pdf, signatures.zkAdmin),
  ])
  writer.ensure(145)
  const blockWidth = (A4[0] - MARGIN * 2 - 18) / 2
  const yTop = writer.y
  drawSignatureBlock(writer, "CLIENT", signatures.client, clientImage, MARGIN, yTop)
  drawSignatureBlock(
    writer,
    "SELLER — ZK ADMIN",
    signatures.zkAdmin,
    adminImage,
    MARGIN + blockWidth + 18,
    yTop,
  )
  writer.y -= 145
  writer.text(`Document snapshot SHA-256: ${snapshot.documentRef} / immutable snapshot`, {
    size: 7,
    color: MUTED,
    x: MARGIN,
    gapAfter: 0,
  })

  if (signatures.client && signatures.zkAdmin) {
    writer.newPage()
    writer.heading("ELECTRONIC SIGNATURE CERTIFICATE", 14)
    writer.text(`Document reference: ${snapshot.documentRef}`, { font: bold })
    writer.text(
      `Completed: ${new Date(signatures.zkAdmin.signedAt).toISOString()}`,
      { gapAfter: 14 },
    )
    for (const signature of [signatures.client, signatures.zkAdmin]) {
      writer.heading(signature.signerRole === "client" ? "CLIENT SIGNER" : "ZK ADMIN SIGNER", 10)
      writer.text(`Name: ${signature.signerName}`, { gapAfter: 1 })
      writer.text(`Email: ${signature.signerEmail}`, { gapAfter: 1 })
      writer.text(`Signed: ${new Date(signature.signedAt).toISOString()}`, { gapAfter: 1 })
      writer.text(`IP address: ${signature.ipAddress ?? "Not available"}`, { gapAfter: 1 })
      writer.text(`Location: ${signature.location ?? "Not available"}`, { gapAfter: 1 })
      writer.text(`User agent: ${signature.userAgent ?? "Not available"}`, {
        size: 7,
        gapAfter: 1,
      })
      writer.text(`Evidence SHA-256: ${signature.evidenceHash}`, {
        size: 7,
        color: MUTED,
        gapAfter: 12,
      })
    }
  }

  const pages = pdf.getPages()
  pages.forEach((page, index) => {
    page.drawText(`Document Ref: ${snapshot.documentRef}`, {
      x: MARGIN,
      y: FOOTER_Y,
      size: 7,
      font: regular,
      color: MUTED,
    })
    const pageText = `Page ${index + 1} of ${pages.length}`
    page.drawText(pageText, {
      x: A4[0] - MARGIN - regular.widthOfTextAtSize(pageText, 7),
      y: FOOTER_Y,
      size: 7,
      font: regular,
      color: MUTED,
    })
  })

  return pdf.save()
}

