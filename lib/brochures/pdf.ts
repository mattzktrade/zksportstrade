import { PDFDocument, type PDFImage, type PDFPage } from "pdf-lib"
import {
  brochureCircuitFacts,
  brochureCircuitHeadline,
  brochurePhotoUrls,
  brochureVenueLine,
  formatBrochureIncludes,
  coverAccentSharesLine,
  coverTitleStack,
  splitProductHeadline,
  type BrochureIncludeItem,
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
import { brochurePrintText, brochureReadable, fitTitle, wrapText } from "@/lib/brochures/text"
import {
  drawMarsaBoxClosing,
  drawMarsaBoxIndex,
  drawMarsaBoxIntro,
  embedMarsaBoxFrontPhotos,
  isMarsaBoxBrochure,
} from "@/lib/brochures/marsa-box-front"

const SECTION_TOP = PAGE_H - 40
const PHOTO_BOTTOM = FOOTER_H + 16
const TEXT_BOTTOM = FOOTER_H + 20
const TEXT_COL_W = 300
const INCLUDED_PHOTO_X = 372
const DESC_SIZE = 12
const DESC_LEADING = 18
const DESC_GAP = 12
const GLANCE_SIZE = 11
const GLANCE_LEADING = 15
const GLANCE_GAP = 8
const INNER_PHOTOS = 3

export type BrochurePageKind = "cover" | "experience" | "included" | "details"

async function embedPhotos(pdf: PDFDocument, content: BrochureContent): Promise<PDFImage[]> {
  const urls = brochurePhotoUrls(content.heroUrl, content.galleryUrls, content.trackMapUrl)
  const photos: PDFImage[] = []
  for (const [index, url] of urls.slice(0, 1 + INNER_PHOTOS * 2).entries()) {
    const bytes = await loadImageBytes(url, 2400)
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

/** Cover, the experience, what's included, then the track map when one exists. */
export function brochurePagePlan(hasTrackMap: boolean): BrochurePageKind[] {
  return hasTrackMap ? ["cover", "experience", "included", "details"] : ["cover", "experience", "included"]
}

/** 5-photo What's Included column when the product has 6+ unique photos; otherwise the 3-photo column. */
export function includedPhotoSlots(totalPhotos: number): 3 | 5 {
  return totalPhotos >= 6 ? 5 : 3
}

/** Cover shared by the sales brochure and the guest guide. */
export function drawBrochureCover(page: PDFPage, content: BrochureContent, fonts: BrochureFonts, photos: PDFImage[]) {
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

  const stack = coverTitleStack(content.productName)
  let titleSize = COVER_TYPE.titleSize
  while (
    titleSize > COVER_TYPE.titleMin &&
    stack.lines.some((line) => fonts.condensed.widthOfTextAtSize(line, titleSize) > textWidth)
  ) {
    titleSize -= 1
  }
  y -= HEADING.kickerToTitle + titleSize
  stack.lines.forEach((line, index) => {
    const sharedAccent = stack.accentLine < 0 && index === stack.lines.length - 1 && coverAccentSharesLine(line.split(/\s+/).at(-1) ?? "")
    if (sharedAccent) {
      const accent = line.split(/\s+/).at(-1) ?? ""
      const white = line.slice(0, line.length - accent.length).trimEnd()
      safeDrawText(page, white, { x, y, size: titleSize, font: fonts.condensed, color: WHITE })
      const accentX = x + fonts.condensed.widthOfTextAtSize(`${white} `, titleSize)
      safeDrawText(page, accent, { x: accentX, y, size: titleSize, font: fonts.condensed, color: RED })
    } else {
      safeDrawText(page, line, {
        x,
        y,
        size: titleSize,
        font: fonts.condensed,
        color: index === stack.accentLine ? RED : WHITE,
      })
    }
    y -= titleSize * HEADING.titleLeading
  })

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

function includedBodyTop(fonts: BrochureFonts, maxWidth: number): number {
  const heading = splitProductHeadline("What's included")
  const { kickerToTitle, titleSize, titleLeading, titleToRule, ruleToContent } = HEADING
  let y = SECTION_TOP - kickerToTitle - titleSize
  if (heading.lead) {
    const lead = fitTitle(heading.lead, fonts.condensed, maxWidth, titleSize, 22, 3)
    y -= lead.lines.length * lead.size * titleLeading
  }
  if (heading.accent) {
    const accent = fitTitle(heading.accent, fonts.condensed, maxWidth, titleSize, 22, 2)
    y -= accent.lines.length * accent.size * titleLeading
  }
  return y - titleToRule - ruleToContent
}

function inclusionText(item: BrochureIncludeItem): string {
  const title = brochureReadable(item.title)
  return item.detail ? `${title}: ${brochureReadable(item.detail)}` : title
}

const DANGLING_WORD = /^(and|or|the|a|an|of|to|with|from|for|in|on|at|by|into|over|&)$/i

/** Keep a bullet to two lines, ending on a finished phrase rather than "and..." or "the...". */
function bulletLines(item: BrochureIncludeItem, fonts: BrochureFonts, width: number): string[] {
  const maxWidth = width - 22
  const lines = wrapText(inclusionText(item), fonts.sansMedium, GLANCE_SIZE, maxWidth)
  if (lines.length <= 2) return lines
  let words = lines.slice(0, 2).join(" ").split(/\s+/).filter(Boolean)
  const clause = words.join(" ")
  const commaAt = clause.lastIndexOf(",")
  if (commaAt >= 24) words = clause.slice(0, commaAt).split(/\s+/).filter(Boolean)
  while (words.length > 3 && DANGLING_WORD.test(words[words.length - 1] ?? "")) words.pop()
  return wrapText(words.join(" ").replace(/[.,;:\s-]+$/, ""), fonts.sansMedium, GLANCE_SIZE, maxWidth).slice(0, 2)
}

function bulletFits(y: number, lineCount: number): boolean {
  return y - (lineCount - 1) * GLANCE_LEADING >= TEXT_BOTTOM
}

function takeBullets(
  items: BrochureIncludeItem[],
  fonts: BrochureFonts,
  y: number,
  width: number,
): number {
  let cursor = y
  let count = 0
  for (const item of items) {
    const lines = bulletLines(item, fonts, width)
    if (!bulletFits(cursor, lines.length)) break
    cursor -= lines.length * GLANCE_LEADING + GLANCE_GAP
    count += 1
  }
  return count
}

function brochureSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length ? parts : [text.trim()].filter(Boolean)
}

function wrapSentences(sentences: string[], fonts: BrochureFonts, width: number): string[][] {
  return sentences
    .map((sentence) => wrapText(sentence, fonts.sans, DESC_SIZE, width))
    .filter((lines) => lines.some(Boolean))
}

function takeParagraphs(paragraphs: string[][], y: number, bottom: number): { taken: string[][]; rest: string[][] } {
  const taken: string[][] = []
  let cursor = y
  for (const paragraph of paragraphs) {
    const gap = taken.length ? DESC_GAP : 0
    const height = gap + paragraph.length * DESC_LEADING
    if (cursor - height < bottom) break
    taken.push(paragraph)
    cursor -= height
  }
  return { taken, rest: paragraphs.slice(taken.length) }
}

function fitParagraphs(paragraphs: string[][], y: number, bottom: number): string[][] {
  return takeParagraphs(paragraphs, y, bottom).taken
}

/** Description sentences that fit on The Experience page. */
export function planExperienceParagraphs(
  content: BrochureContent,
  fonts: BrochureFonts,
  width = TEXT_COL_W,
): string[][] {
  const story = content.description?.trim()
    ? brochureReadable(content.description)
    : brochurePrintText(content.productName)
  const paragraphs = wrapSentences(brochureSentences(story), fonts, width)
  return fitParagraphs(paragraphs, includedBodyTop(fonts, width), TEXT_BOTTOM)
}

/** Inclusion lines that fit on the What's Included page. Long lines are shortened to two. */
export function planIncludedItems(
  content: BrochureContent,
  fonts: BrochureFonts,
  width = TEXT_COL_W,
): BrochureIncludeItem[] {
  const items = formatBrochureIncludes(content.includes, Math.max(content.includes.length, 1))
  const count = takeBullets(items, fonts, includedBodyTop(fonts, width), width)
  return items.slice(0, count || (items.length ? 1 : 0))
}

/** Cover keeps the first photo. The next photos are split across the two inner pages, without repeats. */
export function splitInnerPhotos<T>(photos: T[]): { experience: T[]; included: T[] } {
  const pool = photos.slice(1)
  if (pool.length <= 1) return { experience: pool, included: [] }
  const experienceCount = Math.min(INNER_PHOTOS, Math.ceil(pool.length / 2))
  return {
    experience: pool.slice(0, experienceCount),
    included: pool.slice(experienceCount, experienceCount + INNER_PHOTOS),
  }
}

function drawSpreadHeading(
  page: PDFPage,
  fonts: BrochureFonts,
  title: string,
  kicker: string,
  maxWidth: number,
): number {
  const heading = splitProductHeadline(title)
  return drawSectionHeading(page, fonts, {
    x: leftTextX(),
    top: SECTION_TOP,
    maxWidth,
    kicker,
    lead: heading.lead,
    accent: heading.accent,
  })
}

function columnWidth(photoCount: number): number {
  return photoCount > 0 ? TEXT_COL_W : PAGE_W - leftTextX() - FRAME
}

function drawExperience(page: PDFPage, content: BrochureContent, fonts: BrochureFonts, photos: PDFImage[]) {
  const x = leftTextX()
  const width = columnWidth(photos.length)
  let y = drawSpreadHeading(page, fonts, "The experience", content.eventFamily, width)
  planExperienceParagraphs(content, fonts, width).forEach((paragraph, index) => {
    if (index > 0) y -= DESC_GAP
    for (const line of paragraph) {
      safeDrawText(page, line, { x, y, size: DESC_SIZE, font: fonts.sans, color: WHITE })
      y -= DESC_LEADING
    }
  })
  if (photos.length) drawIncludedPhotos(page, photos, 3)
}

function drawIncluded(page: PDFPage, content: BrochureContent, fonts: BrochureFonts, photos: PDFImage[]) {
  const x = leftTextX()
  const width = columnWidth(photos.length)
  let y = drawSpreadHeading(page, fonts, "What's included", content.eventFamily, width)
  for (const item of planIncludedItems(content, fonts, width)) {
    page.drawRectangle({ x, y: y + 4, width: 12, height: 2.4, color: RED })
    let lineY = y
    for (const line of bulletLines(item, fonts, width)) {
      safeDrawText(page, line, {
        x: x + 20,
        y: lineY,
        size: GLANCE_SIZE,
        font: fonts.sansMedium,
        color: WHITE,
      })
      lineY -= GLANCE_LEADING
    }
    y = lineY - GLANCE_GAP
  }
  if (photos.length) drawIncludedPhotos(page, photos, 3)
}

function drawFramedPhoto(
  page: PDFPage,
  photo: PDFImage | undefined,
  box: { x: number; y: number; width: number; height: number },
) {
  const border = 2.5
  drawPhotoTile(page, photo, {
    x: box.x + border,
    y: box.y + border,
    width: box.width - border * 2,
    height: box.height - border * 2,
  })
  page.drawRectangle({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    borderColor: RED,
    borderWidth: border,
  })
}

function drawIncludedPhotos(page: PDFPage, photos: PDFImage[], slots: 3 | 5) {
  const photoX = INCLUDED_PHOTO_X + 6
  const photoW = PAGE_W - FRAME - 8 - photoX
  const top = SECTION_TOP - 6
  const bottom = PHOTO_BOTTOM + 8
  const gap = 14

  if (slots === 5 && photos.length >= 5) {
    const largeH = (top - bottom - gap * 2) * 0.5
    const gridH = top - bottom - largeH - gap
    const cellH = (gridH - gap) / 2
    const cellW = (photoW - gap) / 2
    drawFramedPhoto(page, photos[0], { x: photoX, y: top - largeH, width: photoW, height: largeH })
    const row2Y = bottom + cellH + gap
    drawFramedPhoto(page, photos[1], { x: photoX, y: row2Y, width: cellW, height: cellH })
    drawFramedPhoto(page, photos[2], { x: photoX + cellW + gap, y: row2Y, width: cellW, height: cellH })
    drawFramedPhoto(page, photos[3], { x: photoX, y: bottom, width: cellW, height: cellH })
    drawFramedPhoto(page, photos[4], { x: photoX + cellW + gap, y: bottom, width: cellW, height: cellH })
    return
  }

  const stack = photos.slice(0, 3)
  if (stack.length === 0) return
  if (stack.length === 1) {
    drawFramedPhoto(page, stack[0], { x: photoX, y: bottom, width: photoW, height: top - bottom })
    return
  }
  if (stack.length === 2) {
    const height = (top - bottom - gap) / 2
    drawFramedPhoto(page, stack[0], { x: photoX, y: top - height, width: photoW, height })
    drawFramedPhoto(page, stack[1], { x: photoX, y: bottom, width: photoW, height })
    return
  }
  const largeH = (top - bottom - gap * 2) * 0.56
  const smallH = top - largeH - gap - bottom
  const smallW = (photoW - gap) / 2
  drawFramedPhoto(page, stack[0], { x: photoX, y: top - largeH, width: photoW, height: largeH })
  drawFramedPhoto(page, stack[1], { x: photoX, y: bottom, width: smallW, height: smallH })
  drawFramedPhoto(page, stack[2], { x: photoX + smallW + gap, y: bottom, width: smallW, height: smallH })
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

  for (const fact of facts) {
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

  const marsaFront = isMarsaBoxBrochure(content.productName)
  const frontPhotos = marsaFront ? await embedMarsaBoxFrontPhotos(pdf) : null
  const pages = [
    ...(marsaFront ? (["intro", "index"] as const) : []),
    ...brochurePagePlan(Boolean(trackMap)),
    ...(marsaFront ? (["closing"] as const) : []),
  ]
  const pageCount = pages.length
  const chrome = (page: PDFPage, index: number) => drawChrome(page, fonts, { pageIndex: index, pageCount })

  for (const [index, kind] of pages.entries()) {
    const page = pdf.addPage(PAGE)
    drawBackground(page, background)
    if (kind === "intro") drawMarsaBoxIntro(page, fonts, frontPhotos?.intro ?? null, frontPhotos?.logo ?? null)
    else if (kind === "index") drawMarsaBoxIndex(page, fonts, frontPhotos?.badges ?? null)
    else if (kind === "closing") drawMarsaBoxClosing(page, fonts, frontPhotos?.logo ?? null)
    else if (kind === "cover") drawBrochureCover(page, content, fonts, photos)
    else if (kind === "experience") drawExperience(page, content, fonts, splitInnerPhotos(photos).experience)
    else if (kind === "included") drawIncluded(page, content, fonts, splitInnerPhotos(photos).included)
    else if (trackMap) drawCircuit(page, content, fonts, trackMap)
    chrome(page, index + 1)
  }

  return pdf.save({ useObjectStreams: false })
}
