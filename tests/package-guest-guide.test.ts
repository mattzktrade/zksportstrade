import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib"
import type { BrochureContent } from "../lib/brochures/types"
import {
  assessGuestGuideReadiness,
  emptyGuestGuideContent,
  guestGuideHeadline,
  guestGuidePagePlan,
  matchesOfficialGuestGuide,
  officialSingaporeVelocityTerraceGuestGuide,
  parseGuestGuide,
  resolveGuestGuideContent,
  NATIONAL_GALLERY_SINGAPORE_MAP,
  NATIONAL_GALLERY_SINGAPORE_MAPS_URL,
  VELOCITY_TERRACE_DISCOVER_QR,
  VELOCITY_TERRACE_LOGO,
  VELOCITY_TERRACE_SINGAPORE_URL,
  VELOCITY_TERRACE_SY_LOGO,
  VELOCITY_TERRACE_THE_TEAM_LOGO,
  VELOCITY_TERRACE_ZK_LOGO,
} from "../lib/brochures/guest-guide/content"
import { generatePackageGuestGuidePdf, guestGuidePhotoPlan } from "../lib/brochures/guest-guide/pdf"
import { stalePackagePdfPaths } from "../lib/brochures/storage"
import { guestGuideFilename } from "../lib/brochures/text"

const sample: BrochureContent = {
  packageId: "pkg-velocity",
  productName: "3 Days Velocity Terrace",
  raceName: "Singapore Grand Prix 2026",
  circuit: "Marina Bay Street Circuit",
  location: "Singapore",
  country: "Singapore",
  dateRange: "9-11 Oct 2026",
  durationLabel: "3 day package",
  description: "Rooftop hospitality at National Gallery Singapore.",
  includes: ["Hospitality", "Open bar", "DJ", "Views"],
  productCode: "SIN-VEL-3D",
  heroUrl: "/images/circuits/singapore.jpg",
  galleryUrls: [
    "/images/circuits/vegas.jpg",
    "/images/circuits/mexico.jpg",
    "/images/circuits/austin.jpg",
    "/images/circuits/monza.jpg",
  ],
  trackMapUrl: null,
  eventFamily: "FORMULA 1",
  placeHeadline: "SINGAPORE",
  dateHeadline: "9-11 October 2026",
}

