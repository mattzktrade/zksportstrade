import { PDFArray, PDFDocument, PDFName, PDFString, type PDFImage, type PDFPage } from "pdf-lib"
import { brochurePhotoUrls, brochureVenueLine } from "@/lib/brochures/content"
import { embedBrochureFonts, type BrochureFonts } from "@/lib/brochures/fonts"
import {
  GUEST_GUIDE_KICKER,
  guestGuideHeadline,
  matchesOfficialGuestGuide,
  NATIONAL_GALLERY_SINGAPORE_MAP,
  NATIONAL_GALLERY_SINGAPORE_MAPS_URL,
  officialSingaporeVelocityTerraceGuestGuide,
  pageHasContent,
  VELOCITY_TERRACE_LOGO,
  VELOCITY_TERRACE_SY_LOGO,
  VELOCITY_TERRACE_THE_TEAM_LOGO,
  VELOCITY_TERRACE_ZK_LOGO,
} from "@/lib/brochures/guest-guide/content"
import type { GuestGuideContent, GuestGuidePage } from "@/lib/brochures/guest-guide/types"
import {
  drawImageContain,
  drawImageCover,
  embedPublicImage,
  embedRasterImage,
  loadImageBytes,
} from "@/lib/brochures/images"
import { drawBrochureCover } from "@/lib/brochures/pdf"
import {
  BLACK,
  CHARCOAL,
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
  WHITE,
  coverPhotoPoints,
  coverTextPanelPoints,
  drawBackground,
  drawChrome,
  drawDiagonalPhoto,
  drawLogo,
  drawSectionHeading,
  drawTracked,
  fillPolygon,
  safeDrawText,
  strokeDiagonal,
  trackedWidth,
} from "@/lib/brochures/template"
import { brochurePrintText, brochureReadable, wrapText } from "@/lib/brochures/text"
import { BrochureInsufficientImagesError, type BrochureContent } from "@/lib/brochures/types"

const SECTION_TOP = PAGE_H - 40
const PHOTO_BOTTOM = FOOTER_H + 18
const VELOCITY_FOOTER_H = 50
const BODY_SIZE = 12
const BODY_LEAD = 18

function leftTextX() {
  return MARGIN + RAIL + 6
}

function addUriLink(page: PDFPage, box: { x: number; y: number; width: number; height: number }, url: string) {
  const href = url.trim()
  if (!/^https?:\/\//i.test(href) || box.width <= 0 || box.height <= 0) return
  const context = page.doc.context
  const annotRef = context.register(
    context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [box.x, box.y, box.x + box.width, box.y + box.height],
      Border: [0, 0, 0],
      C: [0.976, 0.008, 0.008],
      F: 4,
      A: {
        Type: "Action",
        S: "URI",
        URI: PDFString.of(href),
      },
    }),
  )
  const annotsKey = PDFName.of("Annots")
  const existing = page.node.lookupMaybe(annotsKey, PDFArray)
  if (existing) {
    existing.push(annotRef)
    return
  }
  page.node.set(annotsKey, context.obj([annotRef]))
}

async function embedGuidePhotos(pdf: PDFDocument, content: BrochureContent): Promise<PDFImage[]> {
  const urls = brochurePhotoUrls(content.heroUrl, content.galleryUrls, content.trackMapUrl)
  const photos: PDFImage[] = []
  for (const [index, url] of urls.slice(0, 7).entries()) {
    const bytes = await loadImageBytes(url, index === 0 ? 1600 : 1000)
    if (!bytes) continue
    const image = await embedRasterImage(pdf, bytes)
    if (image) photos.push(image)
  }
  return photos
}

