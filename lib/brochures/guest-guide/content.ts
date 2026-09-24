import { splitProductHeadline } from "@/lib/brochures/content"
import {
  GUEST_GUIDE_PAGE_KEYS,
  LEGACY_GUEST_GUIDE_PAGE_KEYS,
  type GuestGuideContent,
  type GuestGuidePage,
  type GuestGuidePageKey,
} from "@/lib/brochures/guest-guide/types"
import { brochurePhotoCount, MIN_BROCHURE_PHOTOS } from "@/lib/brochures/readiness"
import type { BrochureContent, BrochureCreateErrorCode } from "@/lib/brochures/types"

export const GUEST_GUIDE_KICKER = "Guest guide"
export const VELOCITY_TERRACE_DISCOVER_QR = "/images/brochures/velocity-terrace-discover-qr.png"
export const VELOCITY_TERRACE_SINGAPORE_URL = "https://www.velocity-terrace.com/races/singapore"
export const NATIONAL_GALLERY_SINGAPORE_MAP = "/images/brochures/national-gallery-singapore-map.png"
export const NATIONAL_GALLERY_SINGAPORE_MAPS_URL =
  "https://www.google.com/maps/place/National+Gallery+Singapore/@1.2902217,103.8515167,17z"
export const VELOCITY_TERRACE_LOGO = "/images/brochures/velocity-terrace/logo-white.png"
export const VELOCITY_TERRACE_SY_LOGO = "/images/brochures/velocity-terrace/sy-holdings.png"
export const VELOCITY_TERRACE_ZK_LOGO = "/images/brochures/velocity-terrace/zk-sports.png"
export const VELOCITY_TERRACE_THE_TEAM_LOGO = "/images/brochures/velocity-terrace/the-team.png"
export const VELOCITY_TERRACE_PRESENTER = "SY Holdings"
export const MIN_GUEST_GUIDE_PAGES = 3

const DEFAULT_TITLES: Record<GuestGuidePageKey, string> = {
  welcome: "Welcome",
  beforeWeekend: "Before race weekend",
  digitalTicket: "Your digital ticket",
  arriving: "Arriving",
  experience: "The experience",
  gettingThere: "Getting there",
  parking: "Parking",
  ticketHelp: "On-ground support",
  thingsToKnow: "Things to know",
  closing: "We look forward to welcoming you",
}

export function emptyGuestGuidePage(key: GuestGuidePageKey): GuestGuidePage {
  return {
    key,
    title: DEFAULT_TITLES[key],
    kicker: GUEST_GUIDE_KICKER,
  }
}

export function emptyGuestGuideContent(): GuestGuideContent {
  return { pages: GUEST_GUIDE_PAGE_KEYS.map((key) => emptyGuestGuidePage(key)) }
}

export function matchesOfficialGuestGuide(input: {
  productName: string
  raceName?: string | null
  location?: string | null
}): boolean {
  if (!/velocity\s*terrace/i.test(input.productName)) return false
  const blob = `${input.productName} ${input.raceName ?? ""} ${input.location ?? ""}`.toLowerCase()
  return /singapore/.test(blob)
}

/** Cover-style two-line title. Welcome is "Welcome to" / name; closing keeps YOU with welcoming. */
export function guestGuideHeadline(page: GuestGuidePage): { lead: string; accent: string } {
  if (page.key === "gettingThere") {
    return {
      lead: page.titleLead?.trim() || page.title.trim() || "Getting there",
      accent: "",
    }
  }
  if (page.key === "ticketHelp") {
    return { lead: "On-ground", accent: "Support" }
  }
  if (page.titleLead?.trim() || page.titleAccent?.trim()) {
    return {
      lead: page.titleLead?.trim() ?? "",
      accent: page.titleAccent?.trim() ?? "",
    }
  }
  const title = page.title.trim()
  const welcome = title.match(/^welcome\s+to\s+(.+)$/i)
  if (page.key === "welcome" && welcome?.[1]) {
    return { lead: "Welcome to", accent: welcome[1] }
  }
  const closing = title.match(/^we look forward to\s+(welcoming you)$/i)
  if (page.key === "closing" && closing?.[1]) {
    return { lead: "We look forward to", accent: closing[1] }
  }
  return splitProductHeadline(title || "Guest guide")
}

