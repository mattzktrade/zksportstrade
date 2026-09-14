import type { MarketingOutreachVars } from "@/lib/integrations/marketing-leads/outreach-types"

export const MARKETING_OUTREACH_COMPANY = "ZK Sports"

export const MARKETING_OUTREACH_PLACEHOLDERS = [
  "first_name",
  "full_name",
  "event",
  "package",
  "quantity",
  "company",
] as const

export function firstNameFromFullName(fullName: string): string {
  const token = fullName.trim().split(/\s+/).find(Boolean) ?? ""
  return token || "there"
}

export function outreachVarsFromSnapshot(input: {
  firstName?: string | null
  fullName?: string | null
  event?: string | null
  packageName?: string | null
  quantity?: number | null
}): MarketingOutreachVars {
  const fullName = input.fullName?.trim() || "there"
  const firstName = input.firstName?.trim() || firstNameFromFullName(fullName)
  const quantity =
    input.quantity && Number.isFinite(input.quantity) && input.quantity > 0
      ? String(Math.floor(input.quantity))
      : ""
  return {
    first_name: firstName,
    full_name: fullName,
    event: input.event?.trim() || "the event you asked about",
    package: input.packageName?.trim() || "hospitality",
    quantity,
    company: MARKETING_OUTREACH_COMPANY,
  }
}

export function listOutreachPlaceholders(template: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const re = /\{\{\s*([a-z_]+)\s*\}\}/gi
  for (const match of template.matchAll(re)) {
    const key = (match[1] ?? "").toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    found.push(key)
  }
  return found
}

export function renderOutreachTemplate(template: string, vars: MarketingOutreachVars): string {
  return template
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, rawKey: string) => {
      const key = rawKey.toLowerCase() as keyof MarketingOutreachVars
      return vars[key] ?? ""
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function outreachTemplateToMetaBody(template: string): string {
  const seen = new Map<string, number>()
  let index = 0
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, rawKey: string) => {
    const key = rawKey.toLowerCase()
    const existing = seen.get(key)
    if (existing) return `{{${existing}}}`
    index += 1
    seen.set(key, index)
    return `{{${index}}}`
  })
}

export function outreachWhatsAppParameters(template: string, vars: MarketingOutreachVars): string[] {
  return listOutreachPlaceholders(template).map((key) => {
    const value = vars[key as keyof MarketingOutreachVars] ?? ""
    return value.replace(/\s+/g, " ").trim() || "-"
  })
}

export function outreachPlainTextToHtml(text: string): string {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replaceAll("\n", "<br/>")}</p>`)
    .join("")
}
