import { Resend } from "resend"
import {
  DEFAULT_BOOKINGS_CC,
  getResendApiKey,
  getResendFromAddress,
  stripSurroundingQuotes,
} from "@/lib/email/config"

export { DEFAULT_BOOKINGS_CC }

type BookingFormEmail = {
  recipientEmail: string
  recipientName: string
  accountName: string
  documentRef: string
  eventName: string
  totalLabel: string
  signingUrl: string
  expiresAt: string
  pdf?: Uint8Array
}

type EmailResult = { ok: boolean; skipped?: string; error?: string }

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export function bookingFormCc(to: string[]): string[] {
  const exclude = new Set(to.map((email) => email.trim().toLowerCase()))
  if (exclude.has(DEFAULT_BOOKINGS_CC)) return []
  return [DEFAULT_BOOKINGS_CC]
}

async function send(input: {
  to: string[]
  cc?: string[]
  subject: string
  html: string
  attachments?: Array<{ filename: string; content: Buffer }>
}): Promise<EmailResult> {
  const apiKey = getResendApiKey()
  const from = getResendFromAddress()
  if (!apiKey || !from) {
    return { ok: false, skipped: "RESEND_API_KEY or email sender is not configured" }
  }
  const resend = new Resend(apiKey)
  const cc = input.cc?.filter(Boolean) ?? []
  const { error } = await resend.emails.send({
    from,
    to: input.to,
    ...(cc.length === 1 ? { cc: cc[0] } : cc.length > 0 ? { cc } : {}),
    subject: input.subject,
    html: input.html,
    attachments: input.attachments,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

function signingEmailHtml(input: BookingFormEmail, reminder: boolean): string {
  const expiry = new Date(input.expiresAt).toLocaleString("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  })
  return [
    `<p>Hi ${escapeHtml(input.recipientName)},</p>`,
    reminder
      ? "<p>This is a reminder that your ZK booking form is still awaiting your signature.</p>"
      : `<p>Please review and sign the booking form for <strong>${escapeHtml(input.accountName)}</strong>.</p>`,
    `<p><strong>${escapeHtml(input.eventName)}</strong><br/>`,
    `Reference: ${escapeHtml(input.documentRef)}<br/>`,
    `Total: ${escapeHtml(input.totalLabel)}</p>`,
    `<p><a href="${escapeHtml(input.signingUrl)}" style="display:inline-block;background:#F90202;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:700">Review and sign booking form</a></p>`,
    `<p>This secure link expires on ${escapeHtml(expiry)} UTC. Stock is held until then; if the form is not signed in time, the hold and form will expire automatically.</p>`,
    "<p>If you were not expecting this email, please contact ZK Sports directly and do not forward the signing link.</p>",
    "<p>Thank you,<br/>ZK Sports &amp; Entertainment</p>",
  ].join("")
}

function bookingPdfAttachment(input: BookingFormEmail) {
  if (!input.pdf) return undefined
  return [
    {
      filename: `Booking-Form-${input.documentRef.replace(/[^\w.-]+/g, "-")}.pdf`,
      content: Buffer.from(input.pdf),
    },
  ]
}

function manualBookingEmailHtml(input: BookingFormEmail): string {
  const expiry = new Date(input.expiresAt).toLocaleString("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  })
  return [
    `<p>Hi ${escapeHtml(input.recipientName)},</p>`,
    `<p>Please find attached the booking form for <strong>${escapeHtml(input.accountName)}</strong>.</p>`,
    `<p><strong>${escapeHtml(input.eventName)}</strong><br/>`,
    `Reference: ${escapeHtml(input.documentRef)}<br/>`,
    `Total: ${escapeHtml(input.totalLabel)}</p>`,
    "<p>Review the attached PDF and reply if any names, products, or terms need changing. When you are ready to sign electronically, use the secure link below.</p>",
    `<p><a href="${escapeHtml(input.signingUrl)}" style="display:inline-block;background:#F90202;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:700">Review and sign booking form</a></p>`,
    `<p>This secure link expires on ${escapeHtml(expiry)} UTC. Stock is held until then.</p>`,
    "<p>Thank you,<br/>ZK Sports &amp; Entertainment</p>",
  ].join("")
}

export function sendNativeBookingFormEmail(input: BookingFormEmail) {
  const to = [input.recipientEmail]
  return send({
    to,
    cc: bookingFormCc(to),
    subject: `Signature requested: ${input.eventName} — ${input.documentRef}`,
    html: signingEmailHtml(input, false),
    attachments: bookingPdfAttachment(input),
  })
}

export function sendManualNativeBookingFormEmail(input: BookingFormEmail) {
  const to = [input.recipientEmail]
  return send({
    to,
    cc: bookingFormCc(to),
    subject: `Booking form: ${input.eventName} — ${input.documentRef}`,
    html: manualBookingEmailHtml(input),
    attachments: bookingPdfAttachment(input),
  })
}

export function sendNativeBookingFormReminder(input: BookingFormEmail) {
  return send({
    to: [input.recipientEmail],
    subject: `Reminder: booking form expires soon — ${input.documentRef}`,
    html: signingEmailHtml(input, true),
  })
}

export function sendCompletedBookingFormEmail(input: {
  clientEmail: string
  clientName: string
  /** Kept so callers can still pass the countersigner; they are not emailed. */
  adminEmail?: string
  documentRef: string
  eventName: string
  pdf: Uint8Array
}) {
  const to = [input.clientEmail]
  return send({
    to,
    cc: bookingFormCc(to),
    subject: `Completed booking form — ${input.documentRef}`,
    html: [
      `<p>Hi ${escapeHtml(input.clientName)},</p>`,
      `<p>Your booking form for <strong>${escapeHtml(input.eventName)}</strong> has now been signed by both parties.</p>`,
      `<p>The completed agreement is attached for your records. Reference: <strong>${escapeHtml(input.documentRef)}</strong>.</p>`,
      "<p>Thank you,<br/>ZK Sports &amp; Entertainment</p>",
    ].join(""),
    attachments: [
      {
        filename: `Booking-Form-${input.documentRef.replace(/[^\w.-]+/g, "-")}.pdf`,
        content: Buffer.from(input.pdf),
      },
    ],
  })
}

export const DEFAULT_CLIENT_SIGNED_NOTIFY_EMAILS = [
  "michel@zk-sports.com",
  "oliver@zk-sports.com",
] as const

export function parseNotifyEmails(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,;]/)
        .map((value) => stripSurroundingQuotes(value.trim()).toLowerCase())
        .filter((value) => value.includes("@")),
    ),
  ]
}

/** Client-signed alerts go only to Ollie and Michel, unless BOOKING_FORM_ADMIN_EMAILS overrides. */
export function clientSignedNotificationRecipients(
  envValue = process.env.BOOKING_FORM_ADMIN_EMAILS ?? "",
): string[] {
  const fromEnv = parseNotifyEmails(envValue)
  return fromEnv.length ? fromEnv : [...DEFAULT_CLIENT_SIGNED_NOTIFY_EMAILS]
}

export async function sendClientSignedBookingFormNotification(input: {
  documentRef: string
  clientName: string
  accountName: string
  eventName: string
  dealsUrl: string
}): Promise<EmailResult> {
  const recipients = clientSignedNotificationRecipients()
  if (!recipients.length) {
    return { ok: false, skipped: "No admin email addresses were found to notify." }
  }
  return send({
    to: recipients,
    subject: `ZK signature required — ${input.documentRef}`,
    html: [
      "<p>A client has signed a native booking form and an approved ZK admin must now review and countersign it.</p>",
      `<p><strong>${escapeHtml(input.eventName)}</strong><br/>`,
      `Account: ${escapeHtml(input.accountName)}<br/>`,
      `Client signer: ${escapeHtml(input.clientName)}<br/>`,
      `Reference: ${escapeHtml(input.documentRef)}</p>`,
      `<p><a href="${escapeHtml(input.dealsUrl)}">Open Deals and review the agreement</a></p>`,
    ].join(""),
  })
}