/** Official Singapore Velocity Terrace 2026 guest-guide copy. Do not use for other venues. */
export function officialSingaporeVelocityTerraceGuestGuide(): GuestGuideContent {
  return {
    pages: [
      {
        key: "welcome",
        title: "Welcome to Velocity Terrace",
        titleLead: "Welcome to",
        titleAccent: "Velocity Terrace",
        kicker: GUEST_GUIDE_KICKER,
        paragraphs: [
          "We are delighted to welcome you to Velocity Terrace Singapore for the Singapore Grand Prix 2026.",
          "Located on the Padang Deck of the National Gallery Singapore, Velocity Terrace offers an exclusive rooftop hospitality experience with spectacular views overlooking the Padang and Turns 9/10 of the Marina Bay Street Circuit, framed by Singapore's iconic skyline.",
          "From 5:00 PM - 11:00 PM each day, guests can enjoy premium hospitality, world-class catering, a premium open bar, live DJ entertainment and an incredible atmosphere as Singapore comes alive for one of Formula 1's most spectacular night races.",
          "With an intimate capacity of just 150 guests, Velocity Terrace provides a relaxed and sophisticated setting from which to experience the excitement of the Singapore Grand Prix.",
          "We look forward to welcoming you for an unforgettable race weekend.",
        ],
      },
      {
        key: "beforeWeekend",
        title: "Before race weekend",
        kicker: GUEST_GUIDE_KICKER,
        intro: "To ensure everything is prepared for your arrival, please take note of the following important dates.",
        dateBlocks: [
          {
            date: "28 SEPTEMBER",
            title: "Dietary requirements",
            body: "Please inform us of any dietary requirements or allergies no later than 28 September 2026 so these can be communicated to our hospitality team in advance.\n\nWhile we will always do our best to accommodate guests, requirements received after this date may be more difficult to guarantee.",
          },
          {
            date: "1 OCTOBER",
            title: "Final guest details",
            body: "Please provide the following information for every guest by 1 October 2026:",
            bullets: ["Full guest name", "Day(s) attending - Friday, Saturday and/or Sunday"],
          },
          {
            date: "BEFORE 5 OCTOBER",
            title: "Digital tickets",
            body: "Individual digital tickets will be issued via TicketBud before 5 October 2026, subject to full payment and receipt of the required guest information.",
          },
        ],
        notes: [
          "Each digital ticket will be individually allocated to the named guest and their confirmed attendance day(s).",
          "Providing accurate guest information in advance is important to ensure a smooth and stress-free arrival.",
        ],
      },
      {
        key: "digitalTicket",
        title: "Your digital ticket",
        kicker: GUEST_GUIDE_KICKER,
        paragraphs: [
          "All guests require an individual Velocity Terrace digital ticket to access the venue.",
          "Your TicketBud ticket will contain a unique QR code, which will be scanned by the Velocity team upon arrival.",
          "If your booking has been made through a company, sponsor, agent or host, your tickets may be sent directly to them for onward distribution.",
          "Please ensure that each guest receives the correct ticket allocated to their name and attendance day.",
        ],
        bullets: [
          "Save your digital ticket to your phone.",
          "Check that you have the ticket allocated to your name and correct attendance day.",
          "Take a screenshot of your QR code in case of connectivity issues.",
          "Have your QR code open and ready when you arrive.",
        ],
        notes: [
          "Please do not share or forward your individual QR code to another guest.",
          "Each QR code is unique and will be validated when scanned.",
        ],
      },
      {
        key: "arriving",
        title: "Arriving at Velocity Terrace",
        kicker: GUEST_GUIDE_KICKER,
        facts: [
          { label: "Venue", value: "National Gallery Singapore" },
          { label: "Location", value: "Padang Deck" },
          { label: "Venue & hospitality", value: "5:00 PM - 11:00 PM" },
          { label: "Recommended entrance", value: "Coleman Street Entrance - City Hall Wing" },
        ],
        steps: [
          {
            title: "Arrive at National Gallery",
            body: "Enter via the Coleman Street Entrance - City Hall Wing, where the event host team will be available to welcome you.",
          },
          {
            title: "Have your digital ticket ready",
            body: "Please have your individual TicketBud QR code open on your phone and ready for scanning.",
          },
          {
            title: "Proceed to Level 5",
            body: "Take the elevator to Level 5, where a Velocity host will be waiting to welcome you and provide further directions.",
          },
          {
            title: "Check in",
            body: "Your digital ticket will be scanned by the Velocity team and your guest details confirmed.",
          },
          {
            title: "Receive your Velocity credential",
            body: "Once checked in, you will receive your Velocity Terrace wristband/credential. Please keep this with you throughout your visit.",
          },
          {
            title: "Welcome to Velocity Terrace",
            body: "Follow the Velocity signage and our host team to the Terrace, then settle in and enjoy the evening.",
          },
        ],
      },
      {
        key: "experience",
        title: "The Velocity experience",
        kicker: GUEST_GUIDE_KICKER,
        intro: "From the moment the doors open at 5:00 PM, Velocity Terrace is your home for the evening.",
        bullets: [
          "Spectacular elevated views of the Marina Bay Street Circuit, Padang and Turns 9/10",
          "World-class catering throughout the evening",
          "Premium open bar, including Cocktails, Champagne, wines, spirits, beers and soft drinks",
          "Live DJ and entertainment",
          "Premium service throughout the evening",
          "An intimate hospitality experience limited to just 150 guests",
          "A unique rooftop setting combining the National Gallery's historic architecture with Singapore's spectacular skyline",
        ],
        notes: ["Hospitality concludes at 11:00 PM each evening."],
      },
      {
        key: "gettingThere",
        title: "Getting there",
        titleLead: "Getting there",
        titleAccent: "",
        kicker: GUEST_GUIDE_KICKER,
        intro:
          "Singapore Grand Prix weekend is extremely busy, with road closures and traffic restrictions in place around the Marina Bay area.\n\nPlease allow additional travel time and plan your journey in advance.",
        sections: [
          {
            title: "MRT - recommended",
            body: "The closest MRT station is City Hall MRT Station. Take Exit B and follow the sheltered pedestrian route towards National Gallery Singapore and the Coleman Street Entrance.\n\nPublic transport is strongly recommended during Grand Prix weekend.",
          },
          {
            title: "Taxi / Grab / private car",
            body: "Before 7:00 PM, guests may be dropped off at Supreme Court Lane, subject to race-weekend traffic conditions and access restrictions.\n\nAfter 7:00 PM, vehicle access to Supreme Court Lane will not be permitted. Guests arriving by taxi, Grab or private vehicle should instead use one of the following nearby drop-off points:",
            bullets: ["Capitol Piazza", "Funan", "Peninsula Plaza"],
          },
          {
            title: "Important for later arrivals",
            body: "The Parliament Place and Padang Atrium entrances close at 7:00 PM during race week.\n\nGuests arriving after 7:00 PM should use the Coleman Street Entrance - City Hall Wing.\n\nFrom the nearby drop-off points, National Gallery Singapore is approximately a 5-minute walk.",
          },
        ],
      },
      {
        key: "parking",
        title: "Parking",
        kicker: GUEST_GUIDE_KICKER,
        paragraphs: [
          "Please note that the National Gallery Singapore car park will be closed from 8 October.",
          "Guests should therefore not plan to park directly at the venue.",
          "Alternative parking may be available at:",
        ],
        bullets: ["Funan Mall", "Capitol Piazza", "The Adelphi", "Grand City Parking"],
        notes: [
          "Parking availability cannot be guaranteed during Grand Prix weekend, so we strongly recommend using public transport wherever possible.",
        ],
      },
      {
        key: "ticketHelp",
        title: "On-ground support",
        titleLead: "On-ground",
        titleAccent: "Support",
        kicker: GUEST_GUIDE_KICKER,
        paragraphs: [
          "Don't worry - our team will be onsite to assist you.",
          "The Velocity team will hold a master guest list and ticket record throughout the event.",
          "If you cannot locate your digital ticket or experience an issue with your QR code, please speak to a member of the Velocity team at the welcome point.",
          "We will verify your details against our records and assist you with check-in.",
          "This is why it is particularly important that we receive accurate guest names and attendance days by 1 October.",
          "Should you require assistance before or during your visit, the Velocity team will be available throughout the weekend.",
        ],
        organisation: "Velocity Terrace / ZK Sports & Entertainment",
        contactName: "[NAME]",
        contactPhone: "[NUMBER]",
      },
      {
        key: "thingsToKnow",
        title: "Things to know",
        kicker: GUEST_GUIDE_KICKER,
        facts: [
          { label: "Opening hours", value: "Velocity Terrace hospitality runs from 5:00 PM - 11:00 PM each day." },
          {
            label: "Dietary requirements",
            value: "Please advise us of any dietary requirements or allergies no later than 28 September 2026.",
          },
          {
            label: "Digital ticket",
            value: "Your digital ticket and QR code are individual to you. Please do not share your QR code with another guest.",
          },
          {
            label: "Velocity credential",
            value: "Please keep your Velocity wristband/credential with you throughout your visit.",
          },
          {
            label: "Dress code",
            value: "We recommend a smart, polished and comfortable dress style suitable for premium rooftop hospitality.",
          },
          { label: "Weather", value: "Singapore is warm and humid, with the possibility of rain. Please dress accordingly." },
          { label: "Footwear", value: "Comfortable footwear is recommended." },
          {
            label: "Travel",
            value: "Please allow additional travel time due to Grand Prix traffic and road restrictions.",
          },
          {
            label: "Mobile phone",
            value: "Please arrive with sufficient phone battery and have your QR code saved or screenshotted before travelling to the venue.",
          },
          {
            label: "Smoking / vaping",
            value:
              "Smoking is not permitted at the venue and please keep in mind that vaping is considered illegal in Singapore and could carry a fine.",
          },
        ],
      },
      {
        key: "closing",
        title: "We look forward to welcoming you",
        titleLead: "We look forward to",
        titleAccent: "Welcoming you",
        kicker: GUEST_GUIDE_KICKER,
        facts: [
          { label: "Experience", value: "Velocity Terrace" },
          { label: "Event", value: "Singapore Grand Prix 2026" },
          { label: "Dates", value: "9-11 October 2026" },
          { label: "Location", value: "National Gallery Singapore | Padang Deck" },
          { label: "Hours", value: "5:00 PM - 11:00 PM" },
        ],
        highlight: "Incredible Racing  ·  Premium Hospitality  ·  Live DJ  ·  Spectacular Views",
        paragraphs: [
          "Please scan the QR code or click the link below.",
        ],
        linkLabel: "Velocity Terrace Singapore",
        linkUrl: VELOCITY_TERRACE_SINGAPORE_URL,
        qrImagePath: VELOCITY_TERRACE_DISCOVER_QR,
        mapImagePath: NATIONAL_GALLERY_SINGAPORE_MAP,
        mapUrl: NATIONAL_GALLERY_SINGAPORE_MAPS_URL,
      },
    ],
  }
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : ""
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => cleanText(item)).filter(Boolean)
}