describe("package guest guides", () => {
  it("builds a guest-guide filename without touching the sales brochure name", () => {
    assert.equal(
      guestGuideFilename("3 Days Velocity Terrace", "Singapore Grand Prix 2026"),
      "singapore-gp-2026-3-days-velocity-terrace-guest-guide.pdf",
    )
  })

  it("only removes stale files of the same document kind", () => {
    const names = [
      "old-sales-brochure.pdf",
      "brochure.pdf",
      "singapore-gp-2026-3-days-velocity-terrace-brochure.pdf",
      "old-guest-guide.pdf",
      "guest-guide.pdf",
      "singapore-gp-2026-3-days-velocity-terrace-guest-guide.pdf",
    ]
    assert.deepEqual(
      stalePackagePdfPaths("pkg-1", names, "brochure", "singapore-gp-2026-3-days-velocity-terrace-brochure.pdf"),
      ["pkg-1/old-sales-brochure.pdf"],
    )
    assert.deepEqual(
      stalePackagePdfPaths(
        "pkg-1",
        names,
        "guest-guide",
        "singapore-gp-2026-3-days-velocity-terrace-guest-guide.pdf",
      ),
      ["pkg-1/old-guest-guide.pdf"],
    )
  })

  it("uses official Singapore Velocity Terrace copy only for that venue", () => {
    assert.equal(
      matchesOfficialGuestGuide({
        productName: "Saturday Velocity Terrace",
        raceName: "Singapore Grand Prix 2026",
        location: "Singapore",
      }),
      true,
    )
    assert.equal(
      matchesOfficialGuestGuide({
        productName: "Sunday Velocity Terrace",
        raceName: "Abu Dhabi Grand Prix 2026",
        location: "Abu Dhabi",
      }),
      false,
    )
    const official = officialSingaporeVelocityTerraceGuestGuide()
    assert.deepEqual(guestGuidePagePlan(official), [
      "welcome",
      "beforeWeekend",
      "digitalTicket",
      "arriving",
      "experience",
      "gettingThere",
      "parking",
      "ticketHelp",
      "thingsToKnow",
      "closing",
    ])
    assert.deepEqual(guestGuideHeadline(official.pages[0]!), {
      lead: "Welcome to",
      accent: "Velocity Terrace",
    })
    assert.deepEqual(guestGuideHeadline(official.pages.find((page) => page.key === "gettingThere")!), {
      lead: "Getting there",
      accent: "",
    })
    assert.deepEqual(guestGuideHeadline(official.pages.find((page) => page.key === "ticketHelp")!), {
      lead: "On-ground",
      accent: "Support",
    })
    assert.deepEqual(
      guestGuideHeadline({ key: "ticketHelp", title: "If you have a problem with your ticket" }),
      { lead: "On-ground", accent: "Support" },
    )
    assert.deepEqual(guestGuideHeadline(official.pages.find((page) => page.key === "closing")!), {
      lead: "We look forward to",
      accent: "Welcoming you",
    })
    assert.equal(official.pages[0]?.title, "Welcome to Velocity Terrace")
    const arriving = official.pages.find((page) => page.key === "arriving")
    const support = official.pages.find((page) => page.key === "ticketHelp")
    const closing = official.pages.find((page) => page.key === "closing")
    assert.equal(arriving?.intro, undefined)
    assert.equal(support?.title, "On-ground support")
    assert.equal(support?.contactName, "[NAME]")
    assert.equal(support?.contactPhone, "[NUMBER]")
    assert.equal(closing?.facts?.[0]?.value, "Velocity Terrace")
    assert.equal(closing?.qrImagePath, VELOCITY_TERRACE_DISCOVER_QR)
    assert.equal(closing?.linkUrl, VELOCITY_TERRACE_SINGAPORE_URL)
    assert.equal(closing?.mapImagePath, NATIONAL_GALLERY_SINGAPORE_MAP)
    assert.equal(closing?.mapUrl, NATIONAL_GALLERY_SINGAPORE_MAPS_URL)
    assert.equal(official.pages.length, 10)
    assert.ok(existsSync("public/images/brochures/velocity-terrace-discover-qr.png"))
    assert.ok(existsSync("public/images/brochures/national-gallery-singapore-map.png"))
    assert.ok(existsSync(VELOCITY_TERRACE_LOGO.replace(/^\//, "public/")))
    assert.ok(existsSync(VELOCITY_TERRACE_SY_LOGO.replace(/^\//, "public/")))
    assert.ok(existsSync(VELOCITY_TERRACE_ZK_LOGO.replace(/^\//, "public/")))
    assert.ok(existsSync(VELOCITY_TERRACE_THE_TEAM_LOGO.replace(/^\//, "public/")))
  })

  it("parses stored JSON and skips empty pages", () => {
    const parsed = parseGuestGuide({
      pages: [
        { key: "welcome", title: "Welcome", paragraphs: ["Hello guests."] },
        { key: "parking", title: "Parking" },
      ],
    })
    assert.ok(parsed)
    assert.equal(parsed?.pages.find((page) => page.key === "welcome")?.paragraphs?.[0], "Hello guests.")
    assert.deepEqual(guestGuidePagePlan(parsed!), ["welcome"])
    assert.deepEqual(guestGuidePagePlan(emptyGuestGuideContent()), [])

    const migrated = parseGuestGuide({
      pages: [
        { key: "welcome", title: "Welcome", paragraphs: ["Hello guests."] },
        {
          key: "support",
          title: "On-ground support",
          contactName: "[NAME]",
          contactPhone: "[NUMBER]",
        },
        {
          key: "discover",
          title: "Discover",
          linkUrl: VELOCITY_TERRACE_SINGAPORE_URL,
          qrImagePath: VELOCITY_TERRACE_DISCOVER_QR,
        },
      ],
    })
    assert.equal(migrated?.pages.find((page) => page.key === "ticketHelp")?.contactName, "[NAME]")
    assert.equal(migrated?.pages.find((page) => page.key === "closing")?.linkUrl, VELOCITY_TERRACE_SINGAPORE_URL)
    assert.equal(migrated?.pages.length, 10)

    const arrivingStored = parseGuestGuide({
      pages: [
        { key: "welcome", title: "Welcome", paragraphs: ["Hello guests."] },
        {
          key: "arriving",
          title: "Arriving",
          intro: "Please ensure you are travelling to the Coleman Street Entrance of National Gallery Singapore.",
          steps: [{ title: "Check in", body: "Have your ticket ready." }],
        },
      ],
    })
    assert.equal(arrivingStored?.pages.find((page) => page.key === "arriving")?.intro, undefined)
  })

  it("fills official copy when the editor is empty on Singapore Velocity Terrace", () => {
    const resolved = resolveGuestGuideContent({
      stored: null,
      incoming: emptyGuestGuideContent(),
      productName: "3 Days Velocity Terrace",
      raceName: "Singapore Grand Prix 2026",
      location: "Singapore",
    })
    assert.equal(resolved.pages[0]?.title, "Welcome to Velocity Terrace")
    assert.ok(assessGuestGuideReadiness(sample, resolved).ok)
  })

  it("never reuses welcome photos on the experience page", () => {
    assert.deepEqual(guestGuidePhotoPlan(5), { welcome: 3, experience: 1 })
    assert.deepEqual(guestGuidePhotoPlan(6), { welcome: 3, experience: 2 })
    assert.deepEqual(guestGuidePhotoPlan(7), { welcome: 3, experience: 3 })
    assert.deepEqual(guestGuidePhotoPlan(3), { welcome: 2, experience: 0 })
  })

  it("refuses a guest guide without photos or enough page copy", () => {
    const noPhotos = assessGuestGuideReadiness(
      { ...sample, heroUrl: null, galleryUrls: [] },
      officialSingaporeVelocityTerraceGuestGuide(),
    )
    assert.equal(noPhotos.ok, false)
    if (!noPhotos.ok) assert.equal(noPhotos.code, "insufficient_images")

    const empty = assessGuestGuideReadiness(sample, emptyGuestGuideContent())
    assert.equal(empty.ok, false)
    if (!empty.ok) assert.equal(empty.code, "insufficient_content")
  })

  it("renders a landscape guest guide with the sales cover plus staff pages", async () => {
    const bytes = await generatePackageGuestGuidePdf(sample, officialSingaporeVelocityTerraceGuestGuide())
    assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), "%PDF")
    const pdf = await PDFDocument.load(bytes)
    assert.equal(pdf.getPageCount(), 11)
    assert.match(Buffer.from(bytes).toString("latin1"), /velocity-terrace\.com/)
    const size = pdf.getPage(0).getSize()
    assert.ok(size.width > size.height)
    assert.match(pdf.getTitle() ?? "", /Velocity Terrace/)
    assert.match(pdf.getTitle() ?? "", /Guest guide/)
    assert.equal(pdf.getAuthor(), "ZK Sports & Entertainment")
    const asString = Buffer.from(bytes).toString("latin1")
    assert.doesNotMatch(asString, /zk-sports\.com/)
    assert.doesNotMatch(asString, /OFFICIAL F1 PADDOCK/)
    assert.doesNotMatch(asString, /PADDOCK CLUB DISTRIBUTOR/)
    assert.doesNotMatch(asString, /Create guest guide/)
    const last = pdf.getPage(pdf.getPageCount() - 1)
    const annots = last.node.lookupMaybe(PDFName.of("Annots"), PDFArray)
    assert.ok(annots && annots.size() >= 2)
    const hrefs: string[] = []
    for (let i = 0; i < (annots?.size() ?? 0); i += 1) {
      const annot = annots!.lookup(i, PDFDict)
      const action = annot.lookup(PDFName.of("A"), PDFDict)
      hrefs.push(action.lookup(PDFName.of("URI"), PDFString).decodeText())
    }
    assert.ok(hrefs.some((href) => href.includes("velocity-terrace.com")))
    assert.ok(hrefs.some((href) => href.includes("google.com/maps")))
  })

  it("keeps the location map and partner marks off the shared guest-guide template", async () => {
    const other = {
      ...sample,
      productName: "Paddock Club",
      raceName: "Monaco Grand Prix 2026",
      location: "Monaco",
    }
    const bytes = await generatePackageGuestGuidePdf(other, {
      pages: [
        { key: "welcome", title: "Welcome", paragraphs: ["Hello guests."] },
        {
          key: "closing",
          title: "We look forward to welcoming you",
          paragraphs: ["Please scan the QR code or click the link below."],
          linkUrl: "https://example.com/guide",
          mapImagePath: NATIONAL_GALLERY_SINGAPORE_MAP,
          mapUrl: NATIONAL_GALLERY_SINGAPORE_MAPS_URL,
        },
      ],
    })
    const pdf = await PDFDocument.load(bytes)
    const last = pdf.getPage(pdf.getPageCount() - 1)
    const annots = last.node.lookupMaybe(PDFName.of("Annots"), PDFArray)
    const hrefs: string[] = []
    for (let i = 0; i < (annots?.size() ?? 0); i += 1) {
      const annot = annots!.lookup(i, PDFDict)
      const action = annot.lookup(PDFName.of("A"), PDFDict)
      hrefs.push(action.lookup(PDFName.of("URI"), PDFString).decodeText())
    }
    assert.ok(hrefs.every((href) => !href.includes("google.com/maps")))
  })

  it("keeps generation in the admin catalog action and hides the download from the portal", () => {
    const action = readFileSync("app/(admin)/admin/catalog/brochure-actions.ts", "utf8")
    assert.match(action, /createPackageGuestGuide/)
    assert.match(action, /requireAdminAction\("cms.access"\)/)
    const portal = readFileSync("app/(portal)/packages/race/[id]/race-packages-client.tsx", "utf8")
    assert.doesNotMatch(portal, /View guest guide/)
    assert.doesNotMatch(portal, /guestGuideUrl/)
    assert.doesNotMatch(portal, /Create guest guide/)
    const catalog = readFileSync("lib/catalog/queries.ts", "utf8")
    assert.doesNotMatch(catalog, /guestGuideUrl|guest_guide_url|attachGuestGuideUrls/)
    const salesList = readFileSync("components/admin/inventory-workspace.tsx", "utf8")
    assert.match(salesList, /downloadOnly/)
    assert.doesNotMatch(salesList, /Create guest guide/)
    const salesPdf = readFileSync("lib/brochures/pdf.ts", "utf8")
    assert.match(salesPdf, /export function drawBrochureCover/)
    assert.doesNotMatch(salesPdf, /guest-guide/)
  })
})
