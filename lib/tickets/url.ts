import { getServerSiteOrigin } from "@/lib/auth/site-origin"

export function ticketPublicPath(token: string): string {
  return `/t/${encodeURIComponent(token)}`
}

export function ticketPublicUrl(token: string, origin = getServerSiteOrigin()): string {
  return `${origin.replace(/\/$/, "")}${ticketPublicPath(token)}`
}

export function ticketPdfPath(token: string): string {
  return `/api/tickets/${encodeURIComponent(token)}/pdf`
}

export function isTicketPublicToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,60}$/.test(token)
}
