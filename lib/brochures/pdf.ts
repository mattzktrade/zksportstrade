import { PDFDocument, type PDFImage, type PDFPage } from "pdf-lib"
import {
  brochureCircuitFacts,
  brochureCircuitHeadline,
  brochurePhotoUrls,
  brochureVenueLine,
  formatBrochureIncludes,
  splitProductHeadline,
} from "@/lib/brochures/content"
import { BrochureInsufficientImagesError, type BrochureContent } from "@/lib/brochures/types"
import { embedBrochureFonts, type BrochureFonts } from "@/lib/brochures/fonts"
import { drawImageContain, embedPublicImage, embedRasterImage, loadImageBytes } from "@/lib/brochures/images"
import {
  BLACK,
  COVER_TYPE,
  FOOTER_H,
  FRAME,
  HEADING,
  MARGIN,
  MUTED,
  PAGE,
  PAGE_H,
  PAGE_W,
  RAIL,
  RED,
  TAGLINE,
  WHITE,
  coverPhotoPoints,
  coverTextPanelPoints,
  drawBackground,
  drawChrome,
  drawDiagonalPhoto,
  drawPhotoTile,
  drawSectionHeading,
  fillPolygon,
  safeDrawText,
  strokeDiagonal,
} from "@/lib/brochures/template"
import { brochurePrintText, brochureReadable, fitTitle, truncateLines, wrapText } from "@/lib/brochures/text"

const SECTION_TOP = PAGE_H - 40
const PHOTO_BOTTOM = FOOTER_H + 16
const TEXT_COL_W = 300
const INCLUDED_PHOTO_X = 372

async function embedPhotos(pdf: PDFDocument, content: BrochureContent): Promise<PDFImage[]> {
  const urls = brochurePhotoUrls(content.heroUrl, content.galleryUrls, content.trackMapUrl)
  const slots = includedPhotoSlots(urls.length)
  const photos: PDFImage[] = []
  for (const [index, url] of urls.slice(0, 1 + slots).entries()) {
    const bytes = await loadImageBytes(url, index === 0 ? 1600 : 1200)
    if (!bytes) continue
    const image = await embedRasterImage(pdf, bytes)
    if (image) photos.push(image)
  }
  return photos
}

async function embedTrackMap(pdf: PDFDocument, content: BrochureContent): Promise<PDFImage | null> {
  const url = content.trackMapUrl?.trim()
  if (!url) return null
  const bytes = await loadImageBytes(url, 1600, { fit: "contain" })
  if (!bytes) return null
  return embedRasterImage(pdf, bytes)
}

function leftTextX() {
  return MARGIN + RAIL + 6
}

/** Same page sequence for every product: cover, what's included, optional track-map details. */
export function brochurePagePlan(hasTrackMap: boolean): Array<"cover" | "included" | "details"> {
  return hasTrackMap ? ["cover", "included", "details"] : ["cover", "included"]
}

/** 5-photo What's Included column when the product has 6+ unique photos; otherwise the 3-photo column. */
export function includedPhotoSlots(totalPhotos: number): 3 | 5 {
  return totalPhotos >= 6 ? 5 : 3
}

function drawCover(page: PDFPage, content: BrochureContent, fonts: BrochureFonts, photos: PDFImage[]) {
  const points = coverPhotoPoints()
  drawDiagonalPhoto(page, photos[0], points)
  fillPolygon(page, coverTextPanelPoints(), BLACK)
  strokeDiagonal(page, points)

  const x = leftTextX()
  const textWidth = PAGE_W * 0.4 - 10
  let y = PAGE_H - 62

  safeDrawText(page, content.eventFamily.toUpperCase(), {
    x,
    y,
    size: COVER_TYPE.kickerSize,
    font: fonts.condensedMedium,
    color: RED,
  })

  const parts = splitProductHeadline(content.productName)
  y -= HEADING.kickerToTitle + COVER_TYPE.titleSize
  if (parts.lead) {
    const lead = fitTitle(parts.lead, fonts.condensed, textWidth, COVER_TYPE.titleSize, COVER_TYPE.titleMin, 3)
    for (const line of lead.lines) {
      safeDrawText(page, line, { x, y, size: lead.size, font: fonts.condensed, color: WHITE })
      y -= lead.size * HEADING.titleLeading
    }
  }
  const accent = fitTitle(parts.accent, fonts.condensed, textWidth, COVER_TYPE.titleSize, COVER_TYPE.titleMin, 2)
  for (const line of accent.lines) {
    safeDrawText(page, line, { x, y, size: accent.size, font: fonts.condensed, color: RED })
    y -= accent.size * HEADING.titleLeading
  }

  y -= HEADING.titleToRule
  page.drawRectangle({ x, y: y + 10, width: HEADING.ruleW, height: HEADING.ruleH, color: RED })
  y -= HEADING.ruleToContent

  const eventLine = wrapText(brochurePrintText(content.raceName), fonts.sansMedium, COVER_TYPE.eventSize, textWidth)
  for (const line of eventLine.slice(0, 2)) {
    safeDrawText(page, line, { x, y, size: COVER_TYPE.eventSize, font: fonts.sansMedium, color: WHITE })
    y -= 22
  }

  const venue = brochureVenueLine(content.circuit, content.location, content.raceName)
  if (venue) {
    y -= 2
    const venueLines = wrapText(venue, fonts.sans, COVER_TYPE.metaSize, textWidth)
    safeDrawText(page, venueLines[0] ?? "", { x, y, size: COVER_TYPE.metaSize, font: fonts.sans, color: MUTED })
    y -= 18
  }
  if (content.dateHeadline) {
    safeDrawText(page, content.dateHeadline, { x, y, size: COVER_TYPE.metaSize, font: fonts.sans, color: MUTED })
  }

  const tag = brochurePrintText(TAGLINE)
  const tagWidth = fonts.sansMedium.widthOfTextAtSize(tag, 9)
  page.drawRectangle({
    x: PAGE_W - 28 - tagWidth - 16,
    y: FOOTER_H + 16,
    width: tagWidth + 16,
    height: 22,
    color: BLACK,
    opacity: 0.62,
  })
  safeDrawText(page, tag, {
    x: PAGE_W - 28 - tagWidth - 8,
    y: FOOTER_H + 23,
    size: 9,
    font: fonts.sansMedium,
    color: WHITE,
  })
}

