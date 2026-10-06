import {
  MIN_BROCHURE_DESCRIPTION,
  MIN_BROCHURE_INCLUDES,
  MIN_BROCHURE_PHOTOS,
} from "@/lib/brochures/readiness"
import { uniqueImageUrls } from "@/lib/brochures/text"
import { answeredPackageFaqs, parsePackageFaqs } from "@/lib/catalog/package-faqs"
import { assistantPhoneDigits, normalizeAssistantEmail } from "@/lib/assistant/phone"

export const MIN_ASSISTANT_FAQS = 4

export type CatalogReadinessRow = {
  id: string
  name: string
  raceName: string
  eventDate: string | null
  hidden: boolean
  shell: boolean
  description: string
  includes: string[]
  photoCount: number
  answeredFaqs: number
  brochureUrl: string | null
}

export type CatalogReadinessIssue = {
  id: string
  name: string
  raceName: string
  missing: string[]
  href: string
}

export type ContactReadinessRow = {
  id: string
  accountId: string
  accountName: string
  fullName: string
  email: string | null
  phone: string | null
  href: string
}

export function parseIncludes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => String(item).trim()).filter(Boolean)
}

export function assessCatalogRow(row: {
  id: string
  name: string
  raceName: string
  description: string | null
  includes: unknown
  faqs: unknown
  image: string | null
  galleryImages: unknown
  brochureUrl: string | null
}): { missing: string[] } {
  const missing: string[] = []
  const description = (row.description ?? "").trim()
  const includes = parseIncludes(row.includes)
  const gallery = Array.isArray(row.galleryImages)
    ? row.galleryImages.map((item) => String(item).trim()).filter(Boolean)
    : []
  const photos = uniqueImageUrls(row.image, gallery).length
  const faqs = answeredPackageFaqs(parsePackageFaqs(row.faqs)).length

  if (description.length < MIN_BROCHURE_DESCRIPTION) missing.push("short description")
  if (includes.length < MIN_BROCHURE_INCLUDES) missing.push(`at least ${MIN_BROCHURE_INCLUDES} inclusions`)
  if (photos < MIN_BROCHURE_PHOTOS) missing.push(`at least ${MIN_BROCHURE_PHOTOS} unique photos`)
  if (faqs < MIN_ASSISTANT_FAQS) missing.push(`at least ${MIN_ASSISTANT_FAQS} answered FAQs`)
  if (!row.brochureUrl?.trim()) missing.push("brochure PDF")
  return { missing }
}

export function catalogReadinessIssues(
  rows: Array<Parameters<typeof assessCatalogRow>[0] & { hidden?: boolean; shell?: boolean }>,
): CatalogReadinessIssue[] {
  const issues: CatalogReadinessIssue[] = []
  for (const row of rows) {
    if (row.hidden || row.shell) continue
    const { missing } = assessCatalogRow(row)
    if (missing.length === 0) continue
    issues.push({
      id: row.id,
      name: row.name,
      raceName: row.raceName,
      missing,
      href: `/admin/catalog/${row.id}`,
    })
  }
  return issues
}

export function contactMissingPhone(row: {
  id: string
  accountId: string
  accountName: string
  fullName: string
  email: string | null
  phone: string | null
}): ContactReadinessRow | null {
  const digits = assistantPhoneDigits(row.phone)
  if (digits.length >= 8) return null
  return {
    ...row,
    email: normalizeAssistantEmail(row.email),
    href: `/admin/clients/${row.accountId}/contacts/${row.id}`,
  }
}

export function summarizeReadiness(input: {
  catalogIssues: CatalogReadinessIssue[]
  catalogChecked: number
  contactsMissingPhone: number
  contactsChecked: number
  policyArticle: boolean
}): { ready: boolean; headline: string; details: string[] } {
  const details: string[] = []
  if (input.catalogIssues.length > 0) {
    details.push(`${input.catalogIssues.length} of ${input.catalogChecked} sellable products are missing copy, photos, FAQs, or a brochure.`)
  }
  if (input.contactsMissingPhone > 0) {
    details.push(`${input.contactsMissingPhone} of ${input.contactsChecked} contacts have no usable WhatsApp number.`)
  }
  if (!input.policyArticle) {
    details.push("The sales policy article is missing from the knowledge base.")
  }
  if (details.length === 0) {
    return {
      ready: true,
      headline: "The knowledge base is ready for the assistant.",
      details: ["Products have copy, photos, FAQs and brochures. Contacts have phone numbers. The sales policy is in place."],
    }
  }
  return {
    ready: false,
    headline: "Finish this list before turning auto-send on.",
    details,
  }
}
