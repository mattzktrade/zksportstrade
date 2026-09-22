export const GUEST_GUIDE_PAGE_KEYS = [
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
] as const

export const LEGACY_GUEST_GUIDE_PAGE_KEYS = ["discover", "support"] as const

export type GuestGuidePageKey = (typeof GUEST_GUIDE_PAGE_KEYS)[number]

export type GuestGuideFact = {
  label: string
  value: string
}

export type GuestGuideStep = {
  title: string
  body: string
}

export type GuestGuideDateBlock = {
  date: string
  title: string
  body: string
  bullets?: string[]
}

export type GuestGuideSection = {
  title: string
  body: string
  bullets?: string[]
}

export type GuestGuidePage = {
  key: GuestGuidePageKey
  title: string
  titleLead?: string
  titleAccent?: string
  kicker?: string
  intro?: string
  paragraphs?: string[]
  dateBlocks?: GuestGuideDateBlock[]
  facts?: GuestGuideFact[]
  steps?: GuestGuideStep[]
  bullets?: string[]
  sections?: GuestGuideSection[]
  notes?: string[]
  linkLabel?: string
  linkUrl?: string
  qrImagePath?: string
  organisation?: string
  contactName?: string
  contactPhone?: string
  highlight?: string
}

export type GuestGuideContent = {
  pages: GuestGuidePage[]
}

export type GuestGuideCreateResult =
  | { ok: true; guestGuideUrl: string; filename: string; replaced: boolean }
  | {
      ok: false
      message: string
      code?: "exists" | "forbidden" | "missing" | "insufficient_images" | "insufficient_content"
      guestGuideUrl?: string
    }
