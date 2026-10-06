import { normalizeAssistantEmail } from "@/lib/assistant/phone"
import type { InboundAssistantEvent } from "@/lib/assistant/whatsapp-parse"

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function stringField(record: Record<string, unknown> | null, keys: string[]): string {
  if (!record) return ""
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

function emailFromUnknown(value: unknown): string | null {
  if (typeof value === "string") return normalizeAssistantEmail(value.match(/[^\s<>]+@[^\s<>]+/)?.[0] ?? value)
  const record = asRecord(value)
  if (!record) return null
  return normalizeAssistantEmail(
    stringField(record, ["email", "address", "from"]) || String(record.email ?? ""),
  )
}

export function parseAssistantEmailEvent(body: unknown): InboundAssistantEvent | null {
  const root = asRecord(body)
  if (!root) return null
  const data = asRecord(root.data) ?? root
  const email =
    emailFromUnknown(data.from) ||
    emailFromUnknown(data.sender) ||
    emailFromUnknown(data.mail_from) ||
    emailFromUnknown(root.from)
  if (!email) return null

  const subject = stringField(data, ["subject"])
  const text =
    stringField(data, ["text", "plain", "stripped_text", "body", "html"]) ||
    stringField(root, ["text", "plain", "body"])
  const id =
    stringField(data, ["email_id", "id", "message_id"]) ||
    stringField(root, ["email_id", "id", "message_id"]) ||
    null
  const name =
    stringField(asRecord(data.from), ["name"]) ||
    stringField(data, ["from_name", "sender_name"]) ||
    email.split("@")[0] ||
    ""

  const bodyText = [subject && `Subject: ${subject}`, text].filter(Boolean).join("\n\n").trim()
  return {
    channel: "email",
    providerMessageId: id,
    fromDigits: null,
    fromEmail: email,
    displayName: name,
    ourNumber: null,
    body: bodyText,
    mediaType: null,
    sentBy: "client",
    timestamp: stringField(data, ["created_at", "date"]) || null,
    raw: data,
  }
}
