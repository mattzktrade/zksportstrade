import { PDFDocument, PDFFont, PDFPage, degrees, rgb } from "pdf-lib"
import { BLACK, RED, WHITE, drawTracked, trackedWidth } from "@/lib/brochures/template"
import { embedBrochureFonts } from "@/lib/brochures/fonts"
import {
  compressBrochureImageBytes,
  drawImageCover,
  embedPublicImage,
  embedRasterImage,
} from "@/lib/brochures/images"
import { brochurePrintText } from "@/lib/brochures/text"
import { displayTicketShortCode } from "@/lib/tickets/pass"
import { validDayChipLabels } from "@/lib/tickets/model"
import { ticketQrPngBytes } from "@/lib/tickets/qr"
import type { CostDaySlot } from "@/lib/inventory/day-cost-allocation"

const CARD = rgb(0.07, 0.075, 0.085)
const LABEL = rgb(0.62, 0.63, 0.65)
const MUTED = rgb(0.58, 0.59, 0.61)
const HAIRLINE = rgb(0.28, 0.29, 0.31)
const PAGE_W = 400
const PAGE_H = 840

export type TicketPdfInput = {
  guestName: string
  eventLabel: string
  packageName: string
  venue: string
  days: CostDaySlot[]
  shortCode: string
  qrPayload: string
  voided?: boolean
  headshotBytes?: Uint8Array | null
}

function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number): string[] {
  const words = brochurePrintText(text).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  if (!lines.length) return [""]
  return lines.slice(0, maxLines)
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h / 2)
  return [
    `M ${x + radius} ${y}`,
    `L ${x + w - radius} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + radius}`,
    `L ${x + w} ${y + h - radius}`,
    `Q ${x + w} ${y + h} ${x + w - radius} ${y + h}`,
    `L ${x + radius} ${y + h}`,
    `Q ${x} ${y + h} ${x} ${y + h - radius}`,
    `L ${x} ${y + radius}`,
    `Q ${x} ${y} ${x + radius} ${y}`,
    "Z",
  ].join(" ")
}

function drawLabel(page: PDFPage, text: string, font: PDFFont, x: number, y: number) {
  drawTracked(page, text, { x, y, size: 7.5, font, color: LABEL, tracking: 1.55 })
}

function drawHairline(page: PDFPage, x: number, y: number, width: number) {
  page.drawRectangle({ x, y, width, height: 0.6, color: HAIRLINE, opacity: 0.9 })
}

function drawWrapped(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
  box: { x: number; y: number; width: number },
  maxLines: number,
  leading: number,
): number {
  const lines = wrapLines(text, font, size, box.width, maxLines)
  lines.forEach((line, index) => {
    page.drawText(line, { x: box.x, y: box.y - index * leading, size, font, color })
  })
  return box.y - (lines.length - 1) * leading
}

