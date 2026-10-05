import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from "pdf-lib"
import { BOOKING_SELLER } from "@/lib/booking-forms/template"
import { pdfSafe, type ContractDraft } from "@/lib/contracts/content"

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

export type ContractPdfSignature = {
  name: string
  position: string
  signedAt: string
  pngBytes?: Uint8Array
}

function isoDate(value: string): string {
  return value.slice(0, 10)
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
  for (const paragraph of pdfSafe(text).split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      output.push("")
      continue
    }
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
    if (line) output.push(line)
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
    const lines = wrap(value, font, size, width).filter(Boolean)
    if (lines.length === 0) return
    this.ensure(lines.length * lineHeight + 2)
    for (const line of lines) {
      this.page.drawText(line, { x, y: this.y, size, font, color })
      this.y -= lineHeight
    }
    this.y -= options.gapAfter ?? 3
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

function drawRightWrapped(
  page: PDFPage,
  text: string,
  y: number,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
  maxWidth: number,
  lineHeight: number,
): number {
  const lines = wrap(text, font, size, maxWidth)
  let currentY = y
  for (const line of lines) {
    drawRight(page, line, currentY, font, size, color)
    currentY -= lineHeight
  }
  return currentY
}

async function embedBrandLogo(pdf: PDFDocument): Promise<PDFImage | null> {
  try {
    const bytes = await readFile(join(process.cwd(), "public", "images", "image.png"))
    return await pdf.embedPng(bytes)
  } catch {
    return null
  }
}

function drawLetterhead(writer: Writer, documentRef: string, logo: PDFImage | null): number {
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
    writer.page.drawText(pdfSafe(BOOKING_SELLER.legalName), {
      x: MARGIN,
      y: top - 14,
      size: 16,
      font: writer.bold,
      color: RED,
    })
    logoBottom = top - 22
  }

  const address = [...BOOKING_SELLER.addressLines, `TRN ${BOOKING_SELLER.trn}`]
  let addressY = top - 8
  for (const line of address) {
    drawRight(writer.page, pdfSafe(line), addressY, writer.regular, 8, BLACK)
    addressY -= 11
  }

  writer.y = Math.min(logoBottom, addressY) - 28
  const quoteY = writer.y
  writer.page.drawText(`Contract No ${pdfSafe(documentRef)}`, {
    x: MARGIN,
    y: quoteY,
    size: 16,
    font: writer.bold,
    color: RED,
  })
  writer.y -= 28
  return quoteY
}

function drawDateAndBillTo(
  writer: Writer,
  draft: ContractDraft,
  documentRef: string,
  issuedAt: string,
  quoteY: number,
) {
  writer.page.drawText(`Date : ${isoDate(issuedAt)}`, {
    x: MARGIN,
    y: writer.y,
    size: 10,
    font: writer.regular,
    color: BLACK,
  })

  const quoteLabel = `Contract No ${pdfSafe(documentRef)}`
  const quoteWidth = writer.bold.widthOfTextAtSize(quoteLabel, 16)
  const billMaxWidth = Math.max(140, A4[0] - MARGIN * 2 - quoteWidth - 24)
  const billEntries: Array<{ text: string; font: PDFFont; size: number; color: ReturnType<typeof rgb>; lineHeight: number }> = [
    { text: "BILL TO:", font: writer.bold, size: 10, color: RED, lineHeight: 16 },
    { text: draft.companyName, font: writer.bold, size: 9, color: BLACK, lineHeight: 13 },
    { text: draft.clientName, font: writer.bold, size: 9, color: BLACK, lineHeight: 13 },
    { text: draft.clientEmail, font: writer.regular, size: 9, color: BLACK, lineHeight: 13 },
  ]

  let billY = quoteY
  for (const entry of billEntries) {
    const text = pdfSafe(entry.text).trim()
    if (!text) continue
    billY = drawRightWrapped(
      writer.page,
      text,
      billY,
      entry.font,
      entry.size,
      entry.color,
      billMaxWidth,
      entry.lineHeight,
    )
  }
  writer.y = Math.min(writer.y - 32, billY) - 28
}

function drawCenteredTitle(writer: Writer, title: string) {
  const size = 12
  const lines = wrap(title || "Booking inclusions", writer.bold, size, A4[0] - MARGIN * 2)
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

function drawDetailsTable(writer: Writer, draft: ContractDraft) {
  const rows = [
    ["Event", draft.content.event],
    ["Dates", draft.content.dates],
    ["Operating hours", draft.content.operatingHours],
    ["Guest allocation", draft.content.guestAllocation],
  ].filter(([, value]) => value.trim())
  if (rows.length === 0) return

  const tableX = MARGIN
  const tableW = A4[0] - MARGIN * 2
  const labelW = tableW * 0.28
  const valueW = tableW - labelW
  const headerH = 26
  const pad = 10

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
    writer.page.drawText("Item", {
      x: tableX + pad,
      y: writer.y - 16,
      size: 8,
      font: writer.bold,
      color: TABLE_HEADER,
    })
    writer.page.drawText("Detail", {
      x: tableX + labelW + pad,
      y: writer.y - 16,
      size: 8,
      font: writer.bold,
      color: TABLE_HEADER,
    })
    writer.y -= headerH
  }

  drawHeader()
  for (const [label, value] of rows) {
    const valueLines = wrap(value, writer.regular, 9, valueW - pad * 2).filter(Boolean)
    const rowH = Math.max(28, valueLines.length * 12 + 14)
    writer.ensure(rowH + 8)
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
      borderWidth: 0.6,
    })
    writer.page.drawLine({
      start: { x: tableX + labelW, y: writer.y },
      end: { x: tableX + labelW, y: writer.y - rowH },
      thickness: 0.6,
      color: LINE,
    })
    writer.page.drawText(pdfSafe(label), {
      x: tableX + pad,
      y: writer.y - 18,
      size: 9,
      font: writer.bold,
      color: BLACK,
    })
    valueLines.forEach((line, index) => {
      writer.page.drawText(line, {
        x: tableX + labelW + pad,
        y: writer.y - 18 - index * 12,
        size: 9,
        font: writer.regular,
        color: BLACK,
      })
    })
    writer.y -= rowH
  }
  writer.y -= 18
}

