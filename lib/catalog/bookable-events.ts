const LONDON_TZ = "Europe/London"

/** Today's calendar date in London (YYYY-MM-DD). Events are bookable through event day, hidden from the next day. */
export function bookableEventDateFrom(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())

  const day = parts.find((p) => p.type === "day")?.value ?? "01"
  const month = parts.find((p) => p.type === "month")?.value ?? "01"
  const year = parts.find((p) => p.type === "year")?.value ?? "1970"
  return `${year}-${month}-${day}`
}

/** True when agents can still browse and book (event day inclusive). */
export function isBookableEventDate(eventDate: string): boolean {
  const normalized = eventDate.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false
  return normalized >= bookableEventDateFrom()
}
