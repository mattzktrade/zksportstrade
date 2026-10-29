export type MarketingLeadAnswer = {
  question: string
  answer: string
}

export type MarketingLeadPayload = {
  leadId: string
  createdAt: string | null
  campaign: {
    name: string | null
    id: string | null
    adsetName: string | null
    formName: string | null
  }
  contact: {
    fullName: string
    email: string | null
    phone: string | null
  }
  interest: {
    package: string | null
    quantity: number | null
    event: string | null
  }
  answers: MarketingLeadAnswer[]
  consent: {
    marketingOptIn: boolean | null
    privacyPolicyUrl: string | null
  }
  /** website = Abu Dhabi GP availability form. Absent means a Meta lead. */
  origin: "website" | null
  /** Staff email sent by the website form. Not used to assign: marketing leads arrive unassigned. */
  ownerEmail: string | null
}

export type MarketingLeadParseResult =
  | { ok: true; payload: MarketingLeadPayload }
  | { ok: false; error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const RESERVED_KEYS = new Set([
  "leadid",
  "lead_id",
  "leadgen_id",
  "id",
  "createdat",
  "created_at",
  "created_time",
  "campaign",
  "campaignname",
  "campaign_name",
  "campaignid",
  "campaign_id",
  "adsetname",
  "adset_name",
  "ad_name",
  "formname",
  "form_name",
  "contact",
  "fullname",
  "full_name",
  "name",
  "firstname",
  "first_name",
  "lastname",
  "last_name",
  "email",
  "email_address",
  "work_email",
  "phone",
  "phone_number",
  "work_phone_number",
  "mobile",
  "interest",
  "package",
  "product",
  "event",
  "quantity",
  "tickets",
  "how_many_tickets",
  "number_of_tickets",
  "answers",
  "field_data",
  "consent",
  "marketingoptin",
  "marketing_opt_in",
  "privacypolicyurl",
  "privacy_policy_url",
  "origin",
  "owneremail",
  "owner_email",
])

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function str(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "boolean") return value ? "true" : "false"
  if (Array.isArray(value) && value.length > 0) return str(value[0])
  return ""
}

function pick(record: Record<string, unknown> | null, ...keys: string[]): string {
  if (!record) return ""
  for (const key of keys) {
    if (key in record) {
      const value = str(record[key])
      if (value) return value
    }
    const found = Object.entries(record).find(([name]) => name.toLowerCase() === key.toLowerCase())
    if (found) {
      const value = str(found[1])
      if (value) return value
    }
  }
  return ""
}

function saneTicketQuantity(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  const qty = Math.floor(value)
  if (qty > 200) return null
  return qty
}

export function parseMarketingLeadQuantity(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return saneTicketQuantity(value)
  }
  const text = str(value)
  if (!text) return null
  const range = text.match(/(\d+)\s*(?:-|–|—|to|or|\/)\s*(\d+)/i)
  if (range) {
    return saneTicketQuantity(Math.max(Number(range[1]), Number(range[2])))
  }
  const upTo = text.match(/\bup\s*to\s*(\d+)\b/i)
  if (upTo) return saneTicketQuantity(Number(upTo[1]))
  const plus = text.match(/(\d+)\s*\+/)
  if (plus) return saneTicketQuantity(Number(plus[1]))
  const match = text.replace(/,/g, "").match(/(\d+)/)
  if (!match) return null
  return saneTicketQuantity(Number(match[1]))
}

function parseBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  const text = str(value).toLowerCase()
  if (!text) return null
  if (["true", "yes", "1", "y"].includes(text)) return true
  if (["false", "no", "0", "n"].includes(text)) return false
  return null
}

function fieldDataMap(body: Record<string, unknown>): Record<string, string> {
  const raw = body.field_data
  if (!Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const item of raw) {
    const row = asRecord(item)
    if (!row) continue
    const name = str(row.name).toLowerCase()
    const value = str(row.values) || str(row.value)
    if (name && value) out[name] = value
  }
  return out
}

function answersFromUnknown(value: unknown): MarketingLeadAnswer[] {
  if (!Array.isArray(value)) return []
  const answers: MarketingLeadAnswer[] = []
  for (const item of value) {
    const row = asRecord(item)
    if (!row) continue
    const question = str(row.question) || str(row.name) || str(row.key)
    const answer = str(row.answer) || str(row.value) || str(row.values)
    if (question || answer) answers.push({ question: question || "Answer", answer })
  }
  return answers
}

