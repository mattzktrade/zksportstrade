export const CONTRACT_LINK_DAYS = 30

export const CONTRACT_SIGNATURE_CONSENT =
  "I confirm I am authorised to accept these booking inclusions for the company named above, and I agree that my electronic signature is valid."

export type ContractSection = {
  id: string
  heading: string
  bullets: string[]
}

export type ContractContent = {
  event: string
  dates: string
  operatingHours: string
  guestAllocation: string
  sections: ContractSection[]
  confirmationIntro: string
}

export type ContractDraft = {
  title: string
  companyName: string
  clientName: string
  clientEmail: string
  content: ContractContent
}

export type ContractStatus = "draft" | "sent" | "viewed" | "signed" | "declined" | "voided"

const LIMITS = {
  title: 180,
  company: 180,
  name: 160,
  email: 320,
  fact: 400,
  heading: 160,
  bullet: 600,
  intro: 800,
  sections: 16,
  bullets: 20,
}

export function blankContractContent(): ContractContent {
  return {
    event: "",
    dates: "",
    operatingHours: "",
    guestAllocation: "",
    sections: [{ id: "section-1", heading: "Inclusions", bullets: [""] }],
    confirmationIntro:
      "By signing below, the authorised representative confirms acceptance of the booking inclusions above.",
  }
}

export function syHoldingsContractTitle(): string {
  return "SY HOLDINGS – BOOKING INCLUSIONS"
}

export function syHoldingsContractContent(): ContractContent {
  return {
    event: "Singapore Grand Prix 2026 – Velocity Terrace, National Gallery Rooftop",
    dates: "Saturday 10 & Sunday 11 October 2026",
    operatingHours: "5:00 PM–11:00 PM daily",
    guestAllocation: "Up to 100 SY guests",
    confirmationIntro:
      "By signing below, the authorised SY Holdings representative confirms acceptance of the booking inclusions above.",
    sections: [
      {
        id: "terrace",
        heading: "Private Terrace & Access",
        bullets: [
          "Exclusive use of the dedicated SY Private Terrace, securely separated from the wider venue.",
          "Access to both the SY Private Terrace and the wider Velocity Terrace during event operating hours.",
        ],
      },
      {
        id: "staffing",
        heading: "Dedicated Staffing",
        bullets: [
          "10 hospitality staff assigned exclusively to the SY Private Terrace.",
          "Dedicated SY guest host supporting check-in and guest service.",
          "Dedicated private-terrace barman and security guard controlling access.",
        ],
      },
      {
        id: "branding",
        heading: "Branding & Sponsorship",
        bullets: [
          "SY branding at reception/check-in, private bar, terrace signage and additional venue and private-terrace touchpoints.",
          "Co-branded media wall for guest photography.",
          "SY-branded credentials, lanyards and exclusive VIP wristbands.",
          "SY branding within guest information, the customer journey, the Velocity Terrace website and relevant digital communications.",
          "25% of available shared venue-screen rotation during Saturday and Sunday operating hours.",
        ],
      },
      {
        id: "food",
        heading: "Food & Beverage",
        bullets: [
          "Premium catering across the Velocity Terrace and SY Private Terrace.",
          "Upgraded premium drinks package at the dedicated SY private bar, with a premium mixologist supporting the existing bar team.",
          "Appropriate glassware; no standard plastic or paper drinking cups.",
          "SY may supply a small selection of premium whisky for selected guests, subject to agreed venue procedures.",
          "Full menus, beverage selections and associated provisions as detailed in the Hospitality & Sponsorship Deliverables Agreement sent to Darrell on 1 October 2026.",
        ],
      },
      {
        id: "arrival",
        heading: "Guest Information & Arrival",
        bullets: [
          "SY-branded guest information covering recommended drop-off points, National Gallery entrance, arrival map and directions, welcome/registration point, wristband and credential collection, and private-terrace access.",
          "Operating hours, entertainment schedule, food and beverage information, and on-site contact and escalation details.",
          "Co-branded event information/landing page for wider Velocity Terrace guests.",
        ],
      },
      {
        id: "entertainment",
        heading: "Entertainment",
        bullets: [
          "Resident DJ and special guest DJ sets from Alec Monopoly.",
          "Live saxophonist performances during selected periods.",
          "Professional close-up magician within the SY Private Terrace.",
          "Opportunity for SY to provide a preferred Spotify playlist, with reasonable guest song requests accommodated where appropriate.",
        ],
      },
      {
        id: "photography",
        heading: "Photography",
        bullets: [
          "SY may appoint its own private photographer; accreditation will be arranged subject to the required details being supplied.",
          "The agreed sponsorship fee reflects the deduction of the previously agreed photography fee.",
        ],
      },
    ],
  }
}