function isPageKey(value: unknown): value is GuestGuidePageKey {
  return typeof value === "string" && (GUEST_GUIDE_PAGE_KEYS as readonly string[]).includes(value)
}

function isLegacyPageKey(value: unknown): value is (typeof LEGACY_GUEST_GUIDE_PAGE_KEYS)[number] {
  return typeof value === "string" && (LEGACY_GUEST_GUIDE_PAGE_KEYS as readonly string[]).includes(value)
}

export function pageHasContent(page: GuestGuidePage): boolean {
  if (cleanText(page.intro)) return true
  if ((page.paragraphs ?? []).some((item) => cleanText(item))) return true
  if ((page.dateBlocks ?? []).some((block) => cleanText(block.date) || cleanText(block.title) || cleanText(block.body))) {
    return true
  }
  if ((page.facts ?? []).some((fact) => fact.label.trim() || fact.value.trim())) return true
  if ((page.steps ?? []).some((step) => cleanText(step.title) || cleanText(step.body))) return true
  if ((page.bullets ?? []).some((item) => cleanText(item))) return true
  if ((page.sections ?? []).some((section) => cleanText(section.title) || cleanText(section.body))) return true
  if ((page.notes ?? []).some((item) => cleanText(item))) return true
  if (cleanText(page.linkLabel) || cleanText(page.linkUrl) || cleanText(page.qrImagePath)) return true
  if (cleanText(page.mapImagePath) || cleanText(page.mapUrl)) return true
  if (cleanText(page.organisation) || cleanText(page.contactName) || cleanText(page.contactPhone)) return true
  return Boolean(cleanText(page.highlight))
}