function drawIncluded(
  page: PDFPage,
  content: BrochureContent,
  fonts: BrochureFonts,
  photos: PDFImage[],
  slots: 3 | 5,
) {
  const x = leftTextX()
  const heading = splitProductHeadline("What's included")

  let y = drawSectionHeading(page, fonts, {
    x,
    top: SECTION_TOP,
    maxWidth: TEXT_COL_W,
    kicker: "The experience",
    lead: heading.lead,
    accent: heading.accent,
  })

  const story = content.description?.trim()
    ? brochureReadable(content.description)
    : brochurePrintText(content.productName)
  const lines = truncateLines(wrapText(story, fonts.sans, 11.5, TEXT_COL_W), 6)
  for (const line of lines) {
    safeDrawText(page, line, { x, y, size: 11.5, font: fonts.sans, color: WHITE })
    y -= 17
  }

  const glance = formatBrochureIncludes(content.includes, 4)
  if (glance.length && y > FOOTER_H + 150) {
    y -= 18
    safeDrawText(page, "AT A GLANCE", {
      x,
      y,
      size: 10,
      font: fonts.condensedMedium,
      color: RED,
    })
    y -= 22
    for (const item of glance) {
      page.drawRectangle({ x, y: y + 4, width: 12, height: 2.4, color: RED })
      const glanceLines = wrapText(brochureReadable(item.title), fonts.sansMedium, 11, TEXT_COL_W - 22)
      let lineY = y
      for (const line of glanceLines.slice(0, 2)) {
        safeDrawText(page, line, {
          x: x + 20,
          y: lineY,
          size: 11,
          font: fonts.sansMedium,
          color: WHITE,
        })
        lineY -= 15
      }
      y = lineY - 8
    }
  }

  drawIncludedPhotos(page, photos, slots)
}

function drawIncludedPhotos(page: PDFPage, photos: PDFImage[], slots: 3 | 5) {
  const photoX = INCLUDED_PHOTO_X
  const photoW = PAGE_W - FRAME - photoX
  const top = SECTION_TOP
  const bottom = PHOTO_BOTTOM
  const gap = 8

  if (slots === 5 && photos.length >= 5) {
    const largeH = (top - bottom - gap * 2) * 0.5
    const gridH = top - bottom - largeH - gap
    const cellH = (gridH - gap) / 2
    const cellW = (photoW - gap) / 2
    drawPhotoTile(page, photos[0], { x: photoX, y: top - largeH, width: photoW, height: largeH })
    const row2Y = bottom + cellH + gap
    drawPhotoTile(page, photos[1], { x: photoX, y: row2Y, width: cellW, height: cellH })
    drawPhotoTile(page, photos[2], { x: photoX + cellW + gap, y: row2Y, width: cellW, height: cellH })
    drawPhotoTile(page, photos[3], { x: photoX, y: bottom, width: cellW, height: cellH })
    drawPhotoTile(page, photos[4], { x: photoX + cellW + gap, y: bottom, width: cellW, height: cellH })
    return
  }

  const stack = photos.slice(0, 3)
  if (stack.length === 0) return
  if (stack.length === 1) {
    drawPhotoTile(page, stack[0], { x: photoX, y: bottom, width: photoW, height: top - bottom })
    return
  }
  if (stack.length === 2) {
    const largeH = (top - bottom - gap) * 0.62
    drawPhotoTile(page, stack[0], { x: photoX, y: top - largeH, width: photoW, height: largeH })
    drawPhotoTile(page, stack[1], {
      x: photoX,
      y: bottom,
      width: photoW,
      height: top - largeH - gap - bottom,
    })
    return
  }
  const largeH = (top - bottom - gap) * 0.62
  const smallH = top - largeH - gap - bottom
  const smallW = (photoW - gap) / 2
  drawPhotoTile(page, stack[0], { x: photoX, y: top - largeH, width: photoW, height: largeH })
  drawPhotoTile(page, stack[1], { x: photoX, y: bottom, width: smallW, height: smallH })
  drawPhotoTile(page, stack[2], { x: photoX + smallW + gap, y: bottom, width: smallW, height: smallH })
}

