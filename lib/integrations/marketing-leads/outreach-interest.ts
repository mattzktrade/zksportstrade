import { eventSeasonLabel } from "@/lib/catalog/event-label"
import {
  isAffirmativeAnswer,
  isProductLikeText,
  looksLikeUselessInterestLabel,
  pickMarketingPackage,
  pickMarketingRace,
} from "@/lib/integrations/marketing-leads/match"
import { eventAndPackageFromEnquiryNotes } from "@/lib/integrations/marketing-leads/outreach-render"
import { marketingFormPackageHint } from "@/lib/integrations/marketing-leads/parse"
import type { createAdminClient } from "@/lib/supabase/admin"

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>

export function isCustomerFacingPackageName(name: string | null | undefined): boolean {
  const text = name?.trim() || ""
  if (!text) return false
  if (/single ticket/i.test(text)) return false
  if (/[–-]\s*(friday|saturday|sunday)\b/i.test(text)) return false
  return true
}

export function eventQueriesFromNotes(notes: string | null | undefined): string[] {
  const queries: string[] = []
  const labeled = eventAndPackageFromEnquiryNotes(notes).event
  if (labeled && !looksLikeUselessInterestLabel(labeled)) queries.push(labeled)
  for (const line of (notes ?? "").split("\n")) {
    const match = /^(Campaign|Ad set|Form|Event):\s*(.+)$/i.exec(line.trim())
    if (match?.[2]) queries.push(match[2].trim())
  }
  return queries
}

export function packageQueriesFromNotes(notes: string | null | undefined): string[] {
  const queries: string[] = []
  const labeled = eventAndPackageFromEnquiryNotes(notes).packageName
  if (labeled && isProductLikeText(labeled) && !looksLikeUselessInterestLabel(labeled)) {
    queries.push(labeled)
  }
  for (const line of (notes ?? "").split("\n")) {
    const match = /^(.+?):\s*(.+)$/.exec(line.trim())
    if (!match) continue
    const question = match[1].trim()
    const answer = match[2].trim()
    if (/^(marketing lead|campaign|ad set|form|campaign id|tickets|event|package|submitted|meta lead|privacy|marketing opt)/i.test(question)) {
      continue
    }
    if (isProductLikeText(question) && (isAffirmativeAnswer(answer) || looksLikeUselessInterestLabel(answer))) {
      queries.push(question)
    } else if (isProductLikeText(answer) && !looksLikeUselessInterestLabel(answer)) {
      queries.push(answer)
    }
  }
  const form = /(?:^|\n)Form:\s*(.+)/i.exec(notes ?? "")?.[1]?.trim() || ""
  const ticket =
    notes
      ?.split("\n")
      .map((line) => /^(.+?):\s*(.+)$/.exec(line.trim()))
      .find((row) => row && /choose your tickets/i.test(row[1]))?.[2]
      ?.trim() || ""
  const hint = marketingFormPackageHint(form, ticket)
  if (hint) queries.unshift(hint)
  return queries
}

export function usefulPackageLabelFromNotes(notes: string | null | undefined): string | null {
  const queries = packageQueriesFromNotes(notes)
  return queries[0] ?? null
}

export function resolveOutreachInterest(input: {
  raceName?: string | null
  raceSeason?: number | null
  catalogPackageNames?: string[]
  rematchedPackageName?: string | null
  notes?: string | null
}): { event: string | null; packageName: string | null } {
  const event =
    (input.raceName?.trim() ? eventSeasonLabel(input.raceName, input.raceSeason) : null) ||
    eventAndPackageFromEnquiryNotes(input.notes).event ||
    null
  const facing = (input.catalogPackageNames ?? []).filter(isCustomerFacingPackageName)
  const packageName =
    input.rematchedPackageName?.trim() ||
    (facing.length === 1 ? facing[0] : null) ||
    usefulPackageLabelFromNotes(input.notes) ||
    null
  return { event, packageName }
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

export async function resolveOutreachInterestForDeal(
  admin: AdminClient,
  dealId: string,
): Promise<{ event: string | null; packageName: string | null; quantity: number | null }> {
  const { data: deal } = await admin
    .from("deals")
    .select(
      `
      id, race_id, notes,
      races ( name, season ),
      deal_line_items ( quantity, packages ( id, name, races ( name, season ) ) )
    `,
    )
    .eq("id", dealId)
    .maybeSingle()

  const notes = typeof deal?.notes === "string" ? deal.notes : null
  const lines = asArray(deal?.deal_line_items)
  const catalogPackageNames = lines
    .map((line) => one((line as { packages?: { name?: string } | { name?: string }[] | null }).packages)?.name)
    .filter((name): name is string => Boolean(name))
  const quantity = lines
    .map((line) => Number((line as { quantity?: number | null }).quantity))
    .find((value) => Number.isFinite(value) && value > 0) ?? null
  const lineRace = one(
    one((lines[0] as { packages?: { races?: unknown } | { races?: unknown }[] | null } | undefined)?.packages)?.races as
      | { name: string; season: number }
      | { name: string; season: number }[]
      | null,
  )
  const dealRace = one(deal?.races as { name: string; season: number } | { name: string; season: number }[] | null)
  let race = lineRace ?? dealRace

  if (!race) {
    const { data: races } = await admin
      .from("races")
      .select("id, name, season, location, country, short_name")
      .limit(500)
    const picked = pickMarketingRace(eventQueriesFromNotes(notes), races ?? [])
    if (picked) race = { name: picked.name, season: picked.season ?? 0 }
  }

  const raceId = typeof deal?.race_id === "string" ? deal.race_id : null
  const queries = packageQueriesFromNotes(notes)
  let rematchedPackageName: string | null = null
  if (queries.length > 0) {
    let packageQuery = admin
      .from("packages")
      .select("id, name, race_id, duration, is_hidden, shell_parent_package_id")
      .eq("is_hidden", false)
      .is("shell_parent_package_id", null)
      .limit(400)
    if (raceId) packageQuery = packageQuery.eq("race_id", raceId)
    const { data: packages } = await packageQuery
    const sellable = (packages ?? []).filter((row) => !row.is_hidden && !row.shell_parent_package_id)
    rematchedPackageName = pickMarketingPackage(queries, sellable)?.name ?? null
  }

  return {
    ...resolveOutreachInterest({
      raceName: race?.name ?? null,
      raceSeason: race?.season ?? null,
      catalogPackageNames,
      rematchedPackageName,
      notes,
    }),
    quantity: quantity == null ? null : Math.floor(quantity),
  }
}