async function embedQrImage(pdf: PDFDocument, path: string | null | undefined): Promise<PDFImage | null> {
  const raw = path?.trim()
  if (!raw) return null
  if (raw.startsWith("/") || raw.startsWith("images/")) {
    const segments = raw.replace(/^\//, "").split("/").filter(Boolean)
    if (segments.length === 0) return null
    return embedPublicImage(pdf, ...segments)
  }
  const bytes = await loadImageBytes(raw, 400, { fit: "contain" })
  if (!bytes) return null
  return embedRasterImage(pdf, bytes)
}

type Cursor = {
  page: PDFPage
  x: number
  y: number
  width: number
}

type VelocityMarks = {
  logo: PDFImage | null
  sy: PDFImage | null
  zk: PDFImage | null
  team: PDFImage | null
}

function drawHeading(page: PDFPage, fonts: BrochureFonts, pageContent: GuestGuidePage, width: number, x = leftTextX()): number {
  const heading = guestGuideHeadline(pageContent)
  return drawSectionHeading(page, fonts, {
    x,
    top: SECTION_TOP,
    maxWidth: width,
    kicker: pageContent.kicker || "Guest guide",
    lead: heading.lead,
    accent: heading.accent,
  })
}

function drawRedHeading(
  page: PDFPage,
  fonts: BrochureFonts,
  text: string,
  x: number,
  y: number,
  size = 11,
) {
  safeDrawText(page, brochurePrintText(text).toUpperCase(), {
    x,
    y,
    size,
    font: fonts.condensed,
    color: RED,
  })
}

function drawPanel(
  page: PDFPage,
  box: { x: number; y: number; width: number; height: number },
) {
  page.drawRectangle({
    ...box,
    color: CHARCOAL,
    opacity: 0.82,
    borderColor: RED,
    borderWidth: 1.1,
  })
}

/** Cover uses the hero. Inner pages take later photos in order and never wrap/reuse. */
export function guestGuidePhotoPlan(photoCount: number): { welcome: number; experience: number } {
  const unused = Math.max(0, photoCount - 1)
  const welcome = Math.min(3, unused)
  const experience = Math.min(3, Math.max(0, unused - welcome))
  return { welcome, experience }
}

function uniqueGuidePhotos(photos: PDFImage[]): { welcome: PDFImage[]; experience: PDFImage[] } {
  const unused = photos.slice(1)
  const plan = guestGuidePhotoPlan(photos.length)
  return {
    welcome: unused.slice(0, plan.welcome),
    experience: unused.slice(plan.welcome, plan.welcome + plan.experience),
  }
}

function emptyVelocityMarks(): VelocityMarks {
  return { logo: null, sy: null, zk: null, team: null }
}

async function embedVelocityMarks(pdf: PDFDocument): Promise<VelocityMarks> {
  const [logo, sy, zk, team] = await Promise.all([
    embedQrImage(pdf, VELOCITY_TERRACE_LOGO),
    embedQrImage(pdf, VELOCITY_TERRACE_SY_LOGO),
    embedQrImage(pdf, VELOCITY_TERRACE_ZK_LOGO),
    embedQrImage(pdf, VELOCITY_TERRACE_THE_TEAM_LOGO),
  ])
  return { logo, sy, zk, team }
}

function drawPartnerLogos(
  page: PDFPage,
  marks: VelocityMarks,
  box: { x: number; y: number; width: number; height: number },
) {
  const items = [
    { logo: marks.sy, boost: 1.86 },
    { logo: marks.zk, boost: 1 },
    { logo: marks.team, boost: 0.8 },
  ].filter((item): item is { logo: PDFImage; boost: number } => Boolean(item.logo))
  if (items.length === 0) return

  const gap = 20
  const sized = items.map((item) => {
    const height = box.height * item.boost
    const width = item.logo.width * (height / item.logo.height)
    return { logo: item.logo, width, height }
  })
  const rawWidth = sized.reduce((sum, item) => sum + item.width, 0) + gap * (sized.length - 1)
  const fit = rawWidth > box.width ? box.width / rawWidth : 1
  const used = rawWidth * fit

  let x = box.x + (box.width - used) / 2
  for (const item of sized) {
    const width = item.width * fit
    const height = item.height * fit
    page.drawImage(item.logo, {
      x,
      y: box.y + (box.height - height) / 2,
      width,
      height,
    })
    x += width + gap * fit
  }
}

function drawVelocityChrome(
  page: PDFPage,
  fonts: BrochureFonts,
  marks: VelocityMarks,
  opts: { pageIndex: number; pageCount: number },
) {
  page.drawRectangle({ x: 0, y: 0, width: RAIL, height: PAGE_H, color: RED })
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: VELOCITY_FOOTER_H, color: BLACK })
  page.drawRectangle({ x: 0, y: VELOCITY_FOOTER_H, width: PAGE_W, height: 2.5, color: RED })

  const pageLabel = `${String(opts.pageIndex).padStart(2, "0")}  /  ${String(opts.pageCount).padStart(2, "0")}`
  const pageWidth = fonts.condensed.widthOfTextAtSize(pageLabel, 10)
  const numberX = PAGE_W - FRAME - pageWidth
  drawPartnerLogos(page, marks, {
    x: 0,
    y: 17,
    width: PAGE_W,
    height: 16,
  })
  safeDrawText(page, pageLabel, {
    x: numberX,
    y: 18,
    size: 10,
    font: fonts.condensed,
    color: RED,
  })
}

function drawVelocityTerraceCover(
  page: PDFPage,
  content: BrochureContent,
  fonts: BrochureFonts,
  photos: PDFImage[],
  marks: VelocityMarks,
) {
  const points = coverPhotoPoints()
  drawDiagonalPhoto(page, photos[0], points)
  fillPolygon(page, coverTextPanelPoints(), BLACK)
  strokeDiagonal(page, points)

  const x = leftTextX()
  const textWidth = PAGE_W * 0.38
  let y = PAGE_H - 70

  safeDrawText(page, GUEST_GUIDE_KICKER.toUpperCase(), {
    x,
    y,
    size: COVER_TYPE.kickerSize,
    font: fonts.condensedMedium,
    color: RED,
  })

  const logoH = 86
  y -= 40 + logoH
  const logoScale = marks.logo ? Math.min(logoH / marks.logo.height, textWidth / marks.logo.width) : 1
  const columnW = marks.logo ? marks.logo.width * logoScale : textWidth
  if (marks.logo) {
    drawLogo(page, marks.logo, { x, y, maxWidth: textWidth, maxHeight: logoH })
  }
  const centerX = x + columnW / 2

  y -= 30
  const presentedSize = 10
  const presentedTracking = 2.2
  const presented = "Presented by"
  drawTracked(page, presented, {
    x: centerX - trackedWidth(presented, fonts.condensedMedium, presentedSize, presentedTracking) / 2,
    y,
    size: presentedSize,
    font: fonts.condensedMedium,
    color: MUTED,
    tracking: presentedTracking,
  })

  const syH = 50
  y -= 16 + syH
  if (marks.sy) {
    const syScale = Math.min(syH / marks.sy.height, columnW / marks.sy.width)
    const syW = marks.sy.width * syScale
    const syDrawn = marks.sy.height * syScale
    page.drawImage(marks.sy, {
      x: centerX - syW / 2,
      y: y + (syH - syDrawn) / 2,
      width: syW,
      height: syDrawn,
    })
  }

  y -= 22
  page.drawRectangle({
    x: centerX - HEADING.ruleW / 2,
    y,
    width: HEADING.ruleW,
    height: HEADING.ruleH,
    color: RED,
  })
  y -= 46

  const eventLine = wrapText(brochurePrintText(content.raceName), fonts.sansMedium, COVER_TYPE.eventSize, columnW)
  for (const line of eventLine.slice(0, 2)) {
    const width = fonts.sansMedium.widthOfTextAtSize(line, COVER_TYPE.eventSize)
    safeDrawText(page, line, {
      x: centerX - width / 2,
      y,
      size: COVER_TYPE.eventSize,
      font: fonts.sansMedium,
      color: WHITE,
    })
    y -= 22
  }

  const venue = brochureVenueLine(content.circuit, content.location, content.raceName)
  if (venue) {
    const venueLines = wrapText(venue, fonts.sans, COVER_TYPE.metaSize, columnW)
    const line = venueLines[0] ?? ""
    const width = fonts.sans.widthOfTextAtSize(line, COVER_TYPE.metaSize)
    safeDrawText(page, line, {
      x: centerX - width / 2,
      y,
      size: COVER_TYPE.metaSize,
      font: fonts.sans,
      color: MUTED,
    })
    y -= 18
  }
  if (content.dateHeadline) {
    const width = fonts.sans.widthOfTextAtSize(content.dateHeadline, COVER_TYPE.metaSize)
    safeDrawText(page, content.dateHeadline, {
      x: centerX - width / 2,
      y,
      size: COVER_TYPE.metaSize,
      font: fonts.sans,
      color: MUTED,
    })
  }
}

