import { PDFFont, PDFImage, PDFPage, rgb, type RGB } from "pdf-lib"
import { BRAND_BLACK, BRAND_RED } from "@/lib/branding"
import type { BrochureFonts } from "@/lib/brochures/fonts"
import {
  clipPolygon,
  drawImageCover,
  drawImageCoverUnclipped,
  endClip,
  polygonPath,
} from "@/lib/brochures/images"
import { brochurePrintText, fitTitle } from "@/lib/brochures/text"

export const PAGE: [number, number] = [841.89, 595.28]
export const PAGE_W = PAGE[0]
export const PAGE_H = PAGE[1]
export const RAIL = 6
export const MARGIN = 28
export const FRAME = 16
export const FOOTER_H = 34
export const HEADER_H = 50

export const TAGLINE = "Exclusive access  ·  Premium hospitality"

function hexToRgb(hex: string): RGB {
  const n = hex.replace("#", "")
  return rgb(
    Number.parseInt(n.slice(0, 2), 16) / 255,
    Number.parseInt(n.slice(2, 4), 16) / 255,
    Number.parseInt(n.slice(4, 6), 16) / 255,
  )
}

export const BLACK = hexToRgb(BRAND_BLACK)
export const RED = hexToRgb(BRAND_RED)
export const WHITE = rgb(1, 1, 1)
export const MUTED = rgb(0.78, 0.78, 0.78)
export const SOFT = rgb(0.62, 0.62, 0.62)
export const CHARCOAL = rgb(0.12, 0.12, 0.12)

export const HEADING = {
  kickerSize: 11,
  titleSize: 44,
  kickerToTitle: 22,
  titleLeading: 0.86,
  titleToRule: 14,
  ruleW: 56,
  ruleH: 3.2,
  ruleToContent: 22,
} as const

export const COVER_TYPE = {
  kickerSize: 13,
  titleSize: 52,
  titleMin: 30,
  eventSize: 16,
  metaSize: 13,
} as const

export function safeDrawText(
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; size: number; font: PDFFont; color: RGB; opacity?: number },
) {
  const value = brochurePrintText(text)
  if (!value) return
  page.drawText(value, opts)
}

export function trackedWidth(text: string, font: PDFFont, size: number, tracking = 1.6): number {
  const value = brochurePrintText(text).toUpperCase()
  if (!value) return 0
  let width = 0
  for (let i = 0; i < value.length; i += 1) {
    width += font.widthOfTextAtSize(value[i] ?? "", size)
    if (i < value.length - 1) width += tracking
  }
  return width
}

export function drawTracked(
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; size: number; font: PDFFont; color: RGB; tracking?: number; opacity?: number },
) {
  const tracking = opts.tracking ?? 1.6
  let x = opts.x
  for (const char of brochurePrintText(text).toUpperCase()) {
    page.drawText(char, {
      x,
      y: opts.y,
      size: opts.size,
      font: opts.font,
      color: opts.color,
      opacity: opts.opacity,
    })
    x += opts.font.widthOfTextAtSize(char, opts.size) + tracking
  }
  return x
}

export function drawLogo(
  page: PDFPage,
  logo: PDFImage | null,
  box: { x: number; y: number; maxWidth: number; maxHeight: number },
) {
  if (!logo) return
  const scale = Math.min(box.maxHeight / logo.height, box.maxWidth / logo.width)
  page.drawImage(logo, {
    x: box.x,
    y: box.y,
    width: logo.width * scale,
    height: logo.height * scale,
  })
}

function drawCarbonFallback(page: PDFPage) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: BLACK })
  const step = 13
  for (let i = -24; i < 90; i += 1) {
    const x = i * step
    page.drawLine({
      start: { x, y: 0 },
      end: { x: x + PAGE_H * 0.48, y: PAGE_H },
      thickness: 0.45,
      color: WHITE,
      opacity: 0.03,
    })
  }
  page.drawSvgPath(
    polygonPath([
      { x: PAGE_W * 0.74, y: PAGE_H },
      { x: PAGE_W * 0.74 + 11, y: PAGE_H },
      { x: PAGE_W * 0.6 + 11, y: 0 },
      { x: PAGE_W * 0.6, y: 0 },
    ]),
    { color: RED, opacity: 0.9 },
  )
  page.drawSvgPath(
    polygonPath([
      { x: PAGE_W * 0.74 + 18, y: PAGE_H },
      { x: PAGE_W * 0.74 + 20, y: PAGE_H },
      { x: PAGE_W * 0.6 + 20, y: 0 },
      { x: PAGE_W * 0.6 + 18, y: 0 },
    ]),
    { color: WHITE, opacity: 0.18 },
  )
}

