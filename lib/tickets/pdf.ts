import { PDFDocument, rgb, StandardFonts } from "pdf-lib"
import { BRAND_BLACK, BRAND_RED } from "@/lib/branding"
import { validDayLabels } from "@/lib/tickets/model"
import { ticketQrPngBytes } from "@/lib/tickets/qr"
import type { CostDaySlot } from "@/lib/inventory/day-cost-allocation"

const RED = rgb(249 / 255, 2 / 255, 2 / 255)
const BLACK = rgb(1 / 255, 1 / 255, 1 / 255)
const GREY = rgb(0.4, 0.4, 0.42)

export type TicketPdfInput = {
  guestName: string
  eventLabel: string
  packageName: string
  venue: string
  days: CostDaySlot[]
  shortCode: string
  qrPayload: string
  voided?: boolean
}

function hexRgb(value: string) {
  const hex = value.replace("#", "")
  return rgb(
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  )
}

export async function buildTicketPdf(input: TicketPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 640])
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const qr = await doc.embedPng(await ticketQrPngBytes(input.qrPayload))
  const { width, height } = page.getSize()

  page.drawRectangle({ x: 0, y: 0, width, height, color: hexRgb(BRAND_BLACK) })
  page.drawRectangle({ x: 0, y: height - 10, width, height: 10, color: hexRgb(BRAND_RED) })
  page.drawText("ZK SPORTS", {
    x: 28,
    y: height - 48,
    size: 11,
    font: bold,
    color: rgb(1, 1, 1),
  })
  page.drawText(input.voided ? "VOID" : "GUEST TICKET", {
    x: 28,
    y: height - 66,
    size: 9,
    font: sans,
    color: RED,
  })

  page.drawRectangle({
    x: 20,
    y: 72,
    width: width - 40,
    height: height - 160,
    color: rgb(1, 1, 1),
  })

  const name = (input.guestName.trim() || "Guest").slice(0, 48)
  page.drawText(name, { x: 36, y: height - 130, size: 18, font: bold, color: BLACK })
  page.drawText(input.packageName.slice(0, 52), { x: 36, y: height - 152, size: 11, font: sans, color: GREY })
  page.drawText(input.eventLabel.slice(0, 52), { x: 36, y: height - 170, size: 11, font: sans, color: BLACK })
  if (input.venue.trim()) {
    page.drawText(input.venue.slice(0, 52), { x: 36, y: height - 186, size: 10, font: sans, color: GREY })
  }
  page.drawText(validDayLabels(input.days), { x: 36, y: height - 208, size: 11, font: bold, color: RED })

  const qrSize = 196
  const qrX = (width - qrSize) / 2
  page.drawImage(qr, { x: qrX, y: 168, width: qrSize, height: qrSize })
  page.drawText(input.shortCode, {
    x: width / 2 - bold.widthOfTextAtSize(input.shortCode, 14) / 2,
    y: 140,
    size: 14,
    font: bold,
    color: BLACK,
  })
  page.drawText("Do not share this ticket. Names are checked at the door.", {
    x: 36,
    y: 108,
    size: 8,
    font: sans,
    color: GREY,
  })

  page.drawText("Show this screen or printout at the ZK welcome point.", {
    x: 28,
    y: 40,
    size: 8,
    font: sans,
    color: rgb(0.85, 0.85, 0.85),
  })

  if (input.voided) {
    page.drawText("VOID", {
      x: 90,
      y: 300,
      size: 72,
      font: bold,
      color: rgb(0.9, 0.1, 0.1),
      rotate: { type: "degrees", angle: -24 },
      opacity: 0.55,
    })
  }

  return doc.save()
}
