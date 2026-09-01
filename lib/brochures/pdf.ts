/**
 * First-draft landscape brochure. Matt wants this design revisited before
 * we treat it as a finished sales asset — see .cursor/rules/brochure-design.mdc.
 */
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb, type RGB } from "pdf-lib"
import { BRAND_BLACK, BRAND_RED } from "@/lib/branding"
import { groupBrochureIncludes, splitProductHeadline } from "@/lib/brochures/content"
import { embedBrochureFonts, type BrochureFonts } from "@/lib/brochures/fonts"
import {
  clipPolygon,
  drawImageCoverUnclipped,
  embedLogo,
  embedRasterImage,
  endClip,
  loadImageBytes,
  polygonPath,
} from "@/lib/brochures/images"
import { brochureSafeText, fitTitle, truncateLines, uniqueImageUrls, wrapText } from "@/lib/brochures/text"
import type { BrochureContent } from "@/lib/brochures/types"

const PAGE: [number, number] = [841.89, 595.28]
const PAGE_W = PAGE[0]
const PAGE_H = PAGE[1]
const WHITE = rgb(1, 1, 1)
const MUTED = rgb(0.72, 0.72, 0.72)
const MAX_PHOTOS = 5
const TAGLINE = "EXCLUSIVE.  |  ELEVATED.  |  UNFORGETTABLE."
const LEFT_PAD = 40

function hexToRgb(hex: string): RGB {
  const n = hex.replace("#", "")
  return rgb(
    Number.parseInt(n.slice(0, 2), 16) / 255,
    Number.parseInt(n.slice(2, 4), 16) / 255,
    Number.parseInt(n.slice(4, 6), 16) / 255,
  )
}

const BLACK = hexToRgb(BRAND_BLACK)
const RED = hexToRgb(BRAND_RED)

function safeDrawText(
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; size: number; font: PDFFont; color: RGB },
) {
  if (!text) return
  page.drawText(text, opts)
}

function drawTracked(
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; size: number; font: PDFFont; color: RGB; tracking?: number },
) {
  const tracking = opts.tracking ?? 1.4
  let x = opts.x
  for (const char of brochureSafeText(text).toUpperCase()) {
    if (!char.trim() && char !== " ") continue
    page.drawText(char, { x, y: opts.y, size: opts.size, font: opts.font, color: opts.color })
    x += opts.font.widthOfTextAtSize(char, opts.size) + tracking
  }
  return x
}

