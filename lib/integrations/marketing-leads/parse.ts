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

function parseQuantity(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const qty = Math.floor(value)
    return qty > 0 ? qty : null
  }
  const text = str(value)
  if (!text) return null
  const match = text.replace(/,/g, "").match(/(\d+)/)
  if (!match) return null
  const qty = Number(match[1])
  return Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : null
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

  const quantity =
    parseQuantity(interestObj?.quantity) ??
    parseQuantity(root.quantity) ??
    parseQuantity(root.tickets) ??
    parseQuantity(root.how_many_tickets) ??
    parseQuantity(root.number_of_tickets) ??
    parseQuantity(fields.quantity) ??
    parseQuantity(fields.tickets) ??
    parseQuantity(fields.how_many_tickets)

  const packageName =
    pick(interestObj, "package", "product") ||
    pick(root, "package", "product") ||
    fields.package ||
    fields.product ||
    null
  const eventName =
    pick(interestObj, "event") || pick(root, "event") || fields.event || null

  const explicitAnswers = answersFromUnknown(root.answers)
  const extras = leftoverAnswers(root, fields)
  const answers = [...explicitAnswers]
  for (const extra of extras) {
    if (answers.some((row) => row.question === extra.question && row.answer === extra.answer)) continue
    answers.push(extra)
  }

  return {
    ok: true,
    payload: {
      leadId,
      createdAt:
        pick(root, "createdAt", "created_at", "created_time") ||
        fields.created_time ||
        null,
      campaign: {
        name: pick(campaignObj, "name") || pick(root, "campaignName", "campaign_name") || fields.campaign_name || null,
        id: pick(campaignObj, "id") || pick(root, "campaignId", "campaign_id") || fields.campaign_id || null,
        adsetName:
          pick(campaignObj, "adsetName", "adset_name") ||
          pick(root, "adsetName", "adset_name", "ad_name") ||
          fields.adset_name ||
          null,
        formName:
          pick(campaignObj, "formName", "form_name") ||
          pick(root, "formName", "form_name") ||
          fields.form_name ||
          null,
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
    },
  }
}

export function normalizeMarketingAlias(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

export function normalizeMarketingPhone(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "")
}

export function formatMarketingLeadNotes(payload: MarketingLeadPayload): string {
  const lines: string[] = ["Marketing lead (Meta)"]
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
  lines.push(`Meta lead id: ${payload.leadId}`)
  if (payload.answers.length > 0) {
    lines.push("")
    for (const answer of payload.answers) {
      lines.push(`${answer.question}: ${answer.answer}`)
    }
  }
  return lines.join("\n").trim()
}
