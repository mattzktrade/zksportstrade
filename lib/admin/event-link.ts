export function adminEventPath(eventId: string): string {
  return `/admin/catalog/events/${encodeURIComponent(eventId)}`
}