export function drawBackground(page: PDFPage, background: PDFImage | null) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: BLACK })
  if (background) {
    drawImageCoverUnclipped(page, background, { x: 0, y: 0, width: PAGE_W, height: PAGE_H })
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: BLACK, opacity: 0.38 })
  } else {
    drawCarbonFallback(page)
  }
}

export function coverSplit() {
  return { topX: PAGE_W * 0.54, botX: PAGE_W * 0.42 }
}

export function coverPhotoPoints() {
  const split = coverSplit()
  return [
    { x: split.topX, y: PAGE_H },
    { x: PAGE_W, y: PAGE_H },
    { x: PAGE_W, y: 0 },
    { x: split.botX, y: 0 },
  ]
}

export function coverTextPanelPoints() {
  const split = coverSplit()
  return [
    { x: 0, y: 0 },
    { x: 0, y: PAGE_H },
    { x: split.topX, y: PAGE_H },
    { x: split.botX, y: 0 },
  ]
}

export function drawDiagonalPhoto(page: PDFPage, photo: PDFImage | undefined, points: Array<{ x: number; y: number }>) {
  if (!photo) {
    page.drawSvgPath(polygonPath(points), { color: BLACK, opacity: 0.55 })
    return
  }
  clipPolygon(page, points)
  drawImageCoverUnclipped(page, photo, {
    x: Math.min(...points.map((p) => p.x)),
    y: Math.min(...points.map((p) => p.y)),
    width: Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
    height: Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)),
  })
  endClip(page)
}

export function strokeDiagonal(page: PDFPage, points: Array<{ x: number; y: number }>) {
  if (points.length < 4) return
  page.drawLine({
    start: points[0]!,
    end: points[3]!,
    thickness: 3,
    color: RED,
  })
}

export function drawPhotoTile(
  page: PDFPage,
  photo: PDFImage | undefined,
  box: { x: number; y: number; width: number; height: number },
) {
  if (!photo) {
    page.drawRectangle({ ...box, color: CHARCOAL })
    return
  }
  drawImageCover(page, photo, box)
}

export function fillPolygon(page: PDFPage, points: Array<{ x: number; y: number }>, color: RGB) {
  page.drawSvgPath(polygonPath(points), { color })
}

/** Shared heading stack so every inner page uses the same kicker / title / red rule rhythm. */
export function drawSectionHeading(
  page: PDFPage,
  fonts: BrochureFonts,
  opts: { x: number; top: number; maxWidth: number; kicker: string; lead: string; accent: string },
): number {
  const { kickerSize, titleSize, kickerToTitle, titleLeading, titleToRule, ruleW, ruleH, ruleToContent } = HEADING
  safeDrawText(page, opts.kicker.toUpperCase(), {
    x: opts.x,
    y: opts.top,
    size: kickerSize,
    font: fonts.condensedMedium,
    color: RED,
  })

  let y = opts.top - kickerToTitle - titleSize
  if (opts.lead) {
    const lead = fitTitle(opts.lead.toUpperCase(), fonts.condensed, opts.maxWidth, titleSize, 22, 3)
    for (const line of lead.lines) {
      safeDrawText(page, line, {
        x: opts.x,
        y,
        size: lead.size,
        font: fonts.condensed,
        color: WHITE,
      })
      y -= lead.size * titleLeading
    }
  }
  if (opts.accent) {
    const accent = fitTitle(opts.accent.toUpperCase(), fonts.condensed, opts.maxWidth, titleSize, 22, 2)
    for (const line of accent.lines) {
      safeDrawText(page, line, {
        x: opts.x,
        y,
        size: accent.size,
        font: fonts.condensed,
        color: RED,
      })
      y -= accent.size * titleLeading
    }
  }

  y -= titleToRule
  page.drawRectangle({ x: opts.x, y: y + 10, width: ruleW, height: ruleH, color: RED })
  return y - ruleToContent
}

export function drawChrome(
  page: PDFPage,
  fonts: BrochureFonts,
  opts: { pageIndex: number; pageCount: number },
) {
  page.drawRectangle({ x: 0, y: 0, width: RAIL, height: PAGE_H, color: RED })
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: FOOTER_H, color: BLACK })
  page.drawRectangle({ x: 0, y: FOOTER_H, width: PAGE_W, height: 2.5, color: RED })

  const pageLabel = `${String(opts.pageIndex).padStart(2, "0")}  /  ${String(opts.pageCount).padStart(2, "0")}`
  const pageWidth = fonts.condensed.widthOfTextAtSize(pageLabel, 10)
  safeDrawText(page, pageLabel, {
    x: PAGE_W - FRAME - pageWidth,
    y: 13,
    size: 10,
    font: fonts.condensed,
    color: RED,
  })
}
