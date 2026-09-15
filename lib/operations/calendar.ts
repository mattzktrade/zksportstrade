import { eventFilterKey, eventNameFromPackage, formatEventDate } from "@/lib/admin/workflow-event-filter"
import {
  eventDateIso,
  operationsCalendarItems,
  type OperationsCalendarKind,
  type OperationsStepInput,
} from "@/lib/operations/fulfilment"

export const OPERATIONS_CALENDAR_FILTERS = ["all", "race", "guest_deadline", "collection", "task"] as const
export type OperationsCalendarFilter = (typeof OPERATIONS_CALENDAR_FILTERS)[number]

export const OPERATIONS_CALENDAR_VIEWS = ["month", "week", "list"] as const
export type OperationsCalendarView = (typeof OPERATIONS_CALENDAR_VIEWS)[number]

export type OperationsCalendarStaffEntry = {
  id: string
  title: string
  notes: string | null
  date: string
  startTime: string | null
  endTime: string | null
  dealId: string | null
  orderId: string | null
}

export type OperationsCalendarFeedItem = {
  id: string
  date: string
  kind: OperationsCalendarKind | "task"
  title: string
  subtitle: string | null
  timeLabel: string | null
  bookingIds: string[]
  dealId: string | null
  entryId: string | null
  purchaseOrderIds: string[]
  editable: boolean
  eventKey: string | null
}

export type CalendarBookingSource = OperationsStepInput & {
  id: string
  accountName: string
  eventPackage: string
  dealId?: string | null
  collectionPoint?: string | null
  collectionTime?: string | null
  guestDetailsDeadline?: string | null
  deliveryDueAt?: string | null
  purchaseOrderIds?: string[]
}

export function operationsCalendarFilterLabel(filter: OperationsCalendarFilter): string {
  switch (filter) {
    case "all":
      return "All events"
    case "race":
      return "Race weekends"
    case "guest_deadline":
      return "Guest deadlines"
    case "collection":
      return "Deliveries & collections"
    case "task":
      return "Internal tasks"
  }
}

export function operationsCalendarKindLabel(kind: OperationsCalendarFeedItem["kind"]): string {
  switch (kind) {
    case "race":
      return "Race weekend"
    case "guest_deadline":
      return "Guest details due"
    case "collection":
      return "Delivery / collection"
    case "task":
      return "Internal task"
  }
}

export function formatCalendarDayHeading(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
}

export function formatCalendarShortDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
}

export function addCalendarDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function filterOperationsCalendarFeed(
  items: OperationsCalendarFeedItem[],
  filter: OperationsCalendarFilter,
  eventKey = "all",
): OperationsCalendarFeedItem[] {
  return items.filter((item) => {
    if (filter !== "all" && item.kind !== filter) return false
    if (eventKey !== "all" && item.eventKey && item.eventKey !== eventKey) return false
    return true
  })
}

export function groupOperationsCalendarByDate(
  items: OperationsCalendarFeedItem[],
): Map<string, OperationsCalendarFeedItem[]> {
  const map = new Map<string, OperationsCalendarFeedItem[]>()
  const ranked = { guest_deadline: 0, collection: 1, task: 2, race: 3 }
  const sorted = [...items].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    const byKind = ranked[a.kind] - ranked[b.kind]
    if (byKind !== 0) return byKind
    return (a.timeLabel ?? "").localeCompare(b.timeLabel ?? "") || a.title.localeCompare(b.title)
  })
  for (const item of sorted) {
    const list = map.get(item.date) ?? []
    list.push(item)
    map.set(item.date, list)
  }
  return map
}

export function operationsCalendarUpcoming(
  items: OperationsCalendarFeedItem[],
  fromIso: string,
  days = 7,
): OperationsCalendarFeedItem[] {
  const until = addCalendarDays(fromIso, days)
  return items.filter((item) => item.date > fromIso && item.date <= until)
}