function drawCircuit(page: PDFPage, content: BrochureContent, fonts: BrochureFonts, map: PDFImage) {
  const x = leftTextX()
  const detailsColW = 236
  const heading = brochureCircuitHeadline()

  let y = drawSectionHeading(page, fonts, {
    x,
    top: SECTION_TOP,
    maxWidth: detailsColW,
    kicker: "The circuit",
    lead: heading.lead,
    accent: heading.accent,
  })

  const facts = brochureCircuitFacts(content)
  const location = facts.find((fact) => fact.label === "Location")?.value
  if (location) {
    const intro = wrapText(`Located in ${location}.`, fonts.sans, 12, detailsColW)
    for (const line of intro.slice(0, 3)) {
      safeDrawText(page, line, { x, y, size: 12, font: fonts.sans, color: WHITE })
      y -= 18
    }
    y -= 10
  }

  for (const fact of facts.filter((item) => item.label !== "Location")) {
    safeDrawText(page, fact.label.toUpperCase(), {
      x,
      y,
      size: 10,
      font: fonts.condensedMedium,
      color: RED,
    })
    y -= 16
    const values = wrapText(fact.value, fonts.sansMedium, 13, detailsColW)
    for (const line of values.slice(0, 2)) {
      safeDrawText(page, line, { x, y, size: 13, font: fonts.sansMedium, color: WHITE })
      y -= 18
    }
    y -= 10
  }

  const border = 3
  const mapX = x + detailsColW + 18
  const mapBox = {
    x: mapX,
    y: PHOTO_BOTTOM + 6,
    width: PAGE_W - 14 - mapX,
    height: PAGE_H - 32 - (PHOTO_BOTTOM + 6),
  }
  const drawn = drawImageContain(page, map, mapBox, border + 3)
  page.drawRectangle({
    x: drawn.x,
    y: drawn.y,
    width: drawn.width,
    height: drawn.height,
    borderColor: RED,
    borderWidth: border,
  })
}

export async function generatePackageBrochurePdf(
  content: BrochureContent,
  options?: { minPhotos?: number },
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${brochurePrintText(content.productName)} · ${brochurePrintText(content.raceName)}`)
  pdf.setAuthor("ZK Sports & Entertainment")
  pdf.setSubject("Hospitality brochure")
  pdf.setCreator("ZK Sports Trade")
  pdf.setProducer("ZK Sports Trade")
  pdf.setKeywords(["ZK Sports", content.productName, content.raceName].filter(Boolean))

  const fonts = await embedBrochureFonts(pdf)
  const [background, photos, trackMap] = await Promise.all([
    embedPublicImage(pdf, "images", "brochures", "template-bg.png"),
    embedPhotos(pdf, content),
    embedTrackMap(pdf, content),
  ])

  const minPhotos = options?.minPhotos ?? 0
  if (minPhotos > 0 && photos.length < minPhotos) {
    throw new BrochureInsufficientImagesError(photos.length, minPhotos)
  }

  const pages = brochurePagePlan(Boolean(trackMap))
  const pageCount = pages.length
  const chrome = (page: PDFPage, index: number) => drawChrome(page, fonts, { pageIndex: index, pageCount })

  for (const [index, kind] of pages.entries()) {
    const page = pdf.addPage(PAGE)
    drawBackground(page, background)
    if (kind === "cover") drawCover(page, content, fonts, photos)
    else if (kind === "included") {
      const totalPhotos = brochurePhotoUrls(content.heroUrl, content.galleryUrls, content.trackMapUrl).length
      drawIncluded(page, content, fonts, photos.slice(1), includedPhotoSlots(totalPhotos))
    }
    else if (trackMap) drawCircuit(page, content, fonts, trackMap)
    chrome(page, index + 1)
  }

  return pdf.save({ useObjectStreams: false })
}
