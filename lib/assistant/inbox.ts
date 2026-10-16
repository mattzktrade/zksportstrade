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

export function inboxStatusLabel(row: Pick<InboxRow, "status" | "wait" | "hasClientReply">): string {
  if (row.status === "closed") return "Done"
  if (row.wait === "replied") return "They replied"
  if (row.hasClientReply) return "You replied"
  if (row.wait === "waiting") return "Waiting for a reply"
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

export type InboxRow = {
  id: string
  channel: string
  status: string
  wait: InboxWaitState
  hasClientReply: boolean
  lastClientMessageAt: string | null
  name: string
  preview: string
  updatedAt: string
  email: string | null
  phone: string | null
  dealId: string | null
  dealReference: string | null
  outreachLabel: string | null
}

export type InboxThreadMessage = {
  id: string
  direction: string
  sentBy: string
  channel: string
  body: string
  mediaType: string | null
  mediaFilename: string | null
  hasMedia: boolean
  mediaHref: string | null
  createdAt: string
}

export type InboxThread = {
  conversationId: string
  status: string
  channel: string
  canSendWhatsApp: boolean
  displayName: string
  email: string | null
  phone: string | null
  dealId: string | null
  dealReference: string | null
  outreachLabel: string | null
  messages: InboxThreadMessage[]
  draft: { id: string; body: string; intent: string } | null
}

export function inboxThreadStub(row: InboxRow, now = Date.now()): InboxThread {
  return {
    conversationId: row.id,
    status: row.status,
    channel: row.channel,
    canSendWhatsApp: canSendWhatsAppReply(row.lastClientMessageAt, now),
    displayName: row.name,
    email: row.email,
    phone: row.phone,
    dealId: row.dealId,
    dealReference: row.dealReference,
    outreachLabel: row.outreachLabel,
    messages: [] as InboxThread["messages"],
    draft: null,
  }
}

export function mergeInboxThread(row: InboxRow, thread: InboxThread): InboxThread {
  return {
    ...thread,
    displayName: thread.displayName || row.name,
    email: thread.email ?? row.email,
    phone: thread.phone ?? row.phone,
    dealId: thread.dealId ?? row.dealId,
    dealReference: thread.dealReference ?? row.dealReference,
    outreachLabel: thread.outreachLabel ?? row.outreachLabel,
  }
}

export type InboxChannelFilter = "all" | "whatsapp" | "email"
export type InboxViewFilter = "all" | "waiting" | "replied" | "closed"

export function inboxSearchHaystack(row: InboxRow): string {
  return [
    row.name,
    row.preview,
    row.email,
    row.phone,
    row.dealReference,
    row.outreachLabel,
    channelLabel(row.channel),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

export function inboxRowVisible(
  row: InboxRow,
  input: { query: string; channel: InboxChannelFilter; view: InboxViewFilter },
): boolean {
  if (input.channel !== "all" && row.channel !== input.channel) return false
  if (input.view === "closed") return row.status === "closed"
  if (row.status === "closed") return input.view === "all"
  if (input.view === "waiting" && (row.hasClientReply || row.wait !== "waiting")) return false
  if (input.view === "replied" && !row.hasClientReply) return false
  const query = input.query.trim().toLowerCase()
  if (!query) return true
  return inboxSearchHaystack(row).includes(query)
}

export function formatInboxTime(value: string, now = Date.now()): string {
  const then = Date.parse(value)
  if (!Number.isFinite(then)) return ""
  const date = new Date(then)
  const sameDay = new Date(now).toDateString() === date.toDateString()
  if (sameDay) {
    return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  }
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (yesterday.toDateString() === date.toDateString()) return "Yesterday"
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}
