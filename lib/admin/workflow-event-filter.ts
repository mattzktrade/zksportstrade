export type EventFilterRow = {
  eventDate: string | null
  eventPackage: string
}

export function eventNameFromPackage(eventPackage: string): string {
  const byDot = eventPackage.split(" · ")[0]?.trim()
  if (byDot && byDot !== eventPackage) return byDot
  const byDash = eventPackage.split(" - ")[0]?.trim()
  return byDash || eventPackage
}

export function eventFilterKey(row: EventFilterRow): string {
  return `${row.eventDate ?? "undated"}::${eventNameFromPackage(row.eventPackage)}`
}

export function formatEventDate(value: string | null): string {
  if (!value) return "Date TBC"
  const time = new Date(value.includes("T") ? value : `${value}T00:00:00`).getTime()
  if (Number.isNaN(time)) return "Date TBC"
  return new Date(time).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

export function eventTime(row: EventFilterRow): number | null {
  if (!row.eventDate) return null
  const value = row.eventDate.includes("T") ? row.eventDate : `${row.eventDate}T00:00:00`
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

export function startOfToday(): number {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function uniqueEventOptions(
  rows: EventFilterRow[],
  scope: "future" | "all" = "all",
): Array<{ key: string; label: string }> {
  const today = startOfToday()
  const map = new Map<string, { key: string; label: string; date: string | null }>()
  for (const row of rows) {
    if (scope === "future") {
      const time = eventTime(row)
      if (time != null && time < today) continue
    }
    const key = eventFilterKey(row)
    if (map.has(key)) continue
    const name = eventNameFromPackage(row.eventPackage)
    map.set(key, {
      key,
      label: `${formatEventDate(row.eventDate)} · ${name}`,
      date: row.eventDate,
    })
  }
  return [...map.values()]
    .sort((a, b) => {
      const aTime = a.date ? eventTime({ eventDate: a.date, eventPackage: a.label }) : null
      const bTime = b.date ? eventTime({ eventDate: b.date, eventPackage: b.label }) : null
      if (aTime == null && bTime == null) return a.label.localeCompare(b.label)
      if (aTime == null) return 1
      if (bTime == null) return -1
      const aPast = aTime < today
      const bPast = bTime < today
      if (aPast !== bPast) return aPast ? 1 : -1
      return aPast ? bTime - aTime : aTime - bTime
    })
    .map(({ key, label }) => ({ key, label }))
}

export function compareUpcomingEvent(
  a: EventFilterRow,
  b: EventFilterRow,
  direction: 1 | -1,
): number {
  const today = startOfToday()
  const aTime = eventTime(a)
  const bTime = eventTime(b)
  if (aTime == null && bTime == null) return 0
  if (aTime == null) return 1
  if (bTime == null) return -1
  const aPast = aTime < today
  const bPast = bTime < today
  if (aPast !== bPast) return aPast ? 1 : -1
  if (!aPast && !bPast) return direction * (aTime - bTime)
  return direction * (bTime - aTime)
}
