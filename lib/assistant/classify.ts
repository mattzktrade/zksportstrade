import type { ClientMessageClass } from "@/lib/assistant/types"

const BOOKING_RE =
  /\b(we'?re on|go ahead|please send (the )?(booking )?form|send (over )?the (booking )?form|happy to proceed|let'?s proceed|confirmed[,.]? (please )?book|book (it|them|us|those)|we(?:'| a)?ll take (them|it|those)|take \d+ (tickets|places|seats))\b/i
const PRICE_RE =
  /\b(how much|price|quote|rate|cost|what(?:'| i)?s the (trade )?price|can you quote)\b/i
const SENSITIVE_RE =
  /\b(cancel|cancellation|refund|money back|visa|guaranteed (access|hospitality|tickets)|airport transfer|on[- ]ground (contact|support|phone)|guest guide contact)\b/i
const PORTAL_RE = /\b(portal|trade portal|log ?in and book|book (it )?online|checkout)\b/i

export function classifyClientMessage(text: string, mediaOnly = false): ClientMessageClass {
  const body = text.trim()
  return {
    wantsBooking: BOOKING_RE.test(body),
    wantsPrice: PRICE_RE.test(body),
    sensitive: SENSITIVE_RE.test(body),
    portalHint: PORTAL_RE.test(body),
    mediaOnly: mediaOnly && body.length === 0,
  }
}

export function isLowContentMessage(text: string, mediaType: string | null): boolean {
  const body = text.trim()
  if (mediaType && mediaType !== "text" && mediaType !== "button" && mediaType !== "interactive" && !body) {
    return true
  }
  return body.length === 0
}