function leftoverAnswers(body: Record<string, unknown>, fields: Record<string, string>): MarketingLeadAnswer[] {
  const answers: MarketingLeadAnswer[] = []
  const seen = new Set<string>()
  function add(source: Record<string, unknown>) {
    for (const [key, raw] of Object.entries(source)) {
      const normalized = key.toLowerCase()
      if (RESERVED_KEYS.has(normalized) || seen.has(normalized)) continue
      if (raw && typeof raw === "object") continue
      const answer = str(raw)
      if (!answer) continue
      seen.add(normalized)
      answers.push({ question: key.replaceAll("_", " "), answer })
    }
  }
  add(body)
  add(fields)
  return answers
}

export function parseMarketingLeadWebhookBody(body: unknown): MarketingLeadParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Send a JSON object." }
  }
  const root = body as Record<string, unknown>
  const contactObj = asRecord(root.contact)
  const interestObj = asRecord(root.interest)
  const campaignObj = asRecord(root.campaign)
  const consentObj = asRecord(root.consent)
  const fields = fieldDataMap(root)

  const leadId =
    pick(root, "leadId", "lead_id", "leadgen_id") ||
    pick(root, "id") ||
    fields.id ||
    fields.leadgen_id
  if (!leadId) {
    return { ok: false, error: "leadId is required (Meta lead id)." }
  }

  const firstName =
    pick(contactObj, "firstName", "first_name") || pick(root, "firstName", "first_name") || fields.first_name
  const lastName =
    pick(contactObj, "lastName", "last_name") || pick(root, "lastName", "last_name") || fields.last_name
  const fullName =
    pick(contactObj, "fullName", "full_name", "name") ||
    pick(root, "fullName", "full_name", "name") ||
    fields.full_name ||
    fields.name ||
    [firstName, lastName].filter(Boolean).join(" ").trim()
  if (!fullName) {
    return { ok: false, error: "Contact name is required." }
  }

  const emailRaw = (
    pick(contactObj, "email", "email_address", "work_email") ||
    pick(root, "email", "email_address", "work_email") ||
    fields.email ||
    fields.email_address ||
    fields.work_email ||
    ""
  ).toLowerCase()
  const email = emailRaw || null
  if (email && !EMAIL_RE.test(email)) {
    return { ok: false, error: "Contact email is not valid." }
  }

  const phone =
    pick(contactObj, "phone", "phone_number", "mobile", "work_phone_number") ||
    pick(root, "phone", "phone_number", "mobile", "work_phone_number") ||
    fields.phone_number ||
    fields.phone ||
    fields.mobile ||
    fields.work_phone_number ||
    null
  if (!email && !phone) {
    return { ok: false, error: "Email or phone is required." }
  }

  const formName =
    pick(campaignObj, "formName", "form_name") ||
    pick(root, "formName", "form_name") ||
    fields.form_name ||
    null
  const campaignName = pick(campaignObj, "name") || pick(root, "campaignName", "campaign_name") || fields.campaign_name || null
  const rawPackage =
    pick(interestObj, "package", "product", "product_name", "which_package") ||
    pick(root, "package", "product", "product_name", "which_package") ||
    fields.package ||
    fields.product ||
    fields.product_name ||
    fields.which_package ||
    null
  const eventName =
    pick(interestObj, "event", "event_name", "which_event", "race", "grand_prix") ||
    pick(root, "event", "event_name", "which_event", "race", "grand_prix") ||
    fields.event ||
    fields.event_name ||
    fields.which_event ||
    fields.race ||
    fields.grand_prix ||
    null

  const explicitAnswers = answersFromUnknown(root.answers)
  const extras = leftoverAnswers(root, fields)
  const answers = [...explicitAnswers]
  for (const extra of extras) {
    if (answers.some((row) => row.question === extra.question && row.answer === extra.answer)) continue
    answers.push(extra)
  }

  const ticketChoice =
    answers.find((row) => isTicketChoiceQuestion(row.question))?.answer ||
    pick(root, "choose_your_tickets", "chooseYourTickets") ||
    (looksLikeTicketDayOption(rawPackage) ? rawPackage : "")
  const labeledPackage =
    rawPackage && !isUselessMarketingPackageLabel(rawPackage) && !looksLikeTicketDayOption(rawPackage)
      ? rawPackage
      : null
  const packageName = labeledPackage || marketingFormPackageHint(formName, campaignName, ticketChoice)

  let quantity =
    parseMarketingLeadQuantity(interestObj?.quantity) ??
    parseMarketingLeadQuantity(root.quantity) ??
    parseMarketingLeadQuantity(root.tickets) ??
    parseMarketingLeadQuantity(root.how_many_tickets) ??
    parseMarketingLeadQuantity(root.number_of_tickets) ??
    parseMarketingLeadQuantity(fields.quantity) ??
    parseMarketingLeadQuantity(fields.tickets) ??
    parseMarketingLeadQuantity(fields.how_many_tickets)
  if (quantity == null) {
    for (const row of answers) {
      const hay = `${row.question} ${row.answer}`
      if (!/guest|ticket|quantit|how many|count/i.test(hay)) continue
      if (looksLikeDurationNotQuantity(row.answer) || looksLikeDurationNotQuantity(row.question)) continue
      quantity = parseMarketingLeadQuantity(row.answer) ?? parseMarketingLeadQuantity(row.question)
      if (quantity != null) break
    }
  }

  const originRaw = pick(root, "origin").toLowerCase()
  const ownerEmailRaw = (
    pick(root, "ownerEmail", "owner_email") ||
    ""
  ).toLowerCase()

  return {
    ok: true,
    payload: {
      leadId,
      createdAt:
        pick(root, "createdAt", "created_at", "created_time") ||
        fields.created_time ||
        null,
      campaign: {
        name: campaignName,
        id: pick(campaignObj, "id") || pick(root, "campaignId", "campaign_id") || fields.campaign_id || null,
        adsetName:
          pick(campaignObj, "adsetName", "adset_name") ||
          pick(root, "adsetName", "adset_name", "ad_name") ||
          fields.adset_name ||
          null,
        formName,
      },
      contact: {
        fullName,
        email,
        phone,
      },
      interest: {
        package: packageName,
        quantity,
        event: eventName,
      },
      answers,
      consent: {
        marketingOptIn:
          parseBool(consentObj?.marketingOptIn) ??
          parseBool(consentObj?.marketing_opt_in) ??
          parseBool(root.marketingOptIn) ??
          parseBool(root.marketing_opt_in),
        privacyPolicyUrl:
          pick(consentObj, "privacyPolicyUrl", "privacy_policy_url") ||
          pick(root, "privacyPolicyUrl", "privacy_policy_url") ||
          null,
      },
      origin: originRaw === "website" ? "website" : null,
      ownerEmail: ownerEmailRaw && EMAIL_RE.test(ownerEmailRaw) ? ownerEmailRaw : null,
    },
  }
}

