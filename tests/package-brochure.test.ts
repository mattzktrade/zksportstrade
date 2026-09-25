import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { PDFDocument } from "pdf-lib"
import {
  brochureContentFromPackage,
  brochureCircuitFacts,
  brochureDateHeadline,
  brochureEventFamily,
  brochurePhotoUrls,
  brochurePlaceHeadline,
  brochureVenueLine,
  formatBrochureIncludes,
  resolveTrackMapUrl,
  splitProductHeadline,
} from "../lib/brochures/content"
import { enrichBrochureContent, officialProgrammeTemplate } from "../lib/brochures/enrich"
import { brochureImageFetchUrl, compressBrochureImageBytes } from "../lib/brochures/images"
import { embedBrochureFonts } from "../lib/brochures/fonts"
import {
  brochurePagePlan,
  generatePackageBrochurePdf,
  includedPhotoSlots,
  planExperienceParagraphs,
  planIncludedItems,
  splitInnerPhotos,
} from "../lib/brochures/pdf"
import { assessBrochureReadiness } from "../lib/brochures/readiness"
import { brochureFilename, brochurePrintText, brochureSafeText, uniqueImageUrls } from "../lib/brochures/text"
import { packageBrochureStoragePath } from "../lib/brochures/storage"
import { BrochureInsufficientImagesError, type BrochureContent } from "../lib/brochures/types"

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
  galleryUrls: ["/images/circuits/singapore.jpg", "/images/circuits/vegas.jpg"],
  trackMapUrl: null,
  eventFamily: "FORMULA 1",
  placeHeadline: "ABU DHABI",
  dateHeadline: "4 TO 6 DECEMBER 2026",
}

