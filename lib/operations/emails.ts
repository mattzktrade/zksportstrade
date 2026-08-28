export const OPERATIONS_EMAIL_KINDS = ["guest_details", "operations_intro"] as const

export type OperationsEmailKind = (typeof OPERATIONS_EMAIL_KINDS)[number]

export type OperationsEmailDraftInput = {
  kind: OperationsEmailKind
  contactName: string
  accountName: string
  eventLabel: string
  quantity: number
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

const JENNY_SIGN_OFF = ["Kind regards,", "Jenny Kent", "ZK Sports & Entertainment"] as const

export function buildOperationsEmailDraft(input: OperationsEmailDraftInput): Omit<OperationsEmailDraft, "toEmail"> {
  const greeting = firstName(input.contactName)
  const event = input.eventLabel.trim() || "your upcoming event"
  const guests = guestWord(input.quantity)
  const account = input.accountName.trim() || "your company"

  if (input.kind === "guest_details") {
    return {
      kind: input.kind,
      toName: input.contactName.trim() || account,
      subject: `Guest details needed — ${event}`,
      body: [
        `Hi ${greeting},`,
        "",
        "I'm Jenny from ZK Sports & Entertainment. Thank you for confirming this booking with us.",
        "",
        `To get tickets and delivery organised for ${event}, I now need guest details for the ${guests} on this booking.`,
        "",
        "Please reply to this email with the following for each guest:",
        "• Full name, as it appears on their passport or photo ID",
        "• Date of birth",
        "• Nationality",
        "• Email and mobile number",
        "• Any dietary requirements, accessibility needs, or other notes we should know",
        "",
        "Once I have this, I can prepare the tickets and send them across ahead of the event.",
        "",
        "If anything has changed on the booking, or you would rather we collect the names another way, just reply and I will help.",
        "",
        ...JENNY_SIGN_OFF,
      ].join("\n"),
    }
  }

  return {
    kind: input.kind,
    toName: input.contactName.trim() || account,
    subject: `Next steps for ${event}`,
    body: [
      `Hi ${greeting},`,
      "",
      `I'm Jenny from ZK Sports & Entertainment. I hope you are well. Now that the ${account} booking for ${event} is confirmed, I wanted to introduce myself — I will look after guest names, tickets, and delivery from here, so you have one place to go with any practical questions.`,
      "",
      "What happens next:",
      "1. We collect guest details for each place on the booking",
      "2. We send the tickets to you (or the named guests) ahead of the event",
      "",
      "Please reply to this email if you need anything on seating, hospitality, delivery timing, or guest names. Your sales contact remains available for anything commercial.",
      "",
      "I will be in touch again once tickets are ready to send.",
      "",
      ...JENNY_SIGN_OFF,
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
