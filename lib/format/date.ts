export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—"
  const trimmed = value.trim()
  if (!trimmed) return "—"
  const date = /T|\s/.test(trimmed)
    ? new Date(trimmed)
    : new Date(`${trimmed.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}