export function isUselessMarketingPackageLabel(value: string | null | undefined): boolean {
  const text = (value ?? "").trim()
  if (!text) return true
  if (/^[\\/.\-]+$/.test(text)) return true
  if (/^(yes|no|y|n|true|false|ok|okay|sure|none|n\/a|na)(\b|[.!,].*)?$/i.test(text)) return true
  return /works for me|that works/i.test(text) && !/\b(paddock|suite|terrace|hospitality|club)\b/i.test(text)
}

const MARSA_BY_DAY = {
  friday: "Friday Marsa Box by ZK",
  saturday: "Saturday Marsa Box by ZK",
  sunday: "Sunday Marsa Box by ZK",
  "2_day": "Saturday & Sunday Marsa Box by ZK",
  "3_day": "3 Day Marsa Box by ZK",
} as const

const SKYBRIDGE_BY_DAY = {
  friday: "Friday Skybridge Terrace",
  saturday: "Saturday Skybridge Terrace",
  sunday: "Sunday Skybridge Terrace",
  "2_day": "Saturday & Sunday Skybridge Terrace",
  "3_day": "3 Day Skybridge Terrace",
} as const

type MarketingFormDay = keyof typeof MARSA_BY_DAY
type MarketingFormFamily = "marsa" | "skybridge"