export function guestGuidePagePlan(content: GuestGuideContent): GuestGuidePageKey[] {
  return content.pages.filter(pageHasContent).map((page) => page.key)
}

function parsePage(raw: unknown, fallbackKey: GuestGuidePageKey): GuestGuidePage {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const key = isPageKey(record.key) ? record.key : fallbackKey
  const dateBlocks = Array.isArray(record.dateBlocks)
    ? record.dateBlocks.map((item) => {
        const block = item && typeof item === "object" ? (item as Record<string, unknown>) : {}
        return {
          date: cleanText(block.date),
          title: cleanText(block.title),
          body: cleanText(block.body),
          bullets: cleanList(block.bullets),
        }
      })
    : []
  const facts = Array.isArray(record.facts)
    ? record.facts.map((item) => {
        const fact = item && typeof item === "object" ? (item as Record<string, unknown>) : {}
        return { label: cleanText(fact.label), value: cleanText(fact.value) }
      })
    : []
  const steps = Array.isArray(record.steps)
    ? record.steps.map((item) => {
        const step = item && typeof item === "object" ? (item as Record<string, unknown>) : {}
        return { title: cleanText(step.title), body: cleanText(step.body) }
      })
    : []
  const sections = Array.isArray(record.sections)
    ? record.sections.map((item) => {
        const section = item && typeof item === "object" ? (item as Record<string, unknown>) : {}
        return {
          title: cleanText(section.title),
          body: cleanText(section.body),
          bullets: cleanList(section.bullets),
        }
      })
    : []

  return {
    key,
    title: cleanText(record.title) || DEFAULT_TITLES[key],
    titleLead: cleanText(record.titleLead) || undefined,
    titleAccent: cleanText(record.titleAccent) || undefined,
    kicker: cleanText(record.kicker) || GUEST_GUIDE_KICKER,
    intro: key === "arriving" ? undefined : cleanText(record.intro) || undefined,
    paragraphs: cleanList(record.paragraphs),
    dateBlocks,
    facts,
    steps,
    bullets: cleanList(record.bullets),
    sections,
    notes: cleanList(record.notes),
    linkLabel: cleanText(record.linkLabel) || undefined,
    linkUrl: cleanText(record.linkUrl) || undefined,
    qrImagePath: cleanText(record.qrImagePath) || undefined,
    mapImagePath: cleanText(record.mapImagePath) || undefined,
    mapUrl: cleanText(record.mapUrl) || undefined,
    organisation: cleanText(record.organisation) || undefined,
    contactName: cleanText(record.contactName) || undefined,
    contactPhone: cleanText(record.contactPhone) || undefined,
    highlight: cleanText(record.highlight) || undefined,
  }
}

