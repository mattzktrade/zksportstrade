import type { SupabaseClient } from "@supabase/supabase-js"
import { packageDurationLabel } from "@/lib/catalog/package-duration"
import { findPackageTemplate } from "@/lib/catalog/package-templates"

export type PackageFaq = {
  id: string
  question: string
  answer: string
}

export type PackageFaqSource = {
  name: string
  raceName?: string
  circuit: string
  location: string
  country: string
  eventDate: string
  dateRange: string
  duration?: string | null
  description: string
  includes: string[]
  currency: string
  tradePrice: number | null
  isEnquiry: boolean
  brochureUrl?: string | null
}

const MAX_FAQS = 40
const MAX_QUESTION = 300
const MAX_ANSWER = 2000

export function parsePackageFaqs(raw: unknown): PackageFaq[] {
  if (!Array.isArray(raw)) return []
  const faqs: PackageFaq[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const record = item as { id?: unknown; question?: unknown; answer?: unknown }
    const question = typeof record.question === "string" ? record.question.trim().slice(0, MAX_QUESTION) : ""
    if (!question) continue
    const answer = typeof record.answer === "string" ? record.answer.trim().slice(0, MAX_ANSWER) : ""
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim().slice(0, 80) : `custom-${faqs.length + 1}`
    faqs.push({ id, question, answer })
    if (faqs.length >= MAX_FAQS) break
  }
  return faqs
}

export function answeredPackageFaqs(faqs: PackageFaq[]): PackageFaq[] {
  return faqs.filter((faq) => faq.answer.trim().length > 0)
}

export async function loadPackageFaqs(
  supabase: SupabaseClient,
  packageIds: string[],
): Promise<Map<string, unknown>> {
  const ids = [...new Set(packageIds.map((id) => id.trim()).filter(Boolean))]
  const out = new Map<string, unknown>()
  if (ids.length === 0) return out
  const { data, error } = await supabase.from("packages").select("id, faqs").in("id", ids)
  if (error) return out
  for (const row of data ?? []) {
    const record = row as { id?: string; faqs?: unknown }
    if (record.id) out.set(record.id, record.faqs ?? [])
  }
  return out
}

/** Questions a first-time agent would ask, with answers only where the product already has them. */
export function suggestedPackageFaqs(source: PackageFaqSource): PackageFaq[] {
  const copy = [source.description, ...source.includes].join("\n")
  const when = source.dateRange.trim() || source.eventDate.trim()
  const where = [source.circuit, source.location, source.country].map((part) => part.trim()).filter(Boolean)
  const days = packageDurationLabel(source.duration)
  const programme = programmeAnswer(source.name)
  const f1 = isFormulaOne(source)

  const faqs: PackageFaq[] = [
    {
      id: "what-is-it",
      question: "What is this package?",
      answer: source.description.trim() || programme,
    },
    {
      id: "included",
      question: "What is included?",
      answer: source.includes.map((item) => item.trim()).filter(Boolean).join("\n"),
    },
    {
      id: "days",
      question: "Which days does this package cover?",
      answer: [days, when].filter(Boolean).join(". "),
    },
    {
      id: "where-watch",
      question: "Where do guests watch from, and what will they see?",
      answer: matchingLines(copy, /view|suite|terrace|grandstand|lounge|paddock|trackside|seating|stand\b/i),
    },
    {
      id: "food",
      question: "Is food and drink included?",
      answer: matchingLines(copy, /food|dining|dinner|lunch|breakfast|canap|cuisine|beverage|drinks?|open bar|wine|beer/i),
    },
    {
      id: "travel",
      question: "Are hotels, flights, or transfers included?",
      answer: matchingLines(copy, /hotel|flight|transfer|airport|accommodation/i),
    },
    {
      id: "brochure",
      question: "Is there a brochure I can send my client?",
      answer: source.brochureUrl?.trim() ? "Yes. Download the brochure from this product page and send it to your client." : "",
    },
    {
      id: "booking",
      question: "How do I book this, and what price do I pay?",
      answer: bookingAnswer(source),
    },
    {
      id: "where-race",
      question: "Where is the race?",
      answer: where.join(", "),
    },
    {
      id: "when",
      question: "When is the event?",
      answer: when,
    },
  ]

  if (f1) {
    faqs.push({
      id: "weekend",
      question: "What happens on a Formula 1 weekend?",
      answer:
        "A Formula 1 weekend is usually three days. Friday is practice, Saturday is qualifying, and Sunday is the race. Some weekends also have a sprint. This package only includes the days listed for it, so check those before confirming a full weekend with your client.",
    })
  }

  if (programme) {
    faqs.push({
      id: "programme",
      question: programmeQuestion(source.name),
      answer: programme,
    })
  }

  faqs.push(
    {
      id: "dress",
      question: "What should my client wear?",
      answer: "",
    },
    {
      id: "children",
      question: "Are children allowed?",
      answer: "",
    },
    {
      id: "tickets",
      question: "When will my client receive tickets or entry details?",
      answer: "",
    },
    {
      id: "getting-there",
      question: "How do guests get to the venue?",
      answer: matchingLines(copy, /shuttle|parking|metro|taxi|get there|directions/i),
    },
  )

  return faqs
}