function clip(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max)
}

function newSectionId(index: number): string {
  return `section-${index + 1}`
}

export function normalizeContractContent(value: unknown): ContractContent {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const rawSections = Array.isArray(source.sections) ? source.sections : []
  const sections: ContractSection[] = []
  for (const raw of rawSections.slice(0, LIMITS.sections)) {
    if (!raw || typeof raw !== "object") continue
    const section = raw as Record<string, unknown>
    const heading = clip(section.heading, LIMITS.heading)
    const bullets = (Array.isArray(section.bullets) ? section.bullets : [])
      .map((bullet) => clip(bullet, LIMITS.bullet))
      .filter(Boolean)
      .slice(0, LIMITS.bullets)
    if (!heading && bullets.length === 0) continue
    const id = clip(section.id, 40) || newSectionId(sections.length)
    sections.push({ id, heading, bullets })
  }
  return {
    event: clip(source.event, LIMITS.fact),
    dates: clip(source.dates, LIMITS.fact),
    operatingHours: clip(source.operatingHours, LIMITS.fact),
    guestAllocation: clip(source.guestAllocation, LIMITS.fact),
    sections,
    confirmationIntro: clip(source.confirmationIntro, LIMITS.intro),
  }
}

export function normalizeContractDraft(input: ContractDraft): ContractDraft {
  return {
    title: clip(input.title, LIMITS.title),
    companyName: clip(input.companyName, LIMITS.company),
    clientName: clip(input.clientName, LIMITS.name),
    clientEmail: clip(input.clientEmail, LIMITS.email).toLowerCase(),
    content: normalizeContractContent(input.content),
  }
}

export function isContractEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function contractSaveError(draft: ContractDraft): string | null {
  if (draft.title.trim().length < 3) return "Add a contract title."
  return null
}

export function contractSendError(draft: ContractDraft): string | null {
  const saveError = contractSaveError(draft)
  if (saveError) return saveError
  if (draft.companyName.trim().length < 2) return "Add the client company."
  if (draft.clientName.trim().length < 2) return "Add the person who should receive the contract."
  if (!isContractEmail(draft.clientEmail)) return "Add a valid email address for the recipient."
  if (draft.content.event.trim().length < 3) return "Add the event."
  if (draft.content.dates.trim().length < 3) return "Add the dates."
  if (draft.content.sections.length === 0) return "Add at least one inclusion section."
  for (const [index, section] of draft.content.sections.entries()) {
    const label = section.heading.trim() || `Section ${index + 1}`
    if (!section.heading.trim()) return `Add a heading for ${label}.`
    if (section.bullets.length === 0) return `Add at least one point under ${label}.`
  }
  if (draft.content.confirmationIntro.trim().length < 12) {
    return "Add the sentence above the signature."
  }
  return null
}

export function contractLinkExpired(status: string, expiresAt: string | null, now = Date.now()): boolean {
  if (status !== "sent" && status !== "viewed") return false
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() <= now
}

export function contractStatusLabel(status: string, expiresAt: string | null, now = Date.now()): string {
  if (contractLinkExpired(status, expiresAt, now)) return "Link expired"
  switch (status) {
    case "draft":
      return "Draft"
    case "sent":
      return "Sent"
    case "viewed":
      return "Opened"
    case "signed":
      return "Signed"
    case "declined":
      return "Declined"
    case "voided":
      return "Voided"
    default:
      return status
  }
}

export function contractIsEditable(status: string): boolean {
  return status === "draft" || status === "sent" || status === "viewed"
}

const PDF_CHAR_MAP: Record<string, string> = {
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2013": "-",
  "\u2014": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u2022": "-",
  "\u00a0": " ",
  "\u202f": " ",
  "\u2060": "",
  "\u00b7": "-",
  "\u2026": "...",
}

/** WinAnsi-safe text for pdf-lib's standard fonts. */
export function pdfSafe(value: string): string {
  let out = ""
  for (const char of value) {
    const mapped = PDF_CHAR_MAP[char]
    if (mapped !== undefined) {
      out += mapped
      continue
    }
    const code = char.charCodeAt(0)
    if (code === 10 || (code >= 32 && code <= 126)) out += char
    else out += " "
  }
  return out.replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").trim()
}
