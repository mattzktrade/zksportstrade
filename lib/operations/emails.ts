export const OPERATIONS_EMAIL_KINDS = ["guest_details", "operations_intro"] as const

export type OperationsEmailKind = (typeof OPERATIONS_EMAIL_KINDS)[number]

export type OperationsEmailDraftInput = {
  kind: OperationsEmailKind
  contactName: string
  accountName: string
  eventLabel: string
  quantity: number
  dealReference: string
  senderName: string
}

export type OperationsEmailDraft = {
  kind: OperationsEmailKind
  toName: string
  toEmail: string
  subject: string
  body: string
}

export type OperationsEmailHistoryRow = {
  id: string
  dealId: string | null
  orderId: string | null
  kind: OperationsEmailKind
  toEmail: string
  toName: string | null
  subject: string
  sentAt: string
  sentByName: string | null
}

export function isOperationsEmailKind(value: string): value is OperationsEmailKind {
  return (OPERATIONS_EMAIL_KINDS as readonly string[]).includes(value)
}

export function operationsEmailKindLabel(kind: OperationsEmailKind): string {
  return kind === "guest_details" ? "Guest details request" : "Operations introduction"
}

function firstName(fullName: string): string {
  const trimmed = fullName.trim()
  if (!trimmed) return "there"
  return trimmed.split(/\s+/)[0] ?? trimmed
}

function guestWord(quantity: number): string {
  const count = Math.max(1, Math.floor(quantity) || 1)
  return `${count} guest${count === 1 ? "" : "s"}`
}

export function buildOperationsEmailDraft(input: OperationsEmailDraftInput): Omit<OperationsEmailDraft, "toEmail"> {
  const greeting = firstName(input.contactName)
  const event = input.eventLabel.trim() || "your upcoming event"
  const reference = input.dealReference.trim() || "your booking"
  const sender = input.senderName.trim() || "ZK Sports"
  const guests = guestWord(input.quantity)
  const account = input.accountName.trim() || "your company"

  if (input.kind === "guest_details") {
    return {
      kind: input.kind,
      toName: input.contactName.trim() || account,
      subject: `Guest details needed — ${event} (${reference})`,
      body: [
        `Hi ${greeting},`,
        "",
        `Thank you for confirming the ${account} booking with ZK Sports & Entertainment.`,
        "",
        `To get tickets and delivery organised for ${event}, we now need guest details for the ${guests} on this booking (${reference}).`,
        "",
        "Please reply to this email with the following for each guest:",
        "• Full name, as it appears on their passport or photo ID",
        "• Date of birth",
        "• Nationality",
        "• Email and mobile number",
        "• Any dietary requirements, accessibility needs, or other notes we should know",
        "",
        "Once we have this, our operations team can prepare the tickets and send them across ahead of the event.",
        "",
        "If anything has changed on the booking, or you would rather we collect the names another way, just reply and we will help.",
        "",
        "Kind regards,",
        sender,
        "ZK Sports & Entertainment",
        "Operations",
      ].join("\n"),
    }
  }

  return {
    kind: input.kind,
    toName: input.contactName.trim() || account,
    subject: `Next steps for ${event} — introducing operations (${reference})`,
    body: [
      `Hi ${greeting},`,
      "",
      `I hope you are well. Now that the ${account} booking for ${event} is confirmed (${reference}), I wanted to introduce you to our operations team.`,
      "",
      "From this point they will look after guest names, tickets, and delivery, so you have one place to go with any practical questions.",
      "",
      "What happens next:",
      "1. We collect guest details for each place on the booking",
      "2. We receive the tickets from the supplier",
      "3. We send the tickets to you (or the named guests) ahead of the event",
      "",
      "Please reply to this email if you need anything on seating, hospitality, delivery timing, or guest names. Your sales contact remains available for anything commercial.",
      "",
      "We will be in touch again once tickets are in hand.",
      "",
      "Kind regards,",
      sender,
      "ZK Sports & Entertainment",
      "Operations",
    ].join("\n"),
  }
}

export function operationsEmailHtml(body: string): string {
  const escaped = body
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
  const blocks = escaped
    .trim()
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 14px">${block.replaceAll("\n", "<br/>")}</p>`)
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#111">${blocks.join("")}</div>`
}