function marketingFormFamily(text: string): MarketingFormFamily | null {
  const normalized = normalizeMarketingAlias(text)
  if (/\bmarsa\s*box\b/.test(normalized) || /\bmarsabox\b/.test(normalized)) return "marsa"
  if (/\bsky\s*bridge\b/.test(normalized) || /\bskybridge\b/.test(normalized)) return "skybridge"
  return null
}

function marketingFormDay(text: string): MarketingFormDay | null {
  const normalized = normalizeMarketingAlias(text)
  if (!normalized) return null
  if (/\bsaturday\s*(and|&)?\s*sunday\b/.test(normalized) || /\bsat\s*sun\b/.test(normalized)) return "2_day"
  if (/\b3\s*day\b/.test(normalized)) return "3_day"
  if (/\b2\s*day\b/.test(normalized)) return "2_day"
  if (/\bfriday\b/.test(normalized)) return "friday"
  if (/\bsaturday\b/.test(normalized)) return "saturday"
  if (/\bsunday\b/.test(normalized)) return "sunday"
  if (/\bweekend\b/.test(normalized)) return "3_day"
  return null
}

export function isTicketChoiceQuestion(value: string): boolean {
  return /choose your tickets|choose_your_tickets|which (day|ticket)|ticket option/i.test(value)
}

export function looksLikeTicketDayOption(value: string | null | undefined): boolean {
  const text = (value ?? "").trim()
  if (!text || marketingFormDay(text) == null) return false
  const leftover = normalizeMarketingAlias(text)
    .replace(/\b(friday|saturday|sunday|thursday|weekend|day|days|and)\b/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return leftover.length === 0
}

/** Instant Form name (Marsa Box / Skybridge) plus Choose your tickets day option. */
export function marketingFormPackageHint(...values: Array<string | null | undefined>): string | null {
  const text = values.filter((value) => Boolean(value && value.trim())).join(" ")
  if (!text) return null
  const family = marketingFormFamily(text)
  if (!family) return null
  const day = marketingFormDay(text) ?? "3_day"
  return family === "marsa" ? MARSA_BY_DAY[day] : SKYBRIDGE_BY_DAY[day]
}

function looksLikeDurationNotQuantity(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  if (/\b(guests?|tickets?|people|persons?)\b/i.test(text) && !/\b\d+\s*-?\s*day\b/i.test(text)) return false
  if (/=\s*[$£€]/.test(text)) return true
  return /^\d+\s*-?\s*day\b/i.test(text)
}

export function normalizeMarketingAlias(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

export function normalizeMarketingPhone(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "")
}

export function formatMarketingLeadNotes(payload: MarketingLeadPayload): string {
  const lines: string[] = [payload.origin === "website" ? "Website enquiry" : "Marketing lead (Meta)"]
  const campaignBits = [
    payload.campaign.name ? `Campaign: ${payload.campaign.name}` : "",
    payload.campaign.adsetName ? `Ad set: ${payload.campaign.adsetName}` : "",
    payload.campaign.formName ? `Form: ${payload.campaign.formName}` : "",
    payload.campaign.id ? `Campaign id: ${payload.campaign.id}` : "",
  ].filter(Boolean)
  lines.push(...campaignBits)
  if (payload.interest.package) lines.push(`Package: ${payload.interest.package}`)
  if (payload.interest.event) lines.push(`Event: ${payload.interest.event}`)
  if (payload.interest.quantity != null) lines.push(`Tickets: ${payload.interest.quantity}`)
  if (payload.consent.marketingOptIn != null) {
    lines.push(`Marketing opt-in: ${payload.consent.marketingOptIn ? "yes" : "no"}`)
  }
  if (payload.consent.privacyPolicyUrl) {
    lines.push(`Privacy policy: ${payload.consent.privacyPolicyUrl}`)
  }
  if (payload.createdAt) lines.push(`Submitted: ${payload.createdAt}`)
  lines.push(`${payload.origin === "website" ? "Lead id" : "Meta lead id"}: ${payload.leadId}`)
  if (payload.answers.length > 0) {
    lines.push("")
    for (const answer of payload.answers) {
      lines.push(`${answer.question}: ${answer.answer}`)
    }
  }
  return lines.join("\n").trim()
}
