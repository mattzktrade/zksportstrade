import type { AssistantChannel } from "@/lib/assistant/types"

export type InboundAssistantEvent = {
  channel: AssistantChannel
  providerMessageId: string | null
  fromDigits: string | null
  fromEmail: string | null
  displayName: string
  ourNumber: string | null
  body: string
  mediaType: string | null
  sentBy: "client" | "staff"
  timestamp: string | null
  raw: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function textFromMessage(message: Record<string, unknown>): { body: string; mediaType: string | null } {
  const type = typeof message.type === "string" ? message.type : "text"
  if (type === "text") {
    const text = asRecord(message.text)
    return { body: typeof text?.body === "string" ? text.body : "", mediaType: null }
  }
  if (type === "button") {
    const button = asRecord(message.button)
    const text = typeof button?.text === "string" ? button.text : ""
    return { body: text, mediaType: "button" }
  }
  if (type === "interactive") {
    const interactive = asRecord(message.interactive)
    const buttonReply = asRecord(interactive?.button_reply)
    const listReply = asRecord(interactive?.list_reply)
    const title =
      (typeof buttonReply?.title === "string" && buttonReply.title) ||
      (typeof listReply?.title === "string" && listReply.title) ||
      ""
    return { body: title, mediaType: "interactive" }
  }
  const captionKeys = ["image", "video", "document", "audio", "sticker"]
  for (const key of captionKeys) {
    if (type !== key) continue
    const media = asRecord(message[key])
    const caption = typeof media?.caption === "string" ? media.caption : ""
    return { body: caption, mediaType: key }
  }
  return { body: "", mediaType: type === "system" ? "system" : type }
}

function profileNameFromValue(value: Record<string, unknown>, waId: string): string {
  const contacts = Array.isArray(value.contacts) ? value.contacts : []
  for (const contact of contacts) {
    const row = asRecord(contact)
    if (!row) continue
    const id = typeof row.wa_id === "string" ? row.wa_id.replace(/\D/g, "") : ""
    if (id && id !== waId.replace(/\D/g, "")) continue
    const profile = asRecord(row.profile)
    if (typeof profile?.name === "string" && profile.name.trim()) return profile.name.trim()
  }
  return ""
}

function collectValueBlocks(body: unknown): Record<string, unknown>[] {
  const root = asRecord(body)
  if (!root || !Array.isArray(root.entry)) return []
  const out: Record<string, unknown>[] = []
  for (const entry of root.entry) {
    const changes = asRecord(entry)?.changes
    if (!Array.isArray(changes)) continue
    for (const change of changes) {
      const value = asRecord(asRecord(change)?.value)
      if (value) out.push(value)
    }
  }
  return out
}

function eventFromMessage(
  value: Record<string, unknown>,
  message: Record<string, unknown>,
  sentBy: "client" | "staff",
): InboundAssistantEvent | null {
  if (message.type === "system") return null
  const from = typeof message.from === "string" ? message.from.replace(/\D/g, "") : ""
  if (from.length < 8) return null
  const { body, mediaType } = textFromMessage(message)
  const metadata = asRecord(value.metadata)
  const ourNumber =
    (typeof metadata?.display_phone_number === "string" && metadata.display_phone_number.replace(/\D/g, "")) ||
    (typeof metadata?.phone_number_id === "string" && metadata.phone_number_id) ||
    null
  const id = typeof message.id === "string" && message.id.trim() ? message.id.trim() : null
  const timestamp = typeof message.timestamp === "string" ? message.timestamp : null
  return {
    channel: "whatsapp",
    providerMessageId: id,
    fromDigits: from,
    fromEmail: null,
    displayName: profileNameFromValue(value, from),
    ourNumber,
    body,
    mediaType,
    sentBy,
    timestamp,
    raw: message,
  }
}

/** Customer messages plus Business App echoes (coexistence human takeover). */
export function parseWhatsAppAssistantEvents(body: unknown): InboundAssistantEvent[] {
  const events: InboundAssistantEvent[] = []
  const seen = new Set<string>()
  for (const value of collectValueBlocks(body)) {
    const buckets: Array<{ key: string; sentBy: "client" | "staff" }> = [
      { key: "messages", sentBy: "client" },
      { key: "smb_message_echoes", sentBy: "staff" },
      { key: "message_echoes", sentBy: "staff" },
    ]
    for (const bucket of buckets) {
      const list = value[bucket.key]
      if (!Array.isArray(list)) continue
      for (const item of list) {
        const message = asRecord(item)
        if (!message) continue
        const event = eventFromMessage(value, message, bucket.sentBy)
        if (!event) continue
        const dedupe = event.providerMessageId || `${event.fromDigits}:${event.body}:${event.sentBy}`
        if (seen.has(dedupe)) continue
        seen.add(dedupe)
        events.push(event)
      }
    }
  }
  return events
}

export function collectWhatsAppInboundMessages(body: unknown): Array<{
  from?: string
  type?: string
  text?: { body?: string }
  id?: string
}> {
  return parseWhatsAppAssistantEvents(body)
    .filter((event) => event.sentBy === "client")
    .map((event) => ({
      from: event.fromDigits ?? undefined,
      type: event.mediaType ?? "text",
      text: { body: event.body },
      id: event.providerMessageId ?? undefined,
    }))
}
