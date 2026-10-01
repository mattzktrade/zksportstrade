import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import {
  adminEnquiryListPath,
  enquiryCrmStageFromDeal,
  enquiryInterestLabel,
  isEnquiryCrmStage,
  isEnquiryPipelineStage,
} from "@/lib/crm/deal-pipeline"

export const SOURCING_REQUIRED_EMAIL = "matt@zk-sports.com"
export const SOURCING_COMPLETE_EMAIL = "samantha@zk-sports.com"

export const SOURCING_REQUIRED_HREF = "/admin/enquiries?stage=sourcing_required"
export const SOURCING_COMPLETE_HREF = "/admin/enquiries?stage=sourcing_complete"

export type SourcingNotifyStage = "sourcing_required" | "sourcing_complete"

export type SourcingEnquirySnapshot = {
  id: string
  reference: string
  stage: string
  enquiryStage: string | null
  clientName: string
  interest: string
  notes?: string
}

export type SourcingNotification = {
  to: string
  kind: SourcingNotifyStage
  subject: string
  text: string
  html: string
}

type DealReader = {
  from: (table: string) => {
    select: (columns: string) => {
      in: (
        column: string,
        values: string[],
      ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
    }
  }
}

const RICH_SELECT =
  "id, reference, stage, enquiry_stage, notes, crm_accounts(name), races(name, season), deal_line_items(packages(name, races(name, season)))"
const PLAIN_SELECT = "id, reference, stage, enquiry_stage, notes"

export function isOpenSourcingStage(
  deal: { stage: string; enquiry_stage?: string | null },
  stage: SourcingNotifyStage,
): boolean {
  return isEnquiryPipelineStage(deal.stage) && enquiryCrmStageFromDeal(deal) === stage
}

export function sourcingNotificationForStageChange(input: {
  previous: { stage: string; enquiry_stage?: string | null }
  nextStage: string
}): { kind: SourcingNotifyStage; to: string } | null {
  if (!isEnquiryCrmStage(input.nextStage)) return null
  const previous = enquiryCrmStageFromDeal({
    stage: input.previous.stage || "draft",
    enquiry_stage: input.previous.enquiry_stage,
  })
  if (previous === input.nextStage) return null
  if (input.nextStage === "sourcing_required") {
    return { kind: "sourcing_required", to: SOURCING_REQUIRED_EMAIL }
  }
  if (input.nextStage === "sourcing_complete") {
    return { kind: "sourcing_complete", to: SOURCING_COMPLETE_EMAIL }
  }
  return null
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function displayValue(value: string): string {
  const trimmed = value.trim()
  return trimmed || "—"
}

export function buildSourcingNotification(input: {
  snapshot: SourcingEnquirySnapshot
  nextStage: string
  origin?: string
}): SourcingNotification | null {
  const match = sourcingNotificationForStageChange({
    previous: { stage: input.snapshot.stage, enquiry_stage: input.snapshot.enquiryStage },
    nextStage: input.nextStage,
  })
  if (!match) return null

  const reference = displayValue(input.snapshot.reference)
  const clientName = displayValue(input.snapshot.clientName)
  const interest = displayValue(input.snapshot.interest)
  const notes = input.snapshot.notes?.trim() ?? ""
  const origin = (input.origin ?? getServerSiteOrigin()).replace(/\/$/, "")
  const enquiryUrl = `${origin}${adminEnquiryListPath(input.snapshot.id)}`
  const headline =
    match.kind === "sourcing_required"
      ? "An enquiry has been marked Sourcing required and needs sourcing."
      : "Sourcing is complete for this enquiry. Please send the quote to the client."
  const subject =
    match.kind === "sourcing_required"
      ? `Sourcing required — ${reference}`
      : `Sourcing complete — ${reference}`
  const text = [
    headline,
    "",
    `Enquiry: ${reference}`,
    `Client: ${clientName}`,
    `Interest: ${interest}`,
    ...(notes ? [`Notes: ${notes}`] : []),
    "",
    `Open the enquiry: ${enquiryUrl}`,
  ].join("\n")
  const html = [
    `<p>${escapeHtml(headline)}</p>`,
    `<p><strong>Enquiry:</strong> ${escapeHtml(reference)}<br/>`,
    `<strong>Client:</strong> ${escapeHtml(clientName)}<br/>`,
    `<strong>Interest:</strong> ${escapeHtml(interest)}`,
    notes ? `<br/><strong>Notes:</strong> ${escapeHtml(notes)}` : "",
    `</p>`,
    `<p><a href="${escapeHtml(enquiryUrl)}">Open the enquiry</a></p>`,
  ].join("")

  return { to: match.to, kind: match.kind, subject, text, html }
}

function textName(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object") return item as Record<string, unknown>
    }
    return null
  }
  if (value && typeof value === "object") return value as Record<string, unknown>
  return null
}