function drawLogo(
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

function drawPin(page: PDFPage, x: number, y: number, size = 9) {
  const cx = x + size * 0.42
  const cy = y + size * 0.48
  page.drawCircle({ x: cx, y: cy, size: size * 0.26, color: RED })
  page.drawSvgPath(
    `M ${x + size * 0.16} ${y + size * 0.42} L ${cx} ${y} L ${x + size * 0.68} ${y + size * 0.42} Z`,
    { color: RED },
  )
}

function coverSplit() {
  return {
    topX: PAGE_W * 0.42,
    botX: PAGE_W * 0.33,
  }
}

function storySplit() {
  return {
    topX: PAGE_W * 0.46,
    botX: PAGE_W * 0.34,
  }
}

function leftPanelPoints(topX: number, botX: number) {
  return [
    { x: 0, y: 0 },
    { x: 0, y: PAGE_H },
    { x: topX, y: PAGE_H },
    { x: botX, y: 0 },
  ]
}

function rightPanelPoints(topX: number, botX: number) {
  return [
    { x: topX, y: PAGE_H },
    { x: PAGE_W, y: PAGE_H },
    { x: PAGE_W, y: 0 },
    { x: botX, y: 0 },
  ]
}

function fillPanel(page: PDFPage, points: Array<{ x: number; y: number }>, color: RGB) {
  page.drawSvgPath(polygonPath(points), { color })
}

function strokeDiagonal(page: PDFPage, topX: number, botX: number) {
  page.drawLine({
    start: { x: topX, y: PAGE_H },
    end: { x: botX, y: 0 },
    thickness: 2.1,
    color: RED,
  })
}

function photoOrBlack(
  page: PDFPage,
  photo: PDFImage | undefined,
  points: Array<{ x: number; y: number }>,
) {
  if (!photo) {
    fillPanel(page, points, BLACK)
    return
  }
  clipPolygon(page, points)
  drawImageCoverUnclipped(page, photo, { x: 0, y: 0, width: PAGE_W, height: PAGE_H })
  endClip(page)
}

function parallelogram(
  x: number,
  y: number,
  width: number,
  height: number,
  skew = 14,
) {
  return [
    { x: x + skew, y: y + height },
    { x: x + width, y: y + height },
    { x: x + width - skew, y: y },
    { x: x, y: y },
  ]
}

function drawSkewPhoto(
  page: PDFPage,
  photo: PDFImage,
  box: { x: number; y: number; width: number; height: number },
) {
  const points = parallelogram(box.x, box.y, box.width, box.height)
  clipPolygon(page, points)
  drawImageCoverUnclipped(page, photo, box)
  endClip(page)
  page.drawSvgPath(polygonPath(points), { borderColor: RED, borderWidth: 1.15 })
}

async function embedPhotos(pdf: PDFDocument, content: BrochureContent): Promise<PDFImage[]> {
  const urls = uniqueImageUrls(content.heroUrl, content.galleryUrls).slice(0, MAX_PHOTOS)
  const photos: PDFImage[] = []
  for (const [index, url] of urls.entries()) {
    const bytes = await loadImageBytes(url, index === 0 ? 2000 : 1400)
    if (!bytes) continue
    const image = await embedRasterImage(pdf, bytes)
    if (image) photos.push(image)
  }
  return photos
}

function circuitLine(content: BrochureContent): string {
  return brochureSafeText(content.circuit || content.location || content.placeHeadline).toUpperCase()
}

function drawLocationRow(
  page: PDFPage,
  fonts: BrochureFonts,
  circuit: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  drawPin(page, x, y - 1, 10)
  const text = wrapText(circuit, fonts.condensedMedium, 9, maxWidth - 18)
  safeDrawText(page, text[0] ?? "", {
    x: x + 16,
    y,
    size: 9,
    font: fonts.condensedMedium,
    color: WHITE,
  })
}

function drawCover(page: PDFPage, content: BrochureContent, fonts: BrochureFonts, photos: PDFImage[], whiteLogo: PDFImage | null) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: BLACK })
  const split = coverSplit()
  photoOrBlack(page, photos[0], rightPanelPoints(split.topX, split.botX))
  fillPanel(page, leftPanelPoints(split.topX, split.botX), BLACK)
  strokeDiagonal(page, split.topX, split.botX)

  drawLogo(page, whiteLogo, { x: LEFT_PAD, y: PAGE_H - 52, maxWidth: 148, maxHeight: 26 })

  const textWidth = Math.min(split.botX, split.topX) - LEFT_PAD - 28
  const family = fitTitle(content.eventFamily, fonts.condensed, textWidth, 46, 26, 2)
  const place = fitTitle(content.placeHeadline, fonts.condensed, textWidth, 46, 26, 2)
  let y = 338
  for (const line of family.lines) {
    safeDrawText(page, line, { x: LEFT_PAD, y, size: family.size, font: fonts.condensed, color: WHITE })
    y -= family.size * 0.92
  }
  y -= 4
  for (const line of place.lines) {
    safeDrawText(page, line, { x: LEFT_PAD, y, size: place.size, font: fonts.condensed, color: RED })
    y -= place.size * 0.92
  }

  y -= 10
  page.drawRectangle({ x: LEFT_PAD, y: y + 8, width: 54, height: 1.4, color: RED })
  y -= 8
  drawLocationRow(page, fonts, circuitLine(content), LEFT_PAD, y, textWidth)
  if (content.dateHeadline) {
    y -= 16
    safeDrawText(page, content.dateHeadline, {
      x: LEFT_PAD,
      y,
      size: 9,
      font: fonts.sans,
      color: WHITE,
    })
  }

  const tagWidth = fonts.sansMedium.widthOfTextAtSize(TAGLINE, 7.5)
  safeDrawText(page, TAGLINE, {
    x: PAGE_W - 36 - tagWidth,
    y: 24,
    size: 7.5,
    font: fonts.sansMedium,
    color: WHITE,
  })
}