export async function buildTicketPdf(input: TicketPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([PAGE_W, PAGE_H])
  const fonts = await embedBrochureFonts(doc)
  const bold = fonts.condensed
  const sans = fonts.sans
  const sansMedium = fonts.sansMedium
  const qr = await doc.embedPng(await ticketQrPngBytes(input.qrPayload))
  const logo = await embedPublicImage(doc, "images", "ZK white logo.png")
  const backdrop = await embedPublicImage(doc, "images", "tickets", "ticket-bg-mobile.jpg")
  const f1 = await embedPublicImage(doc, "images", "tickets", "f1-mark.png")

  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: BLACK })
  if (backdrop) {
    drawImageCover(page, backdrop, { x: 0, y: 0, width: PAGE_W, height: PAGE_H })
  }

  if (logo) {
    const scale = Math.min(28 / logo.height, 156 / logo.width)
    const width = logo.width * scale
    const height = logo.height * scale
    page.drawImage(logo, { x: (PAGE_W - width) / 2, y: PAGE_H - 54, width, height })
  } else {
    const fallback = "ZK SPORTS"
    const width = sansMedium.widthOfTextAtSize(fallback, 13)
    page.drawText(fallback, { x: (PAGE_W - width) / 2, y: PAGE_H - 48, size: 13, font: sansMedium, color: WHITE })
  }

  const kicker = input.voided ? "VOID" : "GUEST TICKET"
  const kickerWidth = trackedWidth(kicker, sansMedium, 8, 2.4)
  drawTracked(page, kicker, {
    x: (PAGE_W - kickerWidth) / 2,
    y: PAGE_H - 80,
    size: 8,
    font: sansMedium,
    color: RED,
    tracking: 2.4,
  })

  const cardX = 24
  const cardY = 26
  const cardW = PAGE_W - 48
  const cardH = PAGE_H - 122
  const radius = 16
  page.drawSvgPath(roundedRectPath(cardX, cardY, cardW, cardH, radius), {
    color: CARD,
    borderColor: rgb(0.32, 0.33, 0.35),
    borderWidth: 0.8,
    opacity: 0.78,
  })
  const drop = 12
  page.drawSvgPath(
    [
      `M ${cardX + 1.3} ${cardY + cardH - drop}`,
      `L ${cardX + 1.3} ${cardY + cardH - radius}`,
      `Q ${cardX + 1.3} ${cardY + cardH - 1.3} ${cardX + radius} ${cardY + cardH - 1.3}`,
      `L ${cardX + cardW - radius} ${cardY + cardH - 1.3}`,
      `Q ${cardX + cardW - 1.3} ${cardY + cardH - 1.3} ${cardX + cardW - 1.3} ${cardY + cardH - radius}`,
      `L ${cardX + cardW - 1.3} ${cardY + cardH - drop}`,
    ].join(" "),
    { borderColor: RED, borderWidth: 2 },
  )

  let photo = null
  if (input.headshotBytes?.length) {
    try {
      const compressed = await compressBrochureImageBytes(input.headshotBytes, 360)
      photo = await embedRasterImage(doc, compressed.length ? compressed : input.headshotBytes)
    } catch {
      photo = null
    }
  }

  const insetX = cardX + 22
  const insetRight = cardX + cardW - 22
  const contentW = insetRight - insetX
  const f1H = 14
  const f1W = f1 ? (f1.width / f1.height) * f1H : 0
  const photoSize = 36
  const headerReserve = f1W + (photo ? photoSize + 8 : 0) + 8
  let y = cardY + cardH - 32

  if (f1) {
    page.drawImage(f1, {
      x: insetRight - headerReserve + 8,
      y: y - 4,
      width: f1W,
      height: f1H,
    })
  }
  if (photo) {
    const box = {
      x: insetRight - photoSize,
      y: y - 8,
      width: photoSize,
      height: photoSize,
    }
    page.drawRectangle({
      x: box.x - 1,
      y: box.y - 1,
      width: box.width + 2,
      height: box.height + 2,
      color: RED,
    })
    drawImageCover(page, photo, box)
  }

  y = drawWrapped(page, input.guestName.trim() || "Guest", sansMedium, 22, WHITE, {
    x: insetX,
    y,
    width: Math.max(120, contentW - headerReserve),
  }, 2, 24)
  y -= 12
  drawLabel(page, "GUEST", sansMedium, insetX, y)
  y -= 14
  drawHairline(page, insetX, y, contentW)
  y -= 18
  drawLabel(page, "PACKAGE", sansMedium, insetX, y)
  y -= 14
  y = drawWrapped(page, input.packageName, sansMedium, 12.5, WHITE, { x: insetX, y, width: contentW }, 2, 15)
  y -= 12
  drawHairline(page, insetX, y, contentW)
  y -= 18
  drawLabel(page, "EVENT", sansMedium, insetX, y)
  y -= 14
  y = drawWrapped(page, input.eventLabel, sansMedium, 12.5, WHITE, { x: insetX, y, width: contentW }, 2, 15)
  y -= 12
  drawHairline(page, insetX, y, contentW)
  y -= 18
  drawLabel(page, "ATTENDING DAYS", sansMedium, insetX, y)
  y -= 20

  const chips = validDayChipLabels(input.days)
  const chipGap = 6
  const chipH = 20
  const ring = 1.5
  const chipW = chips.length ? (contentW - chipGap * (chips.length - 1)) / chips.length : contentW
  chips.forEach((label, index) => {
    const x = insetX + index * (chipW + chipGap)
    page.drawSvgPath(roundedRectPath(x, y, chipW, chipH, 10), { color: RED })
    page.drawSvgPath(roundedRectPath(x + ring, y + ring, chipW - ring * 2, chipH - ring * 2, 8.5), {
      color: rgb(0.09, 0.04, 0.05),
    })
    const text = brochurePrintText(label)
    const textW = sansMedium.widthOfTextAtSize(text, 8)
    page.drawText(text, {
      x: x + (chipW - textW) / 2,
      y: y + 6,
      size: 8,
      font: sansMedium,
      color: WHITE,
    })
  })

  const qrSize = 158
  const qrPad = 11
  const qrBox = qrSize + qrPad * 2
  const qrX = cardX + (cardW - qrBox) / 2
  y -= 16 + qrBox
  page.drawSvgPath(roundedRectPath(qrX, y, qrBox, qrBox, 12), { color: WHITE })
  if (input.voided) {
    const voidLabel = "VOID"
    const voidWidth = bold.widthOfTextAtSize(voidLabel, 26)
    page.drawText(voidLabel, {
      x: qrX + (qrBox - voidWidth) / 2,
      y: y + qrBox / 2 - 9,
      size: 26,
      font: bold,
      color: RED,
    })
  } else {
    page.drawImage(qr, { x: qrX + qrPad, y: y + qrPad, width: qrSize, height: qrSize })
  }

  y -= 22
  const code = brochurePrintText(displayTicketShortCode(input.shortCode))
  const codeSize = 15
  const codeWidth = sansMedium.widthOfTextAtSize(code, codeSize)
  page.drawText(code, {
    x: cardX + (cardW - codeWidth) / 2,
    y,
    size: codeSize,
    font: sansMedium,
    color: WHITE,
  })
  y -= 14
  drawHairline(page, insetX, y, contentW)
  y -= 16

  const note = "This ticket is named and unique. Do not share the QR. If it will not scan, show this pass and photo ID."
  wrapLines(note, sans, 8, contentW, 3).forEach((line, index) => {
    const width = sans.widthOfTextAtSize(line, 8)
    page.drawText(line, {
      x: cardX + (cardW - width) / 2,
      y: y - index * 11,
      size: 8,
      font: sans,
      color: MUTED,
    })
  })

  if (input.voided) {
    page.drawText("VOID", {
      x: 78,
      y: 340,
      size: 72,
      font: bold,
      color: rgb(0.9, 0.1, 0.1),
      rotate: degrees(-24),
      opacity: 0.45,
    })
  }

  return doc.save()
}
