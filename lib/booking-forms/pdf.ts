import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { PDFDocument, PDFImage, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib"
import type {
  BookingFormSignatureEvidence,
  BookingFormSnapshot,
} from "@/lib/booking-forms/types"

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 48
const FOOTER_Y = 24
const CONTENT_BOTTOM = 48
const BLACK = rgb(0.004, 0.004, 0.004)
const MUTED = rgb(0.38, 0.38, 0.4)
const RED = rgb(249 / 255, 2 / 255, 2 / 255)
const LINE = rgb(0.85, 0.85, 0.86)
const HEADER_BG = rgb(0.94, 0.94, 0.94)
const TABLE_HEADER = rgb(0.45, 0.45, 0.47)

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

function isoDate(value: string): string {
  return value.slice(0, 10)
}

function snapshotShowsVat(snapshot: BookingFormSnapshot): boolean {
  return snapshot.taxAmountIncluded > 0
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

function drawRight(
  page: PDFPage,
  text: string,
  y: number,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
) {
  const width = font.widthOfTextAtSize(text, size)
  page.drawText(text, {
    x: A4[0] - MARGIN - width,
    y,
    size,
    font,
    color,
  })
}

async function embedBrandLogo(pdf: PDFDocument): Promise<PDFImage | null> {
  try {
    const bytes = await readFile(join(process.cwd(), "public", "images", "image.png"))
    return await pdf.embedPng(bytes)
  } catch {
    return null
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

function drawLetterhead(writer: Writer, snapshot: BookingFormSnapshot, logo: PDFImage | null) {
  const top = writer.y
  let logoBottom = top
  if (logo) {
    const maxHeight = 36
    const scale = Math.min(maxHeight / logo.height, 180 / logo.width)
    const width = logo.width * scale
    const height = logo.height * scale
    writer.page.drawImage(logo, {
      x: MARGIN,
      y: top - height,
      width,
      height,
    })
    logoBottom = top - height
  } else {
    writer.page.drawText(safeText(snapshot.seller.legalName), {
      x: MARGIN,
      y: top - 14,
      size: 16,
      font: writer.bold,
      color: RED,
    })
    logoBottom = top - 22
  }

  const address = [...snapshot.seller.addressLines, `TRN ${snapshot.seller.trn}`]
  let addressY = top - 8
  for (const line of address) {
    drawRight(writer.page, safeText(line), addressY, writer.regular, 8, BLACK)
    addressY -= 11
  }

  writer.y = Math.min(logoBottom, addressY) - 28
  writer.page.drawText(`Quote No ${safeText(snapshot.documentRef)}`, {
    x: MARGIN,
    y: writer.y,
    size: 16,
    font: writer.bold,
    color: RED,
  })
  writer.y -= 28
}

function drawDateAndBillTo(writer: Writer, snapshot: BookingFormSnapshot) {
  const dateLabel = `Date : ${isoDate(snapshot.createdAt)}`
  writer.page.drawText(dateLabel, {
    x: MARGIN,
    y: writer.y,
    size: 10,
    font: writer.regular,
    color: BLACK,
  })

  const billLines = [
    snapshot.billTo.accountName,
    snapshot.billTo.contactName,
    snapshot.billTo.contactEmail,
    ...snapshot.billTo.addressLines,
  ].map(safeText)
  const billX = 330
  const billWidth = A4[0] - MARGIN - billX
  writer.page.drawText("BILL TO:", {
    x: billX,
    y: writer.y,
    size: 10,
    font: writer.bold,
    color: RED,
  })
  let billY = writer.y - 16
  for (const line of billLines) {
    const wrapped = wrap(line, writer.regular, 9, billWidth)
    for (const part of wrapped) {
      writer.page.drawText(part, {
        x: billX,
        y: billY,
        size: 9,
        font: writer.regular,
        color: BLACK,
      })
      billY -= 13
    }
  }
  writer.y = Math.min(writer.y - 32, billY) - 28
}

function drawCenteredTitle(writer: Writer, title: string) {
  const size = 12
  const lines = wrap(title, writer.bold, size, A4[0] - MARGIN * 2)
  writer.ensure(lines.length * 18 + 24)
  for (const line of lines) {
    const width = writer.bold.widthOfTextAtSize(line, size)
    const x = (A4[0] - width) / 2
    writer.page.drawText(line, { x, y: writer.y, size, font: writer.bold, color: BLACK })
    writer.page.drawLine({
      start: { x, y: writer.y - 3 },
      end: { x: x + width, y: writer.y - 3 },
      thickness: 0.7,
      color: BLACK,
    })
    writer.y -= 18
  }
  writer.y -= 22
}

function drawProductTable(writer: Writer, snapshot: BookingFormSnapshot) {
  const tableX = MARGIN
  const tableW = A4[0] - MARGIN * 2
  const cols = [
    { label: "Product", width: tableW * 0.46, align: "left" as const },
    { label: "Price", width: tableW * 0.2, align: "right" as const },
    { label: "Quantity", width: tableW * 0.14, align: "right" as const },
    { label: "Total", width: tableW * 0.2, align: "right" as const },
  ]
  const headerH = 26
  const pad = 10
  const includeVat = snapshotShowsVat(snapshot)
  if (includeVat) {
    writer.text("Prices include 5% VAT", { size: 8, color: MUTED, gapAfter: 10 })
  }

  const drawHeader = () => {
    writer.ensure(headerH + 28)
    writer.page.drawRectangle({
      x: tableX,
      y: writer.y - headerH,
      width: tableW,
      height: headerH,
      color: HEADER_BG,
      borderColor: LINE,
      borderWidth: 0.8,
    })
    let x = tableX
    for (const col of cols) {
      const labelWidth = writer.bold.widthOfTextAtSize(col.label, 8)
      const textX = col.align === "right" ? x + col.width - pad - labelWidth : x + pad
      writer.page.drawText(col.label, {
        x: textX,
        y: writer.y - 16,
        size: 8,
        font: writer.bold,
        color: TABLE_HEADER,
      })
      x += col.width
      if (x < tableX + tableW - 1) {
        writer.page.drawLine({
          start: { x, y: writer.y },
          end: { x, y: writer.y - headerH },
          thickness: 0.6,
          color: LINE,
        })
      }
    }
    writer.y -= headerH
  }

  drawHeader()

  for (const line of snapshot.lines) {
    const productLines = wrap(line.description, writer.regular, 9, cols[0].width - pad * 2)
    const rowH = Math.max(34, productLines.length * 13 + 18)
    if (writer.y - rowH < CONTENT_BOTTOM) {
      writer.newPage()
      drawHeader()
    }
    writer.page.drawRectangle({
      x: tableX,
      y: writer.y - rowH,
      width: tableW,
      height: rowH,
      borderColor: LINE,
      borderWidth: 0.8,
    })
    let x = tableX
    const values = [
      productLines,
      [money(line.unitPrice, line.currency)],
      [String(line.quantity)],
      [money(line.lineTotal, line.currency)],
    ]
    cols.forEach((col, index) => {
      const cellLines = values[index]
      const font = index === 0 ? writer.regular : writer.bold
      cellLines.forEach((value, lineIndex) => {
        const labelWidth = font.widthOfTextAtSize(value, 9)
        const textX = col.align === "right" ? x + col.width - pad - labelWidth : x + pad
        writer.page.drawText(value, {
          x: textX,
          y: writer.y - 21 - lineIndex * 13,
          size: 9,
          font,
          color: BLACK,
        })
      })
      x += col.width
      if (x < tableX + tableW - 1) {
        writer.page.drawLine({
          start: { x, y: writer.y },
          end: { x, y: writer.y - rowH },
          thickness: 0.6,
          color: LINE,
        })
      }
    })
    writer.y -= rowH
  }
  writer.y -= 22
}

function drawTotals(writer: Writer, snapshot: BookingFormSnapshot) {
  const boxWidth = 220
  const x = A4[0] - MARGIN - boxWidth
  const rows: Array<{ label: string; value: string; bold?: boolean; size?: number }> = [
    { label: "Section total", value: money(snapshot.subtotal, snapshot.currency) },
  ]
  if (snapshotShowsVat(snapshot)) {
    rows.push({
      label: snapshot.taxDescription ?? "VAT included (5%)",
      value: money(snapshot.taxAmountIncluded, snapshot.currency),
    })
  }
  rows.push({
    label: "Total",
    value: money(snapshot.total, snapshot.currency),
    bold: true,
    size: 12,
  })
  writer.ensure(rows.length * 20 + 16)
  for (const row of rows) {
    const font = row.bold ? writer.bold : writer.regular
    const size = row.size ?? 9
    writer.page.drawText(row.label, {
      x,
      y: writer.y,
      size,
      font,
      color: BLACK,
    })
    const valueWidth = font.widthOfTextAtSize(row.value, size)
    writer.page.drawText(row.value, {
      x: A4[0] - MARGIN - valueWidth,
      y: writer.y,
      size,
      font,
      color: BLACK,
    })
    writer.y -= 20
  }
  writer.y -= 28
}

function drawAcknowledgementAndClientSignature(
  writer: Writer,
  snapshot: BookingFormSnapshot,
  signature: PdfSignature | undefined,
  image: PDFImage | null,
) {
  const gap = 28
  const leftWidth = 270
  const boxWidth = A4[0] - MARGIN * 2 - leftWidth - gap
  const ackLines = wrap(snapshot.acknowledgement, writer.bold, 8.5, leftWidth)
  const boxHeight = Math.max(92, ackLines.length * 13 + 16)
  writer.ensure(boxHeight + 16)
  const yTop = writer.y
  ackLines.forEach((line, index) => {
    writer.page.drawText(line, {
      x: MARGIN,
      y: yTop - 12 - index * 13,
      size: 8.5,
      font: writer.bold,
      color: BLACK,
    })
  })
  const boxX = MARGIN + leftWidth + gap
  const boxY = yTop - boxHeight
  if (signature && image) {
    const scaled = image.scaleToFit(boxWidth - 8, Math.max(28, boxHeight - 36))
    writer.page.drawImage(image, {
      x: boxX,
      y: boxY + 28,
      width: scaled.width,
      height: scaled.height,
    })
  }
  writer.page.drawLine({
    start: { x: boxX, y: boxY + 22 },
    end: { x: boxX + boxWidth, y: boxY + 22 },
    thickness: 0.8,
    color: BLACK,
  })
  writer.page.drawText(signature ? safeText(signature.signerName) : "Client signature", {
    x: boxX,
    y: boxY + 12,
    size: 8,
    font: signature ? writer.bold : writer.regular,
    color: signature ? BLACK : MUTED,
  })
  writer.page.drawText(`Date : ${isoDate(signature?.signedAt ?? snapshot.createdAt)}`, {
    x: boxX,
    y: boxY + 1,
    size: 8,
    font: writer.regular,
    color: MUTED,
  })
  writer.y = boxY - 18
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
  const [clientImage, adminImage, logo] = await Promise.all([
    embedSignature(pdf, signatures.client),
    embedSignature(pdf, signatures.zkAdmin),
    embedBrandLogo(pdf),
  ])

  drawLetterhead(writer, snapshot, logo)
  drawDateAndBillTo(writer, snapshot)
  drawCenteredTitle(writer, snapshot.deal.title)
  drawProductTable(writer, snapshot)
  drawTotals(writer, snapshot)
  drawAcknowledgementAndClientSignature(writer, snapshot, signatures.client, clientImage)

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
