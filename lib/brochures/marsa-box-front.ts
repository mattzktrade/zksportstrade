import type { PDFDocument, PDFImage, PDFPage } from "pdf-lib"
import type { BrochureFonts } from "@/lib/brochures/fonts"
import { embedPublicImage } from "@/lib/brochures/images"
import { wrapText } from "@/lib/brochures/text"
import {
  BLACK,
  FOOTER_H,
  MARGIN,
  MUTED,
  PAGE_H,
  PAGE_W,
  RAIL,
  RED,
  WHITE,
  coverPhotoPoints,
  coverTextPanelPoints,
  drawDiagonalPhoto,
  drawSectionHeading,
  fillPolygon,
  safeDrawText,
  strokeDiagonal,
} from "@/lib/brochures/template"

/** Temporary Marsa Box front pages. Remove once that brochure has been exported. */
export function isMarsaBoxBrochure(productName: string): boolean {
  return /marsa\s*box/i.test(productName)
}

const INDEX_ENTRIES = [
  ["03 – 06", "Marsa Box"],
  ["07 – 10", "Skybridge Terrace"],
  ["11 – 14", "Velocity Terrace"],
  ["15 – 18", "Paddock Club"],
  ["19 – 22", "Club 58"],
  ["23 – 26", "Marina Views Brunch"],
  ["27 – 30", "South Club"],
  ["31 – 34", "South Grandstand"],
  ["35 – 38", "North Grandstand"],
  ["39 – 42", "West Grandstand"],
] as const

const ABOUT = [
  "ZK Sports & Entertainment is an international sports agency specialising in premium hospitality, sports travel and unforgettable live experiences across the world's leading sporting events.",
  "As a Formula 1 Paddock Club Authorised Distributor and Yas Marina Circuit Official On-Seller, we provide trusted access, expert support and seamless delivery for clients seeking exceptional race-weekend experiences.",
]

export async function embedMarsaBoxFrontPhotos(pdf: PDFDocument): Promise<{
  intro: PDFImage | null
  logo: PDFImage | null
  badges: PDFImage | null
}> {
  const [intro, logo, badges] = await Promise.all([
    embedPublicImage(pdf, "images", "brochures", "marsa-box-intro.jpg"),
    embedPublicImage(pdf, "images", "brochures", "marsa-box-zk-logo-transparent.png"),
    embedPublicImage(pdf, "images", "brochures", "marsa-box-badges-transparent.png"),
  ])
  return { intro, logo, badges }
}

function textX() {
  return MARGIN + RAIL + 8
}

export function drawMarsaBoxIntro(
  page: PDFPage,
  fonts: BrochureFonts,
  photo: PDFImage | null,
  logo: PDFImage | null,
) {
  const points = coverPhotoPoints()
  if (photo) drawDiagonalPhoto(page, photo, points)
  fillPolygon(page, coverTextPanelPoints(), BLACK)
  strokeDiagonal(page, points)

  const x = textX()
  let y = PAGE_H - 34

  if (logo) {
    const logoW = 300
    const logoH = logoW * (logo.height / logo.width)
    y -= logoH
    // The supplied PNG has transparent padding; offset it so its visible edge aligns with the copy.
    page.drawImage(logo, { x: x - 16, y, width: logoW, height: logoH })
    y -= 60
  }

  safeDrawText(page, "FORMULA 1", { x, y, size: 42, font: fonts.condensed, color: WHITE })
  y -= 46
  safeDrawText(page, "ABU DHABI", { x, y, size: 42, font: fonts.condensed, color: RED })
  y -= 22
  page.drawRectangle({ x, y, width: 72, height: 4, color: RED })
  y -= 28
  safeDrawText(page, "YAS MARINA CIRCUIT", { x, y, size: 16, font: fonts.sansMedium, color: WHITE })
  y -= 24
  safeDrawText(page, "4 TO 6 DECEMBER 2026", { x, y, size: 14, font: fonts.sans, color: MUTED })

}

export function drawMarsaBoxIndex(page: PDFPage, fonts: BrochureFonts, badges: PDFImage | null) {
  const x = textX()
  const columnW = 390
  let y = drawSectionHeading(page, fonts, {
    x,
    top: PAGE_H - 40,
    maxWidth: columnW,
    kicker: "INTRODUCTION",
    lead: "ZK SPORTS &",
    accent: "ENTERTAINMENT",
  })

  for (const paragraph of ABOUT) {
    const lines = wrapText(paragraph, fonts.sans, 12, columnW)
    for (const line of lines) {
      safeDrawText(page, line, { x, y, size: 12, font: fonts.sans, color: MUTED })
      y -= 16
    }
    y -= 12
  }

  if (badges) {
    y -= 4
    const badgeW = 290
    const badgeH = badgeW * (badges.height / badges.width)
    y -= badgeH
    page.drawImage(badges, { x, y, width: badgeW, height: badgeH })
  }

  const boxX = 472
  const boxW = PAGE_W - MARGIN - boxX
  const boxH = 468
  const boxY = FOOTER_H + (PAGE_H - FOOTER_H - boxH) / 2
  page.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, color: BLACK, opacity: 0.82 })
  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: boxW,
    height: boxH,
    borderColor: RED,
    borderWidth: 1.5,
  })
  page.drawRectangle({ x: boxX, y: boxY + boxH - 5, width: boxW, height: 5, color: RED })

  let listY = boxY + boxH - 44
  safeDrawText(page, "CONTENTS", {
    x: boxX + 22,
    y: listY,
    size: 25,
    font: fonts.condensed,
    color: WHITE,
  })
  listY -= 38
  for (const [index, [range, name]] of INDEX_ENTRIES.entries()) {
    if (index > 0) {
      page.drawRectangle({
        x: boxX + 22,
        y: listY + 19,
        width: boxW - 44,
        height: 0.6,
        color: WHITE,
        opacity: 0.12,
      })
    }
    safeDrawText(page, range, { x: boxX + 22, y: listY, size: 13, font: fonts.condensed, color: RED })
    safeDrawText(page, name.toUpperCase(), {
      x: boxX + 92,
      y: listY,
      size: 12,
      font: fonts.sansMedium,
      color: WHITE,
    })
    listY -= 36
  }
}

export function drawMarsaBoxClosing(page: PDFPage, fonts: BrochureFonts, logo: PDFImage | null) {
  const centerX = PAGE_W / 2
  let y = PAGE_H / 2 + 70

  if (logo) {
    const logoW = 400
    const logoH = logoW * (logo.height / logo.width)
    page.drawImage(logo, {
      x: centerX - logoW / 2,
      y: y - logoH / 2,
      width: logoW,
      height: logoH,
    })
    y -= logoH / 2 + 54
  }

  const message = "WE LOOK FORWARD TO WELCOMING YOU"
  const messageSize = 22
  const messageW = fonts.condensed.widthOfTextAtSize(message, messageSize)
  safeDrawText(page, message, {
    x: centerX - messageW / 2,
    y,
    size: messageSize,
    font: fonts.condensed,
    color: WHITE,
  })
  page.drawRectangle({
    x: centerX - 44,
    y: y - 28,
    width: 88,
    height: 4,
    color: RED,
  })
}