describe("package brochures", () => {
  it("builds a download filename from the event and package name", () => {
    assert.equal(
      brochureFilename("3 Day Champions Club", "Abu Dhabi Grand Prix 2026"),
      "abu-dhabi-gp-2026-3-day-champions-club-brochure.pdf",
    )
    assert.equal(brochureFilename("3 Day Legend Paddock Club"), "3-day-legend-paddock-club-brochure.pdf")
    assert.equal(
      packageBrochureStoragePath("abudhabi-champions-club-2026", "abu-dhabi-gp-2026-3-day-champions-club-brochure.pdf"),
      "abudhabi-champions-club-2026/abu-dhabi-gp-2026-3-day-champions-club-brochure.pdf",
    )
  })

  it("uses the same cover / what's included layout for every product", () => {
    assert.deepEqual(brochurePagePlan(false), ["cover", "experience", "included"])
    assert.deepEqual(brochurePagePlan(true), ["cover", "experience", "included", "details"])
    assert.equal(includedPhotoSlots(3), 3)
    assert.equal(includedPhotoSlots(5), 3)
    assert.equal(includedPhotoSlots(6), 5)
    assert.equal(includedPhotoSlots(10), 5)
    assert.deepEqual(splitInnerPhotos(["cover", "a", "b", "c", "d"]), {
      experience: ["a", "b"],
      included: ["c", "d"],
    })
    assert.deepEqual(splitInnerPhotos(["cover", "a"]), { experience: ["a"], included: [] })
    const pdfSource = readFileSync("lib/brochures/pdf.ts", "utf8")
    assert.match(pdfSource, /splitProductHeadline\(content\.productName\)/)
    assert.doesNotMatch(pdfSource, /placeHeadline/)
    assert.doesNotMatch(pdfSource, /drawStory/)
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
    assert.equal(brochurePrintText("F1® Paddock Club™ access"), "F1 Paddock Club access")
  })

  it("asks Wix for a JPEG large enough to print", () => {
    const url =
      "https://static.wixstatic.com/media/abc123~mv2.jpg/v1/fill/w_400,h_264,al_c,q_80,enc_auto/abc123~mv2.jpg"
    const out = brochureImageFetchUrl(url, 1800)
    assert.match(out, /w_1800/)
    assert.match(out, /enc_jpg/)
    const map = brochureImageFetchUrl(url, 2200, { fit: "contain" })
    assert.match(map, /\/v1\/fit\//)
    assert.doesNotMatch(map, /\/v1\/fill\//)
  })

  it("recompresses catalog photos to print-sized JPEGs", async () => {
    const src = readFileSync("public/images/circuits/singapore.jpg")
    const out = await compressBrochureImageBytes(src, 800)
    assert.equal(out[0], 0xff)
    assert.equal(out[1], 0xd8)
    assert.ok(out.length < src.length || out.length < 250_000)
  })

  it("builds cover headlines from the race, not the package price", () => {
    assert.equal(brochureEventFamily("Abu Dhabi Grand Prix 2026", "formula_1"), "FORMULA 1")
    assert.equal(brochurePlaceHeadline("Abu Dhabi Grand Prix 2026", "Abu Dhabi", "UAE"), "ABU DHABI")
    assert.equal(brochureDateHeadline("4-6 Dec 2026"), "4-6 December 2026")
    assert.equal(brochureVenueLine("Yas Marina Circuit", "Abu Dhabi", "Abu Dhabi Grand Prix 2026"), "Yas Marina Circuit")
    assert.equal(brochureVenueLine(null, "Abu Dhabi", "Abu Dhabi Grand Prix 2026"), null)
    assert.deepEqual(splitProductHeadline("Marsa Box"), { lead: "MARSA", accent: "BOX" })
    assert.equal(formatBrochureIncludes(["Dining", "Open bar", "Host", "Pit walk"]).length, 4)
    assert.equal(formatBrochureIncludes(["Premium Views: Watch the start"]).at(0)?.title, "Premium Views")
    assert.equal(
      resolveTrackMapUrl(null, "/images/hero.jpg", ["/images/gallery.jpg", "/images/yas-track-map.png"]),
      "/images/yas-track-map.png",
    )
    assert.deepEqual(
      brochurePhotoUrls("/images/hero.jpg", ["/images/yas-track-map.png", "/images/suite.jpg"], "/images/yas-track-map.png"),
      ["/images/hero.jpg", "/images/suite.jpg"],
    )
    assert.deepEqual(
      brochureCircuitFacts(sample).map((fact) => fact.label),
      ["Event", "Circuit", "Location", "Dates"],
    )
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
        track_map: null,
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
    assert.equal(content.dateHeadline, "9-11 October 2026")
    assert.equal(content.trackMapUrl, null)
    assert.equal("tradePrice" in content, false)
    assert.equal("trade_price" in content, false)
  })

  it("refuses a brochure without enough unique photos or copy", () => {
    const tooFewPhotos = assessBrochureReadiness({
      ...sample,
      galleryUrls: ["/images/circuits/abudhabi.jpg"],
    })
    assert.equal(tooFewPhotos.ok, false)
    if (!tooFewPhotos.ok) assert.equal(tooFewPhotos.code, "insufficient_images")

    const tooThin = assessBrochureReadiness({
      ...sample,
      description: "Nice suite.",
      includes: ["Access"],
    })
    assert.equal(tooThin.ok, false)
    if (!tooThin.ok) assert.equal(tooThin.code, "insufficient_content")

    assert.equal(assessBrochureReadiness(sample).ok, true)
  })

  it("fills standard Paddock Club copy from official programme details only", () => {
    const filled = enrichBrochureContent({
      ...sample,
      description: null,
      includes: [],
    })
    assert.equal(filled.copyEnriched, true)
    assert.ok((filled.description ?? "").length > 70)
    assert.ok(filled.includes.length >= 4)
    assert.match(filled.includes[0] ?? "", /3-Day/)
    assert.equal(assessBrochureReadiness(filled).ok, true)

    const oneDay = enrichBrochureContent({
      ...sample,
      productName: "1 Day Paddock Club",
      durationLabel: "1 day package",
      description: null,
      includes: [],
    })
    assert.match(oneDay.includes[0] ?? "", /1-Day/)
    assert.doesNotMatch(oneDay.includes.join(" "), /3-Day/)

    const unknown = enrichBrochureContent({
      ...sample,
      productName: "Private Yacht Deck",
      description: null,
      includes: [],
    })
    assert.equal(unknown.copyEnriched, undefined)
    assert.equal(unknown.description, null)
    assert.equal(unknown.includes.length, 0)
    assert.equal(assessBrochureReadiness(unknown).ok, false)

    assert.equal(
      officialProgrammeTemplate({
        ...sample,
        productName: "House 44 Paddock Club",
        location: "Monaco",
        raceName: "Monaco Grand Prix 2026",
        country: "Monaco",
      }),
      null,
    )
  })

  it("renders a landscape branded PDF from product copy and photos", async () => {
    const bytes = await generatePackageBrochurePdf(sample)
    assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), "%PDF")
    const pdf = await PDFDocument.load(bytes)
    assert.equal(pdf.getPageCount(), 3)
    const size = pdf.getPage(0).getSize()
    assert.ok(size.width > size.height)
    assert.match(pdf.getTitle() ?? "", /Legend Paddock Club/)
    assert.equal(pdf.getAuthor(), "ZK Sports & Entertainment")
    const asString = Buffer.from(bytes).toString("latin1")
    assert.doesNotMatch(asString, /888888/)
    assert.doesNotMatch(asString, /Create brochure/)
    assert.doesNotMatch(asString, /OFFICIAL F1 PADDOCK/)
    assert.doesNotMatch(asString, /PADDOCK CLUB DISTRIBUTOR/)
    assert.doesNotMatch(asString, /zk-sports\.com/)
  })

  it("adds a circuit page only when a track map image loads", async () => {
    const withMap = await generatePackageBrochurePdf({
      ...sample,
      trackMapUrl: "/images/circuits/vegas.jpg",
    })
    assert.equal((await PDFDocument.load(withMap)).getPageCount(), 4)

    const missingMap = await generatePackageBrochurePdf({
      ...sample,
      trackMapUrl: "/images/circuits/does-not-exist.jpg",
    })
    assert.equal((await PDFDocument.load(missingMap)).getPageCount(), 3)
  })

  it("keeps the description and the inclusion list on two pages", async () => {
    const content = {
      ...sample,
      description:
        "Velocity Terrace hospitality at Yas Marina with sweeping views of Turns 8-11, gourmet dining, premium open bar, live entertainment, racing simulators and Yasalam concert access.",
      includes: [
        "Sweeping views of Turns 8, 9, 10 and 11",
        "Curated food menus prepared by highly trained chefs",
        "Premium open bar with free-flowing champagne and beverages",
        "International mixologists",
        "Live DJs, dancers, saxophonists and magicians",
        "State-of-the-art racing simulators",
        "Flatscreen TVs, comfortable sofas and exclusive VIP terrace access",
        "General admission to Yasalam after-race concerts on your booked day(s)",
        "Guests aged 16 and over",
      ],
    }
    const bytes = await generatePackageBrochurePdf(content)
    const layoutPdf = await PDFDocument.create()
    const fonts = await embedBrochureFonts(layoutPdf)
    const experience = planExperienceParagraphs(content, fonts).flat().join(" ")
    const included = planIncludedItems(content, fonts).map((item) => item.title)
    assert.match(experience, /Yasalam concert access/)
    assert.ok(included.length >= 7)
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 3)
  })

  it("still uses the experience and included pages when there are many photos", async () => {
    const bytes = await generatePackageBrochurePdf({
      ...sample,
      galleryUrls: [
        "/images/circuits/singapore.jpg",
        "/images/circuits/vegas.jpg",
        "/images/circuits/mexico.jpg",
        "/images/circuits/austin.jpg",
        "/images/circuits/monza.jpg",
      ],
    })
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 3)
  })

  it("still draws the template if optional copy is missing, but blocks when photos are required", async () => {
    const bytes = await generatePackageBrochurePdf({
      ...sample,
      description: null,
      includes: [],
      heroUrl: null,
      galleryUrls: [],
    })
    const pdf = await PDFDocument.load(bytes)
    assert.equal(pdf.getPageCount(), 3)

    await assert.rejects(
      () =>
        generatePackageBrochurePdf(
          { ...sample, heroUrl: null, galleryUrls: [] },
          { minPhotos: 3 },
        ),
      (error: unknown) => error instanceof BrochureInsufficientImagesError,
    )
  })

  it("keeps generation in the admin catalog action and public download in the portal", () => {
    const action = readFileSync("app/(admin)/admin/catalog/brochure-actions.ts", "utf8")
    assert.match(action, /requireAdminAction\("cms.access"\)/)
    const portal = readFileSync("app/(portal)/packages/race/[id]/race-packages-client.tsx", "utf8")
    assert.match(portal, /View brochure/)
    assert.doesNotMatch(portal, /Create brochure/)
  })
})