export function sourcingEnquirySnapshotFromRow(row: unknown): SourcingEnquirySnapshot | null {
  if (!row || typeof row !== "object") return null
  const record = row as Record<string, unknown>
  const id = textName(record.id)
  if (!id) return null

  const account = firstRecord(record.crm_accounts)
  const clientName = textName(account?.name)
  const lines = Array.isArray(record.deal_line_items) ? record.deal_line_items : []
  const events: string[] = []
  const packages: string[] = []
  for (const line of lines) {
    const pack = firstRecord((line as { packages?: unknown } | null)?.packages)
    if (!pack) continue
    const packageName = textName(pack.name)
    const race = firstRecord(pack.races)
    const raceName = eventLabel(race)
    if (packageName && !packages.includes(packageName)) packages.push(packageName)
    if (raceName && !events.includes(raceName)) events.push(raceName)
  }
  if (events.length === 0) {
    const dealRace = eventLabel(firstRecord(record.races))
    if (dealRace) events.push(dealRace)
  }

  return {
    id,
    reference: textName(record.reference),
    stage: textName(record.stage) || "draft",
    enquiryStage: textName(record.enquiry_stage) || null,
    clientName,
    notes: textName(record.notes),
    interest: enquiryInterestLabel({
      race_name: events.join(", ") || null,
      line_summary: packages.join(", ") || null,
    }),
  }
}

function eventLabel(race: Record<string, unknown> | null): string {
  if (!race) return ""
  const name = textName(race.name)
  if (!name) return ""
  const season = typeof race.season === "number" ? race.season : Number(race.season)
  return eventSeasonLabel(name, Number.isFinite(season) ? season : null)
}

async function readSnapshotRows(reader: DealReader, dealIds: string[], columns: string): Promise<unknown[] | null> {
  const { data, error } = await reader.from("deals").select(columns).in("id", dealIds)
  if (error || !Array.isArray(data)) return null
  return data
}

export async function loadSourcingEnquirySnapshots(
  // `object` on purpose. A structural DealReader makes tsc recurse through SupabaseClient.from.
  reader: object,
  dealIds: string[],
): Promise<Map<string, SourcingEnquirySnapshot>> {
  const ids = [...new Set(dealIds.map((id) => id.trim()).filter(Boolean))]
  const snapshots = new Map<string, SourcingEnquirySnapshot>()
  if (ids.length === 0) return snapshots
  const dealReader = reader as DealReader

  try {
    const rows = (await readSnapshotRows(dealReader, ids, RICH_SELECT)) ?? (await readSnapshotRows(dealReader, ids, PLAIN_SELECT))
    for (const row of rows ?? []) {
      const snapshot = sourcingEnquirySnapshotFromRow(row)
      if (snapshot) snapshots.set(snapshot.id, snapshot)
    }
  } catch (error) {
    console.error("Could not load enquiry details for the sourcing notification", error)
  }
  return snapshots
}
