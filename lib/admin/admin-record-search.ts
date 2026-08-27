import { adminDealPath } from "@/lib/admin/deal-link"
import { adminEventPath } from "@/lib/admin/event-link"
import { rankBySearchScore, searchMatchScore } from "@/lib/admin/ranked-search"
import { adminAccountPath, adminContactPath } from "@/lib/crm/profile-links"
import { eventSeasonLabel } from "@/lib/catalog/event-label"

export const ADMIN_RECORD_KIND_LIMIT = 8

export type AdminRecordKind = "page" | "account" | "contact" | "deal" | "order" | "event"

export type AdminRecordHit = {
  id: string
  kind: AdminRecordKind
  kindLabel: string
  label: string
  hint?: string
  href: string
}

export type AdminJumpPage = {
  label: string
  href: string
  keywords?: string
}

export const RECORD_KIND_LABELS: Record<AdminRecordKind, string> = {
  page: "Page",
  account: "Account",
  contact: "Contact",
  deal: "Deal",
  order: "Order",
  event: "Event",
}

export function accountRecordHit(row: { id: string; name: string; email?: string | null }): AdminRecordHit {
  return {
    id: `account:${row.id}`,
    kind: "account",
    kindLabel: RECORD_KIND_LABELS.account,
    label: row.name,
    hint: row.email?.trim() || "Company / person",
    href: adminAccountPath(row.id),
  }
}

export function contactRecordHit(row: {
  id: string
  accountId: string
  fullName: string
  accountName: string
  email?: string | null
}): AdminRecordHit {
  const hint = [row.accountName, row.email].filter(Boolean).join(" · ")
  return {
    id: `contact:${row.id}`,
    kind: "contact",
    kindLabel: RECORD_KIND_LABELS.contact,
    label: row.fullName,
    hint: hint || "Contact",
    href: adminContactPath(row.accountId, row.id),
  }
}

export function dealRecordHit(row: {
  id: string
  reference: string
  accountName?: string | null
}): AdminRecordHit {
  return {
    id: `deal:${row.id}`,
    kind: "deal",
    kindLabel: RECORD_KIND_LABELS.deal,
    label: row.reference,
    hint: row.accountName?.trim() || "Deal",
    href: adminDealPath(row.id),
  }
}

export function orderRecordHit(row: {
  id: string
  reference: string
  dealId?: string | null
  clientName?: string | null
}): AdminRecordHit {
  const href = row.dealId
    ? adminDealPath(row.dealId)
    : `/admin/orders?q=${encodeURIComponent(row.reference)}`
  return {
    id: `order:${row.id}`,
    kind: "order",
    kindLabel: RECORD_KIND_LABELS.order,
    label: row.reference,
    hint: row.clientName?.trim() || (row.dealId ? "Order" : "Portal order"),
    href,
  }
}

export function eventRecordHit(row: {
  id: string
  name: string
  season?: number | null
  eventDate?: string | null
}): AdminRecordHit {
  return {
    id: `event:${row.id}`,
    kind: "event",
    kindLabel: RECORD_KIND_LABELS.event,
    label: eventSeasonLabel(row.name, row.season),
    hint: row.eventDate?.slice(0, 10) || "Event",
    href: adminEventPath(row.id),
  }
}

export function pageRecordHits(pages: AdminJumpPage[], query: string): AdminRecordHit[] {
  const q = query.trim().toLowerCase()
  const filtered = q
    ? pages.filter((page) =>
        [page.label, page.href, page.keywords ?? ""].some((value) => value.toLowerCase().includes(q)),
      )
    : pages
  return filtered.map((page) => ({
    id: `page:${page.href}`,
    kind: "page" as const,
    kindLabel: RECORD_KIND_LABELS.page,
    label: page.label,
    hint: "Admin page",
    href: page.href,
  }))
}

export function rankAdminRecordHits(hits: AdminRecordHit[], query: string): AdminRecordHit[] {
  const q = query.trim()
  if (!q) return hits
  return rankBySearchScore(hits, q, (hit) => `${hit.label} ${hit.hint ?? ""}`)
}

export function mergeAdminJumpResults(
  pages: AdminJumpPage[],
  records: AdminRecordHit[],
  query: string,
): AdminRecordHit[] {
  const pageHits = pageRecordHits(pages, query)
  const q = query.trim()
  if (!q) return pageHits

  const kindOrder: Record<AdminRecordKind, number> = {
    page: 0,
    account: 1,
    contact: 2,
    deal: 3,
    order: 4,
    event: 5,
  }

  const combined = [...pageHits, ...records]
  const seen = new Set<string>()
  const unique: AdminRecordHit[] = []
  for (const hit of combined) {
    if (seen.has(hit.id) || seen.has(hit.href)) continue
    seen.add(hit.id)
    seen.add(hit.href)
    unique.push(hit)
  }

  return unique.sort((a, b) => {
    const scoreDelta =
      searchMatchScore(`${b.label} ${b.hint ?? ""}`, q) - searchMatchScore(`${a.label} ${a.hint ?? ""}`, q)
    if (scoreDelta !== 0) return scoreDelta
    return kindOrder[a.kind] - kindOrder[b.kind] || a.label.localeCompare(b.label)
  })
}