function mergeIfEmpty(target: GuestGuidePage, source: GuestGuidePage, fields: Array<keyof GuestGuidePage>) {
  for (const field of fields) {
    const current = target[field]
    const next = source[field]
    if (typeof current === "string" && current.trim()) continue
    if (Array.isArray(current) && current.length > 0) continue
    if (next == null || next === "") continue
    ;(target as Record<string, unknown>)[field] = next
  }
}

export function parseGuestGuide(raw: unknown): GuestGuideContent | null {
  if (!raw || typeof raw !== "object") return null
  const record = raw as Record<string, unknown>
  const pagesRaw = Array.isArray(record.pages) ? record.pages : []
  if (pagesRaw.length === 0) return null
  const byKey = new Map<GuestGuidePageKey, GuestGuidePage>()
  const legacy = new Map<string, GuestGuidePage>()
  for (const item of pagesRaw) {
    const recordItem = item && typeof item === "object" ? (item as Record<string, unknown>) : {}
    if (isLegacyPageKey(recordItem.key)) {
      legacy.set(recordItem.key, parsePage({ ...recordItem, key: "closing" }, "closing"))
      continue
    }
    const key = isPageKey(recordItem.key) ? recordItem.key : null
    if (!key) continue
    byKey.set(key, parsePage(item, key))
  }

  const pages = GUEST_GUIDE_PAGE_KEYS.map((key) => byKey.get(key) ?? emptyGuestGuidePage(key))
  const ticketHelp = pages.find((page) => page.key === "ticketHelp")
  const closing = pages.find((page) => page.key === "closing")
  const legacySupport = legacy.get("support")
  const legacyDiscover = legacy.get("discover")
  if (ticketHelp && legacySupport) {
    mergeIfEmpty(ticketHelp, legacySupport, ["organisation", "contactName", "contactPhone"])
    if (!(ticketHelp.paragraphs ?? []).length && (legacySupport.paragraphs ?? []).length) {
      ticketHelp.paragraphs = legacySupport.paragraphs
    }
  }
  if (closing && legacyDiscover) {
    mergeIfEmpty(closing, legacyDiscover, ["linkLabel", "linkUrl", "qrImagePath"])
    if (!(closing.paragraphs ?? []).length && (legacyDiscover.paragraphs ?? []).length) {
      closing.paragraphs = legacyDiscover.paragraphs
    }
  }

  return { pages }
}

