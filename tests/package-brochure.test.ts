import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { PDFDocument } from "pdf-lib"
import {
  brochureContentFromPackage,
  brochureDateHeadline,
  brochureEventFamily,
  brochurePlaceHeadline,
  groupBrochureIncludes,
  splitProductHeadline,
} from "../lib/brochures/content"
import { brochureImageFetchUrl } from "../lib/brochures/images"
import { generatePackageBrochurePdf } from "../lib/brochures/pdf"
import { brochureFilename, brochureSafeText, uniqueImageUrls } from "../lib/brochures/text"
import type { BrochureContent } from "../lib/brochures/types"

const sample: BrochureContent = {
  packageId: "pkg-test",
  productName: "3 Day Legend Paddock Club",
  raceName: "Abu Dhabi Grand Prix 2026",
  circuit: "Yas Marina Circuit",
  location: "Abu Dhabi",
  country: "United Arab Emirates",
  dateRange: "4-6 Dec 2026",
  durationLabel: "3 day package",
  description:
    "Watch Formula 1 from the heart of the paddock. This three-day hospitality experience includes trackside views, chef-led dining, and host service throughout the weekend.",
  includes: [
    "Paddock Club access Thursday to Sunday",
    "Open bar and gourmet dining",
    "Pit lane walk",
    "Dedicated host",
    "After-race concert access",
  ],
  productCode: "AD-LEG-3D",
  heroUrl: "/images/circuits/abudhabi.jpg",
  galleryUrls: ["/images/circuits/abudhabi.jpg", "/images/circuits/vegas.jpg"],
  eventFamily: "FORMULA 1",
  placeHeadline: "ABU DHABI",
  dateHeadline: "4 TO 6 DECEMBER 2026",
}

describe("package brochures", () => {
  it("builds a download filename from the product name", () => {
    assert.equal(brochureFilename("3 Day Legend Paddock Club", null), "3-day-legend-paddock-club-brochure.pdf")
    assert.equal(brochureFilename("Ignored", "AD LEG 3D"), "ad-leg-3d-brochure.pdf")
  })

  it("dedupes hero and gallery urls", () => {
    assert.deepEqual(
      uniqueImageUrls("/images/a.jpg", ["/images/a.jpg", "/images/b.jpg", ""]),
      ["/images/a.jpg", "/images/b.jpg"],
    )
  })

  it("strips smart punctuation that PDF fonts cannot draw", () => {
    assert.equal(
      brochureSafeText("Paddock Club\u2122 \u2014 the weekend\u2019s view"),
      "Paddock Club(TM) - the weekend's view",
    )
  })

  it("asks Wix for a JPEG large enough to print", () => {
    const url =
      "https://static.wixstatic.com/media/abc123~mv2.jpg/v1/fill/w_400,h_264,al_c,q_80,enc_auto/abc123~mv2.jpg"
    const out = brochureImageFetchUrl(url, 1800)
    assert.match(out, /w_1800/)
    assert.match(out, /enc_jpg/)
  })

  it("builds cover headlines from the race, not the package price", () => {
    assert.equal(brochureEventFamily("Abu Dhabi Grand Prix 2026", "formula_1"), "FORMULA 1")
    assert.equal(brochurePlaceHeadline("Abu Dhabi Grand Prix 2026", "Abu Dhabi", "UAE"), "ABU DHABI")
    assert.equal(brochureDateHeadline("4-6 Dec 2026"), "4 TO 6 DECEMBER 2026")
    assert.deepEqual(splitProductHeadline("Marsa Box"), { lead: "MARSA", accent: "BOX" })
    assert.equal(groupBrochureIncludes(["Dining", "Open bar", "Host", "Pit walk"]).length, 4)
  })

  it("maps package rows without including a trade price", () => {
    const content = brochureContentFromPackage(
      {
        id: "pkg-1",
        race_id: "race-1",
        name: "Champions Club",
        circuit: "Marina Bay",
        location: "Singapore",
        country: "Singapore",
        date_range: "9-11 Oct 2026",
        description: "Night race hospitality.",
        image: "/images/circuits/singapore.jpg",
        gallery_images: ["/images/circuits/singapore.jpg"],
        includes: ["Suite access", "Champagne"],
        product_code: "SIN-CHAMP",
        brochure_url: null,
        duration: "3_day",
      },
      "Singapore Grand Prix 2026",
      "formula_1",
    )
    assert.equal(content.durationLabel, "3 day package")
    assert.equal(content.heroUrl, "/images/circuits/singapore.jpg")
    assert.equal(content.eventFamily, "FORMULA 1")
    assert.equal(content.placeHeadline, "SINGAPORE")
    assert.equal(content.dateHeadline, "9 TO 11 OCTOBER 2026")
    assert.equal("tradePrice" in content, false)
    assert.equal("trade_price" in content, false)
  })

  it("renders a landscape branded PDF from product copy and photos", async () => {
    const bytes = await generatePackageBrochurePdf(sample)
    assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), "%PDF")
    const pdf = await PDFDocument.load(bytes)
    assert.ok(pdf.getPageCount() >= 2)
    const size = pdf.getPage(0).getSize()
    assert.ok(size.width > size.height)
    assert.match(pdf.getTitle() ?? "", /Legend Paddock Club/)
    assert.equal(pdf.getAuthor(), "ZK Sports & Entertainment")
    const asString = Buffer.from(bytes).toString("latin1")
    assert.doesNotMatch(asString, /888888/)
    assert.doesNotMatch(asString, /Create brochure/)
  })

  it("still renders when photos, description and inclusions are missing", async () => {
    const bytes = await generatePackageBrochurePdf({
      ...sample,
      description: null,
      includes: [],
      heroUrl: null,
      galleryUrls: [],
    })
    const pdf = await PDFDocument.load(bytes)
    assert.ok(pdf.getPageCount() >= 2)
    const size = pdf.getPage(0).getSize()
    assert.ok(size.width > size.height)
  })

  it("keeps generation in the admin catalog action and public download in the portal", () => {
    const action = readFileSync("app/(admin)/admin/catalog/brochure-actions.ts", "utf8")
    assert.match(action, /requireAdminAction\("cms.access"\)/)
    const portal = readFileSync("app/(portal)/packages/race/[id]/race-packages-client.tsx", "utf8")
    assert.match(portal, /View brochure/)
    assert.doesNotMatch(portal, /Create brochure/)
  })
})