function drawStory(page: PDFPage, content: BrochureContent, fonts: BrochureFonts, photo: PDFImage | undefined, whiteLogo: PDFImage | null) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: BLACK })
  const split = storySplit()
  photoOrBlack(page, photo, rightPanelPoints(split.topX, split.botX))
  fillPanel(page, leftPanelPoints(split.topX, split.botX), BLACK)
  strokeDiagonal(page, split.topX, split.botX)
  drawLogo(page, whiteLogo, { x: LEFT_PAD, y: PAGE_H - 52, maxWidth: 132, maxHeight: 22 })

  const textWidth = Math.min(split.botX, split.topX) - LEFT_PAD - 24
  const parts = splitProductHeadline(content.productName)
  let y = 430
  if (parts.lead) {
    const lead = fitTitle(parts.lead, fonts.condensed, textWidth, 36, 20, 3)
    for (const line of lead.lines) {
      safeDrawText(page, line, { x: LEFT_PAD, y, size: lead.size, font: fonts.condensed, color: WHITE })
      y -= lead.size * 0.9
    }
    y -= 2
  }
  const accent = fitTitle(parts.accent, fonts.condensed, textWidth, 36, 20, 2)
  for (const line of accent.lines) {
    safeDrawText(page, line, { x: LEFT_PAD, y, size: accent.size, font: fonts.condensed, color: RED })
    y -= accent.size * 0.9
  }

  y -= 18
  const body = content.description?.trim()
    ? content.description
    : `${content.productName} at ${content.raceName}. An exclusive ZK hospitality experience.`
  const lines = truncateLines(wrapText(body, fonts.sans, 10, textWidth), 10)
  for (const line of lines) {
    safeDrawText(page, line, { x: LEFT_PAD, y, size: 10, font: fonts.sans, color: WHITE })
    y -= 14.5
  }

  y -= 12
  page.drawRectangle({ x: LEFT_PAD, y: y + 8, width: 48, height: 1.3, color: RED })
  y -= 6
  drawLocationRow(page, fonts, circuitLine(content), LEFT_PAD, y, textWidth)
}

