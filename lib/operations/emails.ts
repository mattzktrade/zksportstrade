export const OPERATIONS_EMAIL_KINDS = [
  "guest_details",
  "operations_intro",
  "guest_details_reminder",
  "names_sent",
  "collection_details",
  "tickets_sent",
  "after_event",
] as const

export type OperationsEmailKind = (typeof OPERATIONS_EMAIL_KINDS)[number]

export type OperationsEmailDraftInput = {
  kind: OperationsEmailKind
  contactName: string
  accountName: string
  eventLabel: string
  quantity: number
  formUrl?: string | null
  deadline?: string | null
  collectionPoint?: string | null
  collectionTime?: string | null
  template?: { subject: string; body: string } | null
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

export type OperationsEmailTemplate = {
  kind: OperationsEmailKind
  subject: string
  body: string
  updatedAt?: string | null
}

const KIND_SET = new Set<string>(OPERATIONS_EMAIL_KINDS)

export function isOperationsEmailKind(value: string): value is OperationsEmailKind {
  return KIND_SET.has(value)
}

export function operationsEmailKindLabel(kind: OperationsEmailKind): string {
  switch (kind) {
    case "guest_details":
      return "Guest details request"
    case "operations_intro":
      return "Operations introduction"
    case "guest_details_reminder":
      return "Guest details reminder"
    case "names_sent":
      return "Names sent to supplier"
    case "collection_details":
      return "Collection / delivery details"
    case "tickets_sent":
      return "Tickets sent"
    case "after_event":
      return "After the event"
  }
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

const JENNY_SIGN_OFF = "Kind regards,\nJenny Kent\nZK Sports & Entertainment"

const REPLY_DETAILS_BLOCK = [
  "Please reply to this email with the following for each guest:",
  "• Full name, as it appears on their passport or photo ID",
  "• Date of birth",
  "• Nationality",
  "• Email and mobile number",
  "• Any dietary requirements, accessibility needs, or other notes we should know",
].join("\n")

export const DEFAULT_OPERATIONS_EMAIL_TEMPLATES: Record<OperationsEmailKind, { subject: string; body: string }> = {
  operations_intro: {
    subject: "Next steps for {{event}}",
    body: [
      "Hi {{first_name}},",
      "",
      "I'm Jenny from ZK Sports & Entertainment. I hope you are well. Now that the {{account_name}} booking for {{event}} is confirmed, I wanted to introduce myself — I will look after guest names, tickets, and delivery from here, so you have one place to go with any practical questions.",
      "",
      "What happens next:",
      "1. We collect guest details for each place on the booking",
      "2. We send the tickets to you (or the named guests) ahead of the event",
      "",
      "Please reply to this email if you need anything on seating, hospitality, delivery timing, or guest names. Your sales contact remains available for anything commercial.",
      "",
      "I will be in touch again once tickets are ready to send.",
      "",
      JENNY_SIGN_OFF,
    ].join("\n"),
  },
  guest_details: {
    subject: "Guest details needed — {{event}}",
    body: [
      "Hi {{first_name}},",
      "",
      "I'm Jenny from ZK Sports & Entertainment. Thank you for confirming this booking with us.",
      "",
      "To get tickets and delivery organised for {{event}}, I now need guest details for the {{guests}} on this booking.",
      "",
      "{{guest_details_block}}",
      "",
      "Once I have this, I can prepare the tickets and send them across ahead of the event.",
      "",
      "If anything has changed on the booking, just reply and I will help.",
      "",
      JENNY_SIGN_OFF,
    ].join("\n"),
  },
  guest_details_reminder: {
    subject: "Reminder: guest details for {{event}}",
    body: [
      "Hi {{first_name}},",
      "",
      "Just a reminder that we still need guest details for {{event}} so we can meet the supplier deadline{{deadline_clause}}.",
      "",
      "{{guest_details_block}}",
      "",
      "Please send these as soon as you can.",
      "",
      JENNY_SIGN_OFF,
    ].join("\n"),
  },
  names_sent: {
    subject: "Guest names sent for {{event}}",
    body: [
      "Hi {{first_name}},",
      "",
      "I have sent the guest names for {{event}} through to the supplier. They will look after issuing and delivery from here.",
      "",
      "If anything on the booking changes, reply to this email and I will update them.",
      "",
      JENNY_SIGN_OFF,
    ].join("\n"),
  },
  collection_details: {
    subject: "Ticket collection for {{event}}",
    body: [
      "Hi {{first_name}},",
      "",
      "Tickets for {{event}} will be collected locally.",
      "",
      "Collection point: {{collection_point}}",
      "Collection time: {{collection_time}}",
      "",
      "Please have photo ID matching the guest names with you. Reply if you need to change the collection plan.",
      "",
      JENNY_SIGN_OFF,
    ].join("\n"),
  },
  tickets_sent: {
    subject: "Your tickets for {{event}}",
    body: [
      "Hi {{first_name}},",
      "",
      "Your tickets for {{event}} are attached / on the way. Please check names and dates, and keep them handy for entry.",
      "",
      "If anything looks wrong, reply to this email and I will help straight away.",
      "",
      JENNY_SIGN_OFF,
    ].join("\n"),
  },
  after_event: {
    subject: "Thank you for {{event}}",
    body: [
      "Hi {{first_name}},",
      "",
      "I hope you enjoyed {{event}}. If you would like to attend again next year, or there are any other races or events you would like to go to, just let us know — we would be happy to help.",
      "",
      JENNY_SIGN_OFF,
    ].join("\n"),
  },
}

export function guestDetailsBlock(formUrl?: string | null): string {
  const url = formUrl?.trim() ?? ""
  if (!url) return REPLY_DETAILS_BLOCK
  return [
    "Please complete this guest details form. You only need each guest’s full name and a clear recent headshot. You can save and finish later, or tick one person as the lead guest if the rest of the names are still to follow.",
    "",
    url,
    "",
    "If the link does not open, reply to this email with the names and photos and I will add them for you.",
  ].join("\n")
}

export function formatOperationsDeadline(iso: string | null | undefined): string {
  const date = iso?.trim().slice(0, 10) ?? ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ""
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

export function applyOperationsEmailTemplate(
  subject: string,
  body: string,
  vars: Record<string, string>,
): { subject: string; body: string } {
  let nextSubject = subject
  let nextBody = body
  for (const [key, value] of Object.entries(vars)) {
    const token = `{{${key}}}`
    nextSubject = nextSubject.split(token).join(value)
    nextBody = nextBody.split(token).join(value)
  }
  return { subject: nextSubject, body: nextBody }
}

export function buildOperationsEmailDraft(input: OperationsEmailDraftInput): Omit<OperationsEmailDraft, "toEmail"> {
  const greeting = firstName(input.contactName)
  const event = input.eventLabel.trim() || "your upcoming event"
  const guests = guestWord(input.quantity)
  const account = input.accountName.trim() || "your company"
  const deadline = input.deadline?.trim() ?? ""
  const template = input.template ?? DEFAULT_OPERATIONS_EMAIL_TEMPLATES[input.kind]
  const filled = applyOperationsEmailTemplate(template.subject, template.body, {
    first_name: greeting,
    contact_name: input.contactName.trim() || account,
    account_name: account,
    event,
    guests,
    guest_form_url: input.formUrl?.trim() ?? "",
    guest_details_block: guestDetailsBlock(input.formUrl),
    deadline,
    deadline_clause: deadline ? ` (${deadline})` : "",
    collection_point: input.collectionPoint?.trim() || "TBC",
    collection_time: input.collectionTime?.trim() || "TBC",
  })
  return {
    kind: input.kind,
    toName: input.contactName.trim() || account,
    subject: filled.subject,
    body: filled.body,
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
    .map((block) => {
      const text = block.replaceAll("\n", "<br/>")
      const url = block.replaceAll("<br/>", "").trim()
      if (/^https?:\/\/\S+\/guest-details\/[A-Za-z0-9_-]{40,60}\/?$/.test(url)) {
        return `<p style="margin:0 0 14px"><a href="${url}" style="display:inline-block;background:#F90202;color:#ffffff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:700">Complete guest details</a></p>`
      }
      return `<p style="margin:0 0 14px">${text}</p>`
    })
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#111">${blocks.join("")}</div>`
}