export async function generatePackageGuestGuidePdf(
  brochure: BrochureContent,
  guide: GuestGuideContent = officialSingaporeVelocityTerraceGuestGuide(),
  options?: { minPhotos?: number },
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${brochurePrintText(brochure.productName)} · Guest guide`)
  pdf.setAuthor("ZK Sports & Entertainment")
  pdf.setSubject("Guest guide")
  pdf.setCreator("ZK Sports Trade")
  pdf.setProducer("ZK Sports Trade")
  pdf.setKeywords(["ZK Sports", "Guest guide", brochure.productName, brochure.raceName].filter(Boolean))

  const fonts = await embedBrochureFonts(pdf)
  const official = matchesOfficialGuestGuide(brochure)
  const pagesWithCopy = guide.pages.filter(pageHasContent)
  const qrPaths = [...new Set(pagesWithCopy.map((page) => page.qrImagePath?.trim()).filter(Boolean))] as string[]
  const mapPath = official ? closingMap(pagesWithCopy.find((page) => page.key === "closing"), brochure).imagePath : null

  const [background, photos, qrImages, mapImage, marks] = await Promise.all([
    embedPublicImage(pdf, "images", "brochures", "template-bg.png"),
    embedGuidePhotos(pdf, brochure),
    Promise.all(qrPaths.map(async (path) => [path, await embedQrImage(pdf, path)] as const)),
    mapPath ? embedQrImage(pdf, mapPath) : Promise.resolve(null),
    official ? embedVelocityMarks(pdf) : Promise.resolve(emptyVelocityMarks()),
  ])
  const qrByPath = new Map(qrImages)

  const minPhotos = options?.minPhotos ?? 0
  if (minPhotos > 0 && photos.length < minPhotos) {
    throw new BrochureInsufficientImagesError(photos.length, minPhotos)
  }

  const built: PDFPage[] = []
  const addPage = () => {
    const page = pdf.addPage(PAGE)
    drawBackground(page, background)
    built.push(page)
    return page
  }

  const cover = addPage()
  if (official) {
    drawVelocityTerraceCover(cover, brochure, fonts, photos, marks)
  } else {
    drawBrochureCover(cover, brochure, fonts, photos)
  }
  const guidePhotos = uniqueGuidePhotos(photos)

  for (const pageContent of pagesWithCopy) {
    const qr = pageContent.qrImagePath ? qrByPath.get(pageContent.qrImagePath) ?? null : null
    if (pageContent.key === "welcome") {
      drawWelcomePage(pageContent, fonts, addPage(), guidePhotos.welcome)
      continue
    }
    if (pageContent.key === "experience") {
      drawExperiencePage(pageContent, fonts, addPage(), guidePhotos.experience)
      continue
    }
    if (pageContent.key === "arriving") {
      drawArrivingPage(pageContent, fonts, addPage())
      continue
    }
    if (pageContent.key === "ticketHelp") {
      drawSupportPage(pageContent, fonts, addPage())
      continue
    }
    if (pageContent.key === "thingsToKnow") {
      drawThingsToKnowPage(pageContent, fonts, addPage())
      continue
    }
    if (pageContent.key === "closing") {
      if (official) {
        drawVelocityTerraceClosing(pageContent, fonts, addPage(), qr, mapImage, marks, brochure)
      } else {
        drawTemplateClosing(pageContent, fonts, addPage(), qr, brochure)
      }
      continue
    }
    drawContentPage(pageContent, fonts, addPage)
  }

  const pageCount = built.length
  for (const [index, page] of built.entries()) {
    if (official) {
      drawVelocityChrome(page, fonts, marks, { pageIndex: index + 1, pageCount })
    } else {
      drawChrome(page, fonts, { pageIndex: index + 1, pageCount })
    }
  }

  return pdf.save({ useObjectStreams: false })
}

function drawFramedPhoto(
  page: PDFPage,
  photo: PDFImage | undefined,
  box: { x: number; y: number; width: number; height: number },
) {
  page.drawRectangle({
    ...box,
    color: CHARCOAL,
    borderColor: RED,
    borderWidth: 1.8,
  })
  const inset = 5
  const inner = {
    x: box.x + inset,
    y: box.y + inset,
    width: Math.max(1, box.width - inset * 2),
    height: Math.max(1, box.height - inset * 2),
  }
  if (photo) {
    drawImageCover(page, photo, inner)
    return
  }
  page.drawRectangle({ ...inner, color: CHARCOAL })
}

function drawEditorialPhotos(
  page: PDFPage,
  photos: PDFImage[],
  box: { x: number; y: number; width: number; height: number },
  variant: "welcome" | "experience",
) {
  if (photos.length === 0) return
  const gap = 8
  if (photos.length === 1) {
    drawFramedPhoto(page, photos[0], box)
    return
  }

  if (variant === "welcome") {
    const heroH = photos.length >= 3 ? box.height * 0.62 : box.height * 0.58
    const restH = box.height - heroH - gap
    drawFramedPhoto(page, photos[0], {
      x: box.x,
      y: box.y + restH + gap,
      width: box.width,
      height: heroH,
    })
    if (photos.length >= 3) {
      const pairW = (box.width - gap) / 2
      drawFramedPhoto(page, photos[1], { x: box.x, y: box.y, width: pairW, height: restH })
      drawFramedPhoto(page, photos[2], { x: box.x + pairW + gap, y: box.y, width: pairW, height: restH })
      return
    }
    drawFramedPhoto(page, photos[1], { x: box.x, y: box.y, width: box.width, height: restH })
    return
  }

  if (photos.length >= 3) {
    const leftW = box.width * 0.58
    const rightW = box.width - leftW - gap
    const halfH = (box.height - gap) / 2
    drawFramedPhoto(page, photos[0], { x: box.x, y: box.y, width: leftW, height: box.height })
    drawFramedPhoto(page, photos[1], {
      x: box.x + leftW + gap,
      y: box.y + halfH + gap,
      width: rightW,
      height: halfH,
    })
    drawFramedPhoto(page, photos[2], {
      x: box.x + leftW + gap,
      y: box.y,
      width: rightW,
      height: halfH,
    })
    return
  }

  const halfH = (box.height - gap) / 2
  drawFramedPhoto(page, photos[0], { x: box.x, y: box.y + halfH + gap, width: box.width, height: halfH })
  drawFramedPhoto(page, photos[1], { x: box.x, y: box.y, width: box.width, height: halfH })
}

function drawWelcomePage(pageContent: GuestGuidePage, fonts: BrochureFonts, page: PDFPage, photos: PDFImage[]) {
  const x = leftTextX()
  const stack = photos.slice(0, 3)
  const photoW = stack.length ? 252 : 0
  const textWidth = PAGE_W - x - FRAME - (photoW ? photoW + 22 : 0)
  let y = drawHeading(page, fonts, pageContent, textWidth, x)
  if (stack.length) {
    drawEditorialPhotos(
      page,
      stack,
      {
        x: PAGE_W - FRAME - photoW,
        y: PHOTO_BOTTOM + 10,
        width: photoW,
        height: SECTION_TOP - 10 - (PHOTO_BOTTOM + 10),
      },
      "welcome",
    )
  }
  for (const paragraph of pageContent.paragraphs ?? []) {
    if (!paragraph.trim()) continue
    y = drawParagraphBlock({ page, x, y, width: textWidth }, fonts, paragraph, BODY_SIZE, BODY_LEAD)
  }
}

function drawExperiencePage(pageContent: GuestGuidePage, fonts: BrochureFonts, page: PDFPage, photos: PDFImage[]) {
  const x = leftTextX()
  const stack = photos.slice(0, 3)
  const photoW = stack.length ? 336 : 0
  const textWidth = PAGE_W - x - FRAME - (photoW ? photoW + 22 : 0)
  let y = drawHeading(page, fonts, pageContent, textWidth, x)
  if (stack.length) {
    drawEditorialPhotos(
      page,
      stack,
      {
        x: PAGE_W - FRAME - photoW,
        y: PHOTO_BOTTOM + 10,
        width: photoW,
        height: SECTION_TOP - 8 - (PHOTO_BOTTOM + 10),
      },
      "experience",
    )
  }
  if (pageContent.intro) {
    y = drawParagraphBlock({ page, x, y, width: textWidth }, fonts, pageContent.intro, BODY_SIZE, BODY_LEAD)
  }
  y = drawBullets({ page, x, y, width: textWidth }, fonts, pageContent.bullets ?? [])
  for (const note of pageContent.notes ?? []) {
    if (!note.trim()) continue
    y = drawParagraphBlock({ page, x, y, width: textWidth }, fonts, note, 11.5, 16)
  }
}

function drawContentPage(pageContent: GuestGuidePage, fonts: BrochureFonts, addPage: () => PDFPage) {
  const fullWidth = PAGE_W - leftTextX() - FRAME
  const start = addPage()
  let cursor: Cursor = {
    page: start,
    x: leftTextX(),
    y: drawHeading(start, fonts, pageContent, fullWidth),
    width: fullWidth,
  }

  const continuePage = (needed: number) => {
    if (cursor.y - needed >= PHOTO_BOTTOM) return
    const page = addPage()
    cursor = {
      page,
      x: leftTextX(),
      y: drawHeading(page, fonts, pageContent, fullWidth),
      width: fullWidth,
    }
  }

  if (pageContent.intro) {
    continuePage(36)
    cursor.y = drawParagraphBlock(cursor, fonts, pageContent.intro, BODY_SIZE, BODY_LEAD)
  }
  for (const paragraph of pageContent.paragraphs ?? []) {
    if (!paragraph.trim()) continue
    continuePage(28)
    cursor.y = drawParagraphBlock(cursor, fonts, paragraph, BODY_SIZE, BODY_LEAD)
  }
  for (const block of pageContent.dateBlocks ?? []) {
    continuePage(52)
    cursor.y = drawDateBlock(cursor, fonts, block)
  }
  if ((pageContent.bullets ?? []).some((item) => item.trim())) {
    continuePage(28)
    if (pageContent.key === "digitalTicket") {
      drawRedHeading(cursor.page, fonts, "Before arriving, please", cursor.x, cursor.y, 12)
      cursor.y -= 20
    }
    cursor.y = drawBullets(cursor, fonts, pageContent.bullets ?? [])
  }
  for (const section of pageContent.sections ?? []) {
    continuePage(40)
    cursor.y = drawSection(cursor, fonts, section)
  }
  for (const note of pageContent.notes ?? []) {
    if (!note.trim()) continue
    continuePage(24)
    cursor.y = drawParagraphBlock(cursor, fonts, note, 11.5, 16)
  }
}

function drawParagraphBlock(
  cursor: Cursor,
  fonts: BrochureFonts,
  text: string,
  size: number,
  leading: number,
): number {
  let y = cursor.y
  const paragraphs = brochureReadable(text).split(/\n{2,}/)
  for (const paragraph of paragraphs) {
    const lines = wrapText(paragraph, fonts.sans, size, cursor.width)
    for (const line of lines) {
      if (y < PHOTO_BOTTOM) break
      safeDrawText(cursor.page, line, {
        x: cursor.x,
        y,
        size,
        font: fonts.sans,
        color: WHITE,
      })
      y -= leading
    }
    y -= 8
  }
  return y
}

function drawDateBlock(
  cursor: Cursor,
  fonts: BrochureFonts,
  block: { date: string; title: string; body: string; bullets?: string[] },
): number {
  let y = cursor.y
  const date = brochurePrintText(block.date).toUpperCase()
  const title = brochurePrintText(block.title).toUpperCase()
  const heading = [date, title].filter(Boolean).join("  -  ")
  drawRedHeading(cursor.page, fonts, heading, cursor.x, y, 12)
  y -= 18
  if (block.body) {
    y = drawParagraphBlock({ ...cursor, y }, fonts, block.body, 11.5, 16)
  }
  if (block.bullets?.length) {
    y = drawBullets({ ...cursor, y }, fonts, block.bullets)
  }
  return y - 6
}

function drawFactList(
  cursor: Cursor,
  fonts: BrochureFonts,
  facts: Array<{ label: string; value: string }>,
  columns: 1 | 2,
): number {
  const gap = 22
  const colW = columns === 2 ? (cursor.width - gap) / 2 : cursor.width
  const usable = facts.filter((fact) => fact.label.trim() || fact.value.trim())
  const left = columns === 2 ? usable.filter((_, index) => index % 2 === 0) : usable
  const right = columns === 2 ? usable.filter((_, index) => index % 2 === 1) : []

  const drawCol = (items: typeof usable, x: number, startY: number) => {
    let y = startY
    for (const fact of items) {
      if (fact.label) {
        drawRedHeading(cursor.page, fonts, fact.label, x, y, 11)
        y -= 15
      }
      const lines = wrapText(brochureReadable(fact.value), fonts.sans, 11.5, colW)
      for (const line of lines.slice(0, 4)) {
        safeDrawText(cursor.page, line, { x, y, size: 11.5, font: fonts.sans, color: WHITE })
        y -= 16
      }
      y -= 10
    }
    return y
  }

  const leftY = drawCol(left, cursor.x, cursor.y)
  const rightY = right.length ? drawCol(right, cursor.x + colW + gap, cursor.y) : leftY
  return Math.min(leftY, rightY)
}

function journeyStepLines(
  fonts: BrochureFonts,
  step: { title: string; body: string },
  width: number,
  size: number,
  maxLines: number,
) {
  return wrapText(brochureReadable(step.body), fonts.sans, size, Math.max(40, width - 36)).slice(0, maxLines)
}

function journeyStepHeight(lineCount: number, leading: number) {
  return 16 + Math.max(1, lineCount) * leading + 6
}

function drawStep(
  cursor: Cursor,
  fonts: BrochureFonts,
  index: number,
  step: { title: string; body: string },
  options?: { size?: number; leading?: number; maxLines?: number },
): number {
  const size = options?.size ?? 10.5
  const leading = options?.leading ?? 13
  const maxLines = options?.maxLines ?? 3
  const number = String(index).padStart(2, "0")
  safeDrawText(cursor.page, number, {
    x: cursor.x,
    y: cursor.y,
    size: 11,
    font: fonts.condensed,
    color: RED,
  })
  safeDrawText(cursor.page, brochurePrintText(step.title).toUpperCase(), {
    x: cursor.x + 28,
    y: cursor.y,
    size: 11,
    font: fonts.condensed,
    color: WHITE,
  })
  let y = cursor.y - 15
  for (const line of journeyStepLines(fonts, step, cursor.width, size, maxLines)) {
    safeDrawText(cursor.page, line, {
      x: cursor.x + 28,
      y,
      size,
      font: fonts.sans,
      color: MUTED,
    })
    y -= leading
  }
  return y - 6
}

function drawBullets(cursor: Cursor, fonts: BrochureFonts, bullets: string[]): number {
  let y = cursor.y
  for (const bullet of bullets) {
    const text = brochureReadable(bullet)
    if (!text) continue
    cursor.page.drawRectangle({ x: cursor.x, y: y + 4, width: 10, height: 2.2, color: RED })
    const lines = wrapText(text, fonts.sansMedium, 11.5, cursor.width - 20)
    let lineY = y
    for (const line of lines.slice(0, 3)) {
      safeDrawText(cursor.page, line, {
        x: cursor.x + 18,
        y: lineY,
        size: 11.5,
        font: fonts.sansMedium,
        color: WHITE,
      })
      lineY -= 16
    }
    y = lineY - 8
  }
  return y
}

function drawSection(
  cursor: Cursor,
  fonts: BrochureFonts,
  section: { title: string; body: string; bullets?: string[] },
): number {
  let y = cursor.y
  if (section.title) {
    drawRedHeading(cursor.page, fonts, section.title, cursor.x, y, 12)
    y -= 18
  }
  if (section.body) {
    y = drawParagraphBlock({ ...cursor, y }, fonts, section.body, 11.5, 16)
  }
  if (section.bullets?.length) {
    y = drawBullets({ ...cursor, y }, fonts, section.bullets)
  }
  return y - 4
}

function drawArrivingPage(pageContent: GuestGuidePage, fonts: BrochureFonts, page: PDFPage) {
  const x = leftTextX()
  const width = PAGE_W - x - FRAME
  let y = drawHeading(page, fonts, pageContent, width, x)
  const facts = (pageContent.facts ?? []).filter((fact) => fact.label.trim() || fact.value.trim())
  const gap = 10
  const cardW = (width - gap) / 2
  const cardH = 56
  facts.forEach((fact, index) => {
    const col = index % 2
    const row = Math.floor(index / 2)
    const box = {
      x: x + col * (cardW + gap),
      y: y - (row + 1) * cardH - row * gap,
      width: cardW,
      height: cardH,
    }
    drawPanel(page, box)
    drawRedHeading(page, fonts, fact.label, box.x + 12, box.y + box.height - 20, 11)
    const lines = wrapText(brochureReadable(fact.value), fonts.sansMedium, 12, box.width - 24)
    safeDrawText(page, lines[0] ?? "", {
      x: box.x + 12,
      y: box.y + 14,
      size: 12,
      font: fonts.sansMedium,
      color: WHITE,
    })
  })
  if (facts.length) {
    const rows = Math.ceil(facts.length / 2)
    y -= rows * cardH + (rows - 1) * gap + 12
  }

  const steps = pageContent.steps ?? []
  if (!steps.length) return
  const mid = Math.ceil(steps.length / 2)
  const left = steps.slice(0, mid)
  const right = steps.slice(mid)
  const insetX = 18
  const insetTop = 20
  const insetBottom = 16
  const colGap = 22
  const colW = (width - insetX * 2 - colGap) / 2
  const headerH = 28
  const available = y - (FOOTER_H + 8)
  let size = 10.5
  let leading = 13
  let maxLines = 3
  const columnHeight = (items: typeof steps) =>
    items.reduce(
      (sum, step) => sum + journeyStepHeight(journeyStepLines(fonts, step, colW, size, maxLines).length, leading),
      0,
    )
  let needed = insetTop + headerH + Math.max(columnHeight(left), columnHeight(right)) + insetBottom
  if (needed > available) {
    size = 10
    leading = 12
    needed = insetTop + headerH + Math.max(columnHeight(left), columnHeight(right)) + insetBottom
  }
  const boxH = Math.min(needed, available)
  const boxY = y - boxH
  drawPanel(page, { x, y: boxY, width, height: boxH })
  drawRedHeading(page, fonts, "Your arrival journey", x + insetX, y - insetTop, 12)
  const top = y - insetTop - headerH
  const drawCol = (items: typeof steps, colX: number, startIndex: number) => {
    let stepY = top
    for (const [offset, step] of items.entries()) {
      if (stepY < boxY + insetBottom) break
      stepY = drawStep({ page, x: colX, y: stepY, width: colW }, fonts, startIndex + offset, step, {
        size,
        leading,
        maxLines,
      })
    }
  }
  drawCol(left, x + insetX, 1)
  drawCol(right, x + insetX + colW + colGap, mid + 1)
}

function drawSupportPage(pageContent: GuestGuidePage, fonts: BrochureFonts, page: PDFPage) {
  const x = leftTextX()
  const width = PAGE_W - x - FRAME
  let y = drawHeading(page, fonts, pageContent, width, x)
  for (const paragraph of pageContent.paragraphs ?? []) {
    y = drawParagraphBlock({ page, x, y, width }, fonts, paragraph, BODY_SIZE, BODY_LEAD)
  }
  const cards = [
    pageContent.contactName
      ? { label: "On-ground contact", value: pageContent.contactName }
      : null,
    pageContent.contactPhone
      ? { label: "Telephone / WhatsApp", value: pageContent.contactPhone }
      : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item))
  if (cards.length === 0) return
  const gap = 16
  const cardW = Math.min(340, (width - gap * (cards.length - 1)) / cards.length)
  const cardH = 78
  const rowW = cards.length * cardW + (cards.length - 1) * gap
  const startX = x + Math.max(0, (width - rowW) / 2)
  const boxY = Math.max(PHOTO_BOTTOM + 12, y - cardH - 8)
  cards.forEach((card, index) => {
    const box = { x: startX + index * (cardW + gap), y: boxY, width: cardW, height: cardH }
    drawPanel(page, box)
    drawRedHeading(page, fonts, card.label, box.x + 16, box.y + box.height - 24, 11)
    const lines = wrapText(brochurePrintText(card.value), fonts.sansMedium, 14, box.width - 32)
    safeDrawText(page, lines[0] ?? "", {
      x: box.x + 16,
      y: box.y + 22,
      size: 14,
      font: fonts.sansMedium,
      color: WHITE,
    })
  })
}

function drawThingsToKnowPage(pageContent: GuestGuidePage, fonts: BrochureFonts, page: PDFPage) {
  const width = PAGE_W - leftTextX() - FRAME
  const cursor: Cursor = {
    page,
    x: leftTextX(),
    y: drawHeading(page, fonts, pageContent, width),
    width,
  }
  drawFactList(cursor, fonts, pageContent.facts ?? [], 2)
}

function closingMetaValues(pageContent: GuestGuidePage, brochure: BrochureContent): string[] {
  const factValues = (pageContent.facts ?? [])
    .map((fact) => brochurePrintText(fact.value))
    .filter(Boolean)
  if (matchesOfficialGuestGuide(brochure) && !factValues.some((value) => /velocity\s*terrace/i.test(value))) {
    factValues.unshift("Velocity Terrace")
  }
  const product = brochurePrintText(brochure.productName)
  const hasProduct = factValues.some((value) => {
    const left = value.toLowerCase()
    const right = product.toLowerCase()
    return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)))
  })
  return hasProduct ? factValues : [product, ...factValues].filter(Boolean)
}

function closingMetaLines(values: string[]): string[] {
  if (values.length >= 4) {
    return [values.slice(0, 3).join("  ·  "), values.slice(3).join("  ·  ")]
  }
  return values.length ? [values.join("  ·  ")] : []
}

function closingMap(
  pageContent: GuestGuidePage | undefined,
  brochure: BrochureContent,
): { imagePath: string | null; url: string } {
  if (!matchesOfficialGuestGuide(brochure)) return { imagePath: null, url: "" }
  return {
    imagePath: pageContent?.mapImagePath?.trim() || NATIONAL_GALLERY_SINGAPORE_MAP,
    url: pageContent?.mapUrl?.trim() || NATIONAL_GALLERY_SINGAPORE_MAPS_URL,
  }
}

function factValue(pageContent: GuestGuidePage, label: string) {
  const match = (pageContent.facts ?? []).find((fact) => fact.label.trim().toLowerCase() === label.toLowerCase())
  return brochurePrintText(match?.value ?? "")
}

function drawTemplateClosing(
  pageContent: GuestGuidePage,
  fonts: BrochureFonts,
  page: PDFPage,
  qr: PDFImage | null,
  brochure: BrochureContent,
) {
  const x = leftTextX()
  const width = PAGE_W - x - FRAME
  let y = drawHeading(page, fonts, pageContent, width, x)

  for (const line of closingMetaLines(closingMetaValues(pageContent, brochure))) {
    safeDrawText(page, line, { x, y, size: 14, font: fonts.sansMedium, color: WHITE })
    y -= 20
  }
  y -= 22

  const href = pageContent.linkUrl?.trim() ?? ""
  const hasQr = Boolean(qr || pageContent.qrImagePath)
  const rowH = 196
  const rowY = Math.max(PHOTO_BOTTOM + 28, y - rowH)
  drawDiscoverPanel(page, fonts, pageContent, { x, y: rowY, width, height: rowH }, qr, hasQr, href)
}

function drawVelocityTerraceClosing(
  pageContent: GuestGuidePage,
  fonts: BrochureFonts,
  page: PDFPage,
  qr: PDFImage | null,
  map: PDFImage | null,
  _marks: VelocityMarks,
  brochure: BrochureContent,
) {
  const x = leftTextX()
  const width = PAGE_W - x - FRAME
  const headingY = drawHeading(page, fonts, pageContent, width, x)
  const href = pageContent.linkUrl?.trim() ?? ""
  const mapMeta = closingMap(pageContent, brochure)
  const bottom = VELOCITY_FOOTER_H + 18
  const top = headingY
  const colGap = 16
  const leftW = 228
  const rightW = 210
  const mapW = width - leftW - rightW - colGap * 2
  const leftX = x
  const mapX = x + leftW + colGap
  const rightX = mapX + mapW + colGap
  const rowH = top - bottom
  const rowY = bottom

  const details = [
    { label: "Dates", value: factValue(pageContent, "Dates") || brochure.dateHeadline },
    { label: "Time", value: factValue(pageContent, "Hours") },
    { label: "Location", value: factValue(pageContent, "Location") },
  ].filter((item) => item.value)
  let detailY = top - 8
  for (const detail of details) {
    page.drawCircle({
      x: leftX + 6,
      y: detailY + 4,
      size: 5.5,
      borderColor: RED,
      borderWidth: 1.2,
    })
    drawRedHeading(page, fonts, detail.label, leftX + 20, detailY + 6, 11)
    const lines = wrapText(detail.value, fonts.sansMedium, 12, leftW - 24)
    let lineY = detailY - 16
    for (const line of lines.slice(0, 2)) {
      safeDrawText(page, line, { x: leftX + 20, y: lineY, size: 12, font: fonts.sansMedium, color: WHITE })
      lineY -= 16
    }
    detailY = lineY - 18
  }

  const mapPanel = { x: mapX, y: rowY, width: mapW, height: rowH }
  if (mapPanel.height > 80) {
    drawPanel(page, mapPanel)
    drawRedHeading(page, fonts, "Location", mapPanel.x + 14, mapPanel.y + mapPanel.height - 20, 10)
    const view = "VIEW ON MAP"
    const viewW = fonts.condensed.widthOfTextAtSize(view, 9)
    safeDrawText(page, view, {
      x: mapPanel.x + mapPanel.width - 14 - viewW,
      y: mapPanel.y + mapPanel.height - 20,
      size: 9,
      font: fonts.condensed,
      color: MUTED,
    })
    const mapBox = {
      x: mapPanel.x + 8,
      y: mapPanel.y + 8,
      width: mapPanel.width - 16,
      height: mapPanel.height - 36,
    }
    page.drawRectangle({ ...mapBox, color: WHITE })
    if (map) drawImageCover(page, map, mapBox)
    if (mapMeta.url) {
      addUriLink(page, mapBox, mapMeta.url)
      addUriLink(page, {
        x: mapPanel.x + mapPanel.width - 14 - viewW,
        y: mapPanel.y + mapPanel.height - 24,
        width: viewW,
        height: 14,
      }, mapMeta.url)
    }
  }

  const panel = { x: rightX, y: rowY, width: rightW, height: rowH }
  drawPanel(page, panel)
  const pad = 16
  const qrSize = 88
  const qrBox = {
    x: panel.x + (panel.width - qrSize) / 2,
    y: panel.y + panel.height - pad - qrSize - 8,
    width: qrSize,
    height: qrSize,
  }
  page.drawRectangle({ ...qrBox, color: WHITE })
  if (qr) drawImageContain(page, qr, qrBox, 5)
  if (href) addUriLink(page, qrBox, href)

  const copy =
    (pageContent.paragraphs ?? []).find((paragraph) => paragraph.trim()) ??
    "Please scan the QR code or click the link below."
  const copyWidth = panel.width - pad * 2
  const copyLines = wrapText(brochureReadable(copy), fonts.sans, 11, copyWidth).slice(0, 4)
  let copyY = qrBox.y - 20
  for (const line of copyLines) {
    const lineW = fonts.sans.widthOfTextAtSize(line, 11)
    safeDrawText(page, line, {
      x: panel.x + (panel.width - lineW) / 2,
      y: copyY,
      size: 11,
      font: fonts.sans,
      color: WHITE,
    })
    copyY -= 15
  }

  const label = brochurePrintText(pageContent.linkLabel || "Velocity Terrace Singapore").toUpperCase()
  const btnH = 34
  const btnW = panel.width - pad * 2
  const button = { x: panel.x + pad, y: panel.y + pad, width: btnW, height: btnH }
  page.drawRectangle({ ...button, color: RED })
  const labelW = fonts.condensed.widthOfTextAtSize(label, 10)
  safeDrawText(page, label, {
    x: button.x + Math.max(8, (btnW - labelW) / 2),
    y: button.y + 12,
    size: 10,
    font: fonts.condensed,
    color: WHITE,
  })
  if (href) addUriLink(page, button, href)
}

function drawDiscoverPanel(
  page: PDFPage,
  fonts: BrochureFonts,
  pageContent: GuestGuidePage,
  panel: { x: number; y: number; width: number; height: number },
  qr: PDFImage | null,
  hasQr: boolean,
  href: string,
) {
  drawPanel(page, panel)
  const compact = panel.width < 420
  const pad = compact ? 18 : 28
  const qrSize = compact ? 78 : 112
  const qrColW = hasQr ? (compact ? 108 : 248) : 0
  const dividerX = hasQr ? panel.x + panel.width - qrColW : panel.x + panel.width
  const textW = dividerX - panel.x - pad - (hasQr ? 16 : pad)

  if (hasQr && !compact) {
    page.drawRectangle({
      x: dividerX,
      y: panel.y + 28,
      width: 1,
      height: panel.height - 56,
      color: MUTED,
      opacity: 0.35,
    })
  }

  drawRedHeading(page, fonts, "Discover", panel.x + pad, panel.y + panel.height - 32, 12)
  const discoverCopy = (pageContent.paragraphs ?? []).find((paragraph) => paragraph.trim()) ?? ""
  let copyY = panel.y + panel.height - 56
  if (discoverCopy) {
    for (const line of wrapText(brochureReadable(discoverCopy), fonts.sans, 12, textW).slice(0, compact ? 3 : 4)) {
      safeDrawText(page, line, {
        x: panel.x + pad,
        y: copyY,
        size: 12,
        font: fonts.sans,
        color: WHITE,
      })
      copyY -= 17
    }
  }

  const label = brochurePrintText(pageContent.linkLabel || "Open the race page").toUpperCase()
  const btnH = 36
  const btnW = Math.min(
    textW,
    Math.max(compact ? 180 : 240, fonts.condensed.widthOfTextAtSize(label, 12) + fonts.condensed.widthOfTextAtSize(">", 12) + 48),
  )
  const button = { x: panel.x + pad, y: panel.y + 26, width: btnW, height: btnH }
  page.drawRectangle({ ...button, color: RED })
  safeDrawText(page, label, {
    x: button.x + 16,
    y: button.y + 12,
    size: 12,
    font: fonts.condensed,
    color: WHITE,
  })
  safeDrawText(page, ">", {
    x: button.x + btnW - 22,
    y: button.y + 12,
    size: 12,
    font: fonts.condensed,
    color: WHITE,
  })
  if (href) addUriLink(page, button, href)

  if (hasQr) {
    const qrBox = {
      x: dividerX + (qrColW - qrSize) / 2,
      y: panel.y + (panel.height - qrSize) / 2 + (compact ? 4 : 8),
      width: qrSize,
      height: qrSize,
    }
    page.drawRectangle({ ...qrBox, color: WHITE })
    if (qr) drawImageContain(page, qr, qrBox, compact ? 3 : 6)
    if (href) addUriLink(page, qrBox, href)
    if (!compact) {
      const caption = "SCAN TO LEARN MORE"
      const captionWidth = trackedWidth(caption, fonts.condensed, 8, 1.2)
      drawTracked(page, caption, {
        x: dividerX + (qrColW - captionWidth) / 2,
        y: qrBox.y - 18,
        size: 8,
        font: fonts.condensed,
        color: MUTED,
        tracking: 1.2,
      })
    }
  }
}