export function resolveGuestGuideContent(input: {
  stored: unknown
  incoming?: unknown
  productName: string
  raceName?: string | null
  location?: string | null
}): GuestGuideContent {
  const incoming = parseGuestGuide(input.incoming)
  const stored = parseGuestGuide(input.stored)
  const chosen = incoming ?? stored ?? emptyGuestGuideContent()
  if (guestGuidePagePlan(chosen).length > 0) return chosen
  if (matchesOfficialGuestGuide(input)) return officialSingaporeVelocityTerraceGuestGuide()
  return chosen
}

export type GuestGuideReadiness =
  | { ok: true }
  | { ok: false; code: BrochureCreateErrorCode; message: string }

export function assessGuestGuideReadiness(
  brochure: BrochureContent,
  guide: GuestGuideContent,
): GuestGuideReadiness {
  const photos = brochurePhotoCount(brochure)
  if (photos < MIN_BROCHURE_PHOTOS) {
    return {
      ok: false,
      code: "insufficient_images",
      message: `Add at least ${MIN_BROCHURE_PHOTOS} unique photos on this product (primary image plus gallery) before creating a guest guide. The cover uses the same photography as the sales brochure and will not invent images.`,
    }
  }

  const pages = guestGuidePagePlan(guide)
  if (!pages.includes("welcome")) {
    return {
      ok: false,
      code: "insufficient_content",
      message:
        "Add guest guide copy in the editor. Fill at least the welcome page, then complete the other pages you want guests to see. We will not invent itineraries, prices, or contact details.",
    }
  }
  if (pages.length < MIN_GUEST_GUIDE_PAGES) {
    return {
      ok: false,
      code: "insufficient_content",
      message: `Add copy for at least ${MIN_GUEST_GUIDE_PAGES} guest guide pages before generating. Empty pages are skipped, and we will not invent the missing sections.`,
    }
  }
  return { ok: true }
}