function timeLabel(start: string | null, end: string | null): string | null {
  if (!start) return null
  return end ? `${start} – ${end}` : start
}

export function buildOperationsCalendarFeed(
  rows: CalendarBookingSource[],
  entries: OperationsCalendarStaffEntry[],
): OperationsCalendarFeedItem[] {
  const races = new Map<string, OperationsCalendarFeedItem>()
  const items: OperationsCalendarFeedItem[] = []

  for (const row of rows) {
    const eventKey = eventFilterKey(row)
    const derived = operationsCalendarItems(row)
    for (const item of derived) {
      if (item.kind === "race") {
        const title = eventNameFromPackage(row.eventPackage) || row.accountName
        const id = `race:${item.date}:${title}`
        const existing = races.get(id)
        if (existing) {
          if (!existing.bookingIds.includes(row.id)) existing.bookingIds.push(row.id)
          const count = existing.bookingIds.length
          existing.subtitle = `${count} booking${count === 1 ? "" : "s"}`
          continue
        }
        races.set(id, {
          id,
          date: item.date,
          kind: "race",
          title,
          subtitle: "1 booking",
          timeLabel: null,
          bookingIds: [row.id],
          dealId: row.dealId ?? null,
          entryId: null,
          purchaseOrderIds: [],
          editable: false,
          eventKey,
        })
        continue
      }
      if (item.kind === "guest_deadline") {
        items.push({
          id: `guest:${row.id}:${item.date}`,
          date: item.date,
          kind: "guest_deadline",
          title: row.accountName,
          subtitle: "Guest details due",
          timeLabel: null,
          bookingIds: [row.id],
          dealId: row.dealId ?? null,
          entryId: null,
          purchaseOrderIds: row.purchaseOrderIds ?? [],
          editable: true,
          eventKey,
        })
        continue
      }
      const extras = [row.collectionPoint, row.collectionTime].filter(Boolean).join(" · ")
      items.push({
        id: `collection:${row.id}:${item.date}`,
        date: item.date,
        kind: "collection",
        title: row.accountName,
        subtitle: extras || "Delivery / collection",
        timeLabel: row.collectionTime?.trim() || null,
        bookingIds: [row.id],
        dealId: row.dealId ?? null,
        entryId: null,
        purchaseOrderIds: [],
        editable: true,
        eventKey,
      })
    }
  }

  for (const entry of entries) {
    const date = eventDateIso(entry.date)
    if (!date) continue
    const linked =
      rows.find((row) => (entry.dealId && row.dealId === entry.dealId) || (entry.orderId && row.id === entry.orderId)) ??
      null
    items.push({
      id: `task:${entry.id}`,
      date,
      kind: "task",
      title: entry.title,
      subtitle: entry.notes,
      timeLabel: timeLabel(entry.startTime, entry.endTime),
      bookingIds: linked ? [linked.id] : entry.orderId ? [entry.orderId] : [],
      dealId: entry.dealId ?? linked?.dealId ?? null,
      entryId: entry.id,
      purchaseOrderIds: [],
      editable: true,
      eventKey: linked ? eventFilterKey(linked) : null,
    })
  }

  return [...races.values(), ...items]
}

export function operationsCalendarIcs(items: OperationsCalendarFeedItem[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ZK Sports & Entertainment//Operations//EN",
    "CALSCALE:GREGORIAN",
  ]
  for (const item of items) {
    const date = item.date.replaceAll("-", "")
    const summary = icsEscape(`${item.title}${item.subtitle ? ` — ${item.subtitle}` : ""}`)
    lines.push(
      "BEGIN:VEVENT",
      `UID:${item.id}@zksportstrade`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${date}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${icsEscape([operationsCalendarKindLabel(item.kind), item.timeLabel, item.subtitle].filter(Boolean).join(" · "))}`,
      "END:VEVENT",
    )
  }
  lines.push("END:VCALENDAR")
  return lines.join("\r\n")
}

function icsEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll("\n", "\\n")
}

export { formatEventDate }