function drawIncludes(
  page: PDFPage,
  content: BrochureContent,
  fonts: BrochureFonts,
  photos: PDFImage[],
  whiteLogo: PDFImage | null,
) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: BLACK })
  drawLogo(page, whiteLogo, { x: LEFT_PAD, y: PAGE_H - 48, maxWidth: 120, maxHeight: 20 })

  const groups = groupBrochureIncludes(content.includes)
  const hasPhotos = photos.length > 0
  const leftWidth = hasPhotos ? PAGE_W * 0.28 : PAGE_W * 0.34
  const photoX = PAGE_W * 0.3
  const photoW = PAGE_W * 0.2
  const listX = hasPhotos ? PAGE_W * 0.54 : PAGE_W * 0.4
  const listW = PAGE_W - listX - 36

  page.drawLine({
    start: { x: leftWidth + 10, y: PAGE_H - 36 },
    end: { x: leftWidth - 8, y: 28 },
    thickness: 1.4,
    color: RED,
  })

  let y = PAGE_H - 88
  const kicker = brochureSafeText(content.productName).toUpperCase()
  drawTracked(page, kicker.slice(0, 42), {
    x: LEFT_PAD,
    y,
    size: 8,
    font: fonts.condensedMedium,
    color: RED,
    tracking: 1.8,
  })
  y -= 36
  safeDrawText(page, "WHAT'S", {
    x: LEFT_PAD,
    y,
    size: 30,
    font: fonts.condensed,
    color: WHITE,
  })
  y -= 30
  safeDrawText(page, "INCLUDED", {
    x: LEFT_PAD,
    y,
    size: 30,
    font: fonts.condensed,
    color: WHITE,
  })
  y -= 18
  page.drawRectangle({ x: LEFT_PAD, y: y + 10, width: 46, height: 1.3, color: RED })
  y -= 8
  if (content.description) {
    const intro = truncateLines(wrapText(content.description, fonts.sans, 8.5, leftWidth - 22), 8)
    for (const line of intro) {
      safeDrawText(page, line, { x: LEFT_PAD, y, size: 8.5, font: fonts.sans, color: MUTED })
      y -= 12.2
    }
  }

  if (hasPhotos) {
    const count = Math.min(photos.length, Math.max(groups.length, 1), 4)
    const gap = 10
    const available = PAGE_H - 72
    const height = Math.min(118, (available - gap * (count - 1)) / count)
    let photoY = PAGE_H - 48 - height
    for (let i = 0; i < count; i += 1) {
      const photo = photos[i]
      if (photo) {
        drawSkewPhoto(page, photo, { x: photoX, y: photoY, width: photoW, height })
      }
      photoY -= height + gap
    }
  }

  if (groups.length === 0) {
    safeDrawText(page, "Inclusions will be confirmed with your ZK specialist.", {
      x: listX,
      y: PAGE_H - 120,
      size: 10,
      font: fonts.sans,
      color: WHITE,
    })
    return
  }

  const blockGap = 16
  const usable = PAGE_H - 80
  const blockH = Math.min(120, (usable - blockGap * (groups.length - 1)) / groups.length)
  let blockY = PAGE_H - 52
  for (const group of groups) {
    const top = blockY
    safeDrawText(page, group.index, {
      x: listX,
      y: top - 22,
      size: 20,
      font: fonts.condensed,
      color: RED,
    })
    const titleLines = wrapText(group.title.toUpperCase(), fonts.condensed, 11, listW - 48)
    let textY = top - 18
    for (const line of titleLines.slice(0, 2)) {
      safeDrawText(page, line, {
        x: listX + 46,
        y: textY,
        size: 11,
        font: fonts.condensed,
        color: WHITE,
      })
      textY -= 13
    }
    for (const bullet of group.bullets.slice(0, 3)) {
      const wrapped = wrapText(bullet, fonts.sans, 8.5, listW - 58)
      for (const line of wrapped.slice(0, 2)) {
        safeDrawText(page, line, {
          x: listX + 46,
          y: textY,
          size: 8.5,
          font: fonts.sans,
          color: MUTED,
        })
        textY -= 11.5
      }
    }
    page.drawRectangle({
      x: listX,
      y: top - blockH + 6,
      width: listW,
      height: 0.8,
      color: RED,
    })
    blockY -= blockH + blockGap
  }
}

export async function generatePackageBrochurePdf(content: BrochureContent): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${brochureSafeText(content.productName)} · ${brochureSafeText(content.raceName)}`)
  pdf.setAuthor("ZK Sports & Entertainment")
  pdf.setSubject("Hospitality brochure")
  pdf.setCreator("ZK Sports Trade")
  pdf.setProducer("ZK Sports Trade")
  pdf.setKeywords(["ZK Sports", content.productName, content.raceName].filter(Boolean))

  const fonts = await embedBrochureFonts(pdf)
  const [whiteLogo, photos] = await Promise.all([
    embedLogo(pdf, "ZK white logo.png"),
    embedPhotos(pdf, content),
  ])

  const cover = pdf.addPage(PAGE)
  drawCover(cover, content, fonts, photos, whiteLogo)

  const story = pdf.addPage(PAGE)
  drawStory(story, content, fonts, photos[1] ?? photos[0], whiteLogo)

  if (content.includes.length > 0 || photos.length > 1) {
    const included = pdf.addPage(PAGE)
    const includePhotos = photos.length > 1 ? photos.slice(1) : photos
    drawIncludes(included, content, fonts, includePhotos, whiteLogo)
  }

  return pdf.save()
}
