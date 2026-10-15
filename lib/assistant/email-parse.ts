import { mailboxFromFromHeader, getMarketingOutreachFromAddress, getResendFromAddress } from "@/lib/email/config"
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

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

export function stripQuotedEmailReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const cut = lines.findIndex((line, index) => {
    if (index === 0) return false
    const trimmed = line.trim()
    if (/^on .+wrote:$/i.test(trimmed)) return true
    if (/^-{2,}\s*original message\s*-{2,}$/i.test(trimmed)) return true
    if (/^_{5,}$/.test(trimmed)) return true
    return false
  })
  return (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim()
}

export function emailFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    return normalizeAssistantEmail(value.match(/[^\s<>]+@[^\s<>]+/)?.[0] ?? value)
  }
  const record = asRecord(value)
  if (!record) return null
  const nested = asRecord(record.emailAddress) || asRecord(record.email_address)
  if (nested) {
    return emailFromUnknown(nested.address ?? nested.email ?? nested.from)
  }
  const raw = stringField(record, ["email", "address", "from"])
  return raw ? normalizeAssistantEmail(raw) : null
}

function displayNameFromFrom(value: unknown, email: string): string {
  if (typeof value === "string") {
    const named = value.match(/^(.+)<[^>]+>$/)
    const name = named?.[1]?.trim().replace(/^["']|["']$/g, "")
    if (name) return name
  }
  const record = asRecord(value)
  return (
    stringField(record, ["name"]) ||
    stringField(asRecord(record?.emailAddress), ["name"]) ||
    email.split("@")[0] ||
    ""
  )
}

export function ourSalesMailboxes(): string[] {
  const candidates = [
    mailboxFromFromHeader(getMarketingOutreachFromAddress()),
    mailboxFromFromHeader(getResendFromAddress()),
    mailboxFromFromHeader(process.env.MARKETING_OUTREACH_REPLY_TO),
    "sales@zk-sports.com",
    "confirmation@zk-sports.trade",
  ]
  return [...new Set(candidates.filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase()))]
}

export function isOurSalesMailbox(email: string | null | undefined): boolean {
  const normalized = normalizeAssistantEmail(email ?? "")
  return Boolean(normalized && ourSalesMailboxes().includes(normalized))
}

export function parseAssistantEmailEvent(body: unknown): InboundAssistantEvent | null {
  const root = asRecord(body)
  if (!root) return null
  const data = asRecord(root.data) ?? root
  const email =
    emailFromUnknown(data.from) ||
    emailFromUnknown(data.sender) ||
    emailFromUnknown(data.mail_from) ||
    emailFromUnknown(data.fromEmail) ||
    emailFromUnknown(root.from)
  if (!email || isOurSalesMailbox(email)) return null

  const subject = stringField(data, ["subject"]) || stringField(root, ["subject"])
  const graphBody = asRecord(data.body)
  const rawCandidate =
    stringField(data, ["text", "plain", "stripped_text"]) ||
    stringField(root, ["text", "plain"]) ||
    (typeof graphBody?.content === "string" ? String(graphBody.content) : "") ||
    stringField(data, ["body", "html", "bodyPreview"]) ||
    stringField(root, ["body"])
  const text = stripQuotedEmailReply(
    /<[a-z][\s\S]*>/i.test(rawCandidate) ? htmlToPlainText(rawCandidate) : rawCandidate,
  )
  const id =
    stringField(data, ["email_id", "id", "message_id", "internetMessageId"]) ||
    stringField(root, ["email_id", "id", "message_id"]) ||
    null
  const name =
    displayNameFromFrom(data.from, email) ||
    stringField(data, ["from_name", "sender_name"]) ||
    email.split("@")[0] ||
    ""

  const bodyText = [subject && `Subject: ${subject}`, text].filter(Boolean).join("\n\n").trim()
  if (!bodyText) return null
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
    timestamp: stringField(data, ["created_at", "date", "receivedDateTime"]) || null,
    raw: data,
  }
}
