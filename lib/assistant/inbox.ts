import { WHATSAPP_CUSTOMER_WINDOW_MS } from "@/lib/assistant/types"

export type InboxWaitState = "waiting" | "replied" | "new"

export function inboxWaitState(input: {
  lastClientMessageAt: string | null
  lastOutboundAt: string | null
}): InboxWaitState {
  const inbound = input.lastClientMessageAt ? Date.parse(input.lastClientMessageAt) : Number.NaN
  const outbound = input.lastOutboundAt ? Date.parse(input.lastOutboundAt) : Number.NaN
  if (Number.isFinite(inbound) && (!Number.isFinite(outbound) || inbound >= outbound)) return "replied"
  if (Number.isFinite(outbound)) return "waiting"
  return "new"
}

export function inboxWaitLabel(state: InboxWaitState): string {
  if (state === "replied") return "They replied"
  if (state === "waiting") return "Waiting for a reply"
  return "No messages yet"
}

export function channelLabel(channel: string): string {
  if (channel === "whatsapp") return "WhatsApp"
  if (channel === "email") return "Email"
  return "Note"
}

export function canSendWhatsAppReply(lastClientMessageAt: string | null, now = Date.now()): boolean {
  if (!lastClientMessageAt) return false
  const then = Date.parse(lastClientMessageAt)
  if (!Number.isFinite(then)) return false
  return now - then < WHATSAPP_CUSTOMER_WINDOW_MS
}

export function previewText(body: string, max = 90): string {
  const text = body.replace(/\s+/g, " ").trim()
  if (!text) return "Empty message"
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