function drawSections(writer: Writer, draft: ContractDraft) {
  draft.content.sections.forEach((section, index) => {
    writer.ensure(36)
    writer.text(`${index + 1}.  ${section.heading}`, {
      size: 10,
      font: writer.bold,
      gapAfter: 6,
    })
    for (const bullet of section.bullets) {
      const lines = wrap(bullet, writer.regular, 9, A4[0] - MARGIN * 2 - 16).filter(Boolean)
      if (lines.length === 0) continue
      writer.ensure(lines.length * 12 + 4)
      lines.forEach((line, lineIndex) => {
        writer.page.drawText(lineIndex === 0 ? `-  ${line}` : `   ${line}`, {
          x: MARGIN + 4,
          y: writer.y,
          size: 9,
          font: writer.regular,
          color: BLACK,
        })
        writer.y -= 12
      })
      writer.y -= 3
    }
    writer.y -= 8
  })
}

function drawAcknowledgementAndSignature(
  writer: Writer,
  draft: ContractDraft,
  signature: ContractPdfSignature | null | undefined,
  image: PDFImage | null,
  issuedAt: string,
) {
  const gap = 28
  const leftWidth = 270
  const boxWidth = A4[0] - MARGIN * 2 - leftWidth - gap
  const ack = (draft.content.confirmationIntro || "").toUpperCase()
  const ackLines = wrap(ack, writer.bold, 8.5, leftWidth).filter(Boolean)
  const extraLines = signature
    ? [signature.name, signature.position].filter((value) => value.trim())
    : []
  const boxHeight = Math.max(92, ackLines.length * 13 + 16, extraLines.length * 11 + 56)
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
    const scaled = image.scaleToFit(boxWidth - 8, Math.max(28, boxHeight - 48))
    writer.page.drawImage(image, {
      x: boxX,
      y: boxY + 40,
      width: scaled.width,
      height: scaled.height,
    })
  }
  writer.page.drawLine({
    start: { x: boxX, y: boxY + 32 },
    end: { x: boxX + boxWidth, y: boxY + 32 },
    thickness: 0.8,
    color: BLACK,
  })
  const nameLabel = signature?.name ? pdfSafe(signature.name) : "Client signature"
  writer.page.drawText(nameLabel, {
    x: boxX,
    y: boxY + 20,
    size: 8,
    font: signature?.name ? writer.bold : writer.regular,
    color: signature?.name ? BLACK : MUTED,
  })
  if (signature?.position) {
    writer.page.drawText(pdfSafe(signature.position), {
      x: boxX,
      y: boxY + 10,
      size: 7,
      font: writer.regular,
      color: MUTED,
    })
  }
  writer.page.drawText(`Date : ${isoDate(signature?.signedAt ?? issuedAt)}`, {
    x: boxX,
    y: boxY + 1,
    size: 8,
    font: writer.regular,
    color: MUTED,
  })
  writer.y = boxY - 18
}

export async function generateInclusionContractPdf(input: {
  documentRef: string
  draft: ContractDraft
  issuedAt?: string
  signature?: ContractPdfSignature | null
}): Promise<Uint8Array> {
  const issuedAt = input.issuedAt || new Date().toISOString()
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${input.documentRef} — ${input.draft.title || "Contract"}`)
  pdf.setAuthor(BOOKING_SELLER.legalName)
  pdf.setSubject("Contract")
  pdf.setCreationDate(new Date(issuedAt))
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const writer = new Writer(pdf, regular, bold)
  const logo = await embedBrandLogo(pdf)
  let signatureImage: PDFImage | null = null
  if (input.signature?.pngBytes?.length) {
    try {
      signatureImage = await pdf.embedPng(input.signature.pngBytes)
    } catch {
      signatureImage = null
    }
  }

  const quoteY = drawLetterhead(writer, input.documentRef, logo)
  drawDateAndBillTo(writer, input.draft, input.documentRef, issuedAt, quoteY)
  drawCenteredTitle(writer, input.draft.title)
  drawDetailsTable(writer, input.draft)
  drawSections(writer, input.draft)
  drawAcknowledgementAndSignature(writer, input.draft, input.signature, signatureImage, issuedAt)

  const pages = pdf.getPages()
  pages.forEach((page, index) => {
    page.drawText(`Document Ref: ${pdfSafe(input.documentRef)}`, {
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