export function mergePackageFaqs(saved: PackageFaq[], suggested: PackageFaq[]): PackageFaq[] {
  const savedById = new Map(saved.map((faq) => [faq.id, faq]))
  const merged = suggested.map((faq) => {
    const existing = savedById.get(faq.id)
    if (!existing) return faq
    return {
      id: faq.id,
      question: existing.question.trim() || faq.question,
      answer: existing.answer,
    }
  })
  for (const faq of saved) {
    if (!suggested.some((item) => item.id === faq.id)) merged.push(faq)
  }
  return merged.slice(0, MAX_FAQS)
}

/** Fill answers that are still empty. Staff-written answers stay as they are. */
export function fillEmptyFaqAnswers(current: PackageFaq[], source: PackageFaqSource): PackageFaq[] {
  const suggested = new Map(suggestedPackageFaqs(source).map((faq) => [faq.id, faq.answer]))
  return current.map((faq) => {
    if (faq.answer.trim()) return faq
    const answer = suggested.get(faq.id)?.trim() ?? ""
    return answer ? { ...faq, answer } : faq
  })
}

function bookingAnswer(source: PackageFaqSource): string {
  if (source.isEnquiry || source.tradePrice == null) {
    return "This package is priced on enquiry. Contact ZK with the product name and your guest numbers for a quote."
  }
  const currency = source.currency.trim() || "USD"
  const amount = source.tradePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return `The trade price shown on this page is ${currency} ${amount} per person. Book it from this product page. That price is your trade rate, not a retail price for your client.`
}

function programmeAnswer(name: string): string {
  const normalized = name.toLowerCase()
  if (normalized.includes("house 44")) return findPackageTemplate("3-day-house-44")?.description ?? ""
  if (normalized.includes("paddock club")) return findPackageTemplate("3-day-paddock")?.description ?? ""
  if (normalized.includes("champions club")) return findPackageTemplate("3-day-champions")?.description ?? ""
  return ""
}

function programmeQuestion(name: string): string {
  if (/house 44/i.test(name)) return "What is House 44?"
  if (/paddock club/i.test(name)) return "What is F1 Paddock Club?"
  if (/champions club/i.test(name)) return "What is Champions Club?"
  return "What kind of hospitality is this?"
}

function isFormulaOne(source: PackageFaqSource): boolean {
  const text = `${source.name} ${source.raceName ?? ""} ${source.circuit}`.toLowerCase()
  return /formula\s*1|\bf1\b|grand prix|paddock club|champions club/.test(text)
}

function matchingLines(copy: string, pattern: RegExp): string {
  const lines = copy
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  const hits = lines.filter((line) => pattern.test(line))
  return [...new Set(hits)].join("\n")
}
