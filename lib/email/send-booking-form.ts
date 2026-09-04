import { Resend } from "resend"
import {
  DEFAULT_BOOKINGS_CC,
  DEFAULT_CHELLEY_CC,
  getResendApiKey,
  getResendFromAddress,
  stripSurroundingQuotes,
} from "@/lib/email/config"

export { DEFAULT_BOOKINGS_CC, DEFAULT_CHELLEY_CC }

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

const BOOKING_FORM_CC = [DEFAULT_BOOKINGS_CC, DEFAULT_CHELLEY_CC] as const

export function bookingFormCc(to: string[]): string[] {
  const exclude = new Set(to.map((email) => email.trim().toLowerCase()))
  return BOOKING_FORM_CC.filter((email) => !exclude.has(email.toLowerCase()))
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
  const to = [input.recipientEmail]
  return send({
    to,
    cc: bookingFormCc(to),
    subject: `Reminder: booking form expires soon — ${input.documentRef}`,
    html: signingEmailHtml(input, true),
  })
}

function finalReminderEmailHtml(input: BookingFormEmail): string {
  const expiry = new Date(input.expiresAt).toLocaleString("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  })
  return [
    `<p>Hi ${escapeHtml(input.recipientName)},</p>`,
    "<p>This is a final reminder: please sign your ZK booking form. If it is not signed within the next hour, the stock hold will be released.</p>",
    `<p><strong>${escapeHtml(input.eventName)}</strong><br/>`,
    `Reference: ${escapeHtml(input.documentRef)}<br/>`,
    `Total: ${escapeHtml(input.totalLabel)}</p>`,
    `<p><a href="${escapeHtml(input.signingUrl)}" style="display:inline-block;background:#F90202;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:700">Review and sign booking form</a></p>`,
    `<p>This secure link expires on ${escapeHtml(expiry)} UTC.</p>`,
    "<p>If you were not expecting this email, please contact ZK Sports directly and do not forward the signing link.</p>",
    "<p>Thank you,<br/>ZK Sports &amp; Entertainment</p>",
  ].join("")
}

export function sendNativeBookingFormFinalReminder(input: BookingFormEmail) {
  const to = [input.recipientEmail]
  return send({
    to,
    cc: bookingFormCc(to),
    subject: `Please sign now — stock will be released in 1 hour — ${input.documentRef}`,
    html: finalReminderEmailHtml(input),
  })
}

type HoldReleasedEmail = {
  recipientEmail: string
  recipientName: string
  accountName: string
  documentRef: string
  eventName: string
  totalLabel: string
}

function holdReleasedEmailHtml(input: HoldReleasedEmail): string {
  return [
    `<p>Hi ${escapeHtml(input.recipientName)},</p>`,
    "<p>The signing window for this booking form has ended, so the stock is no longer held.</p>",
    `<p><strong>${escapeHtml(input.eventName)}</strong><br/>`,
    `Account: ${escapeHtml(input.accountName)}<br/>`,
    `Reference: ${escapeHtml(input.documentRef)}<br/>`,
    `Total: ${escapeHtml(input.totalLabel)}</p>`,
    "<p>If you are still interested, please contact the team again to extend.</p>",
    "<p>Thank you,<br/>ZK Sports &amp; Entertainment</p>",
  ].join("")
}

export function sendNativeBookingFormHoldReleased(input: HoldReleasedEmail) {
  const to = [input.recipientEmail]
  return send({
    to,
    cc: bookingFormCc(to),
    subject: `Stock is no longer held — ${input.documentRef}`,
    html: holdReleasedEmailHtml(input),
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

export const DEFAULT_BOOKING_FORM_READY_NOTIFY_EMAILS = [
  "matt@zk-sports.com",
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

/** Ready-to-send alerts go to Matt, Michel, and Ollie unless BOOKING_FORM_READY_NOTIFY_EMAILS overrides. */
export function bookingFormReadyNotificationRecipients(
  envValue = process.env.BOOKING_FORM_READY_NOTIFY_EMAILS ?? "",
): string[] {
  const fromEnv = parseNotifyEmails(envValue)
  return fromEnv.length ? fromEnv : [...DEFAULT_BOOKING_FORM_READY_NOTIFY_EMAILS]
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
    cc: bookingFormCc(recipients),
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

export async function sendBookingFormReadyToSendNotification(input: {
  documentRef: string
  accountName: string
  eventName: string
  clientName: string
  preparedByName: string
  dealUrl: string
}): Promise<EmailResult> {
  const recipients = bookingFormReadyNotificationRecipients()
  if (!recipients.length) {
    return { ok: false, skipped: "No admin email addresses were found to notify." }
  }
  return send({
    to: recipients,
    subject: `Booking form ready to send — ${input.documentRef}`,
    html: [
      `<p>${escapeHtml(input.preparedByName)} has prepared a booking form. An approved admin needs to send it to the client.</p>`,
      `<p><strong>${escapeHtml(input.eventName)}</strong><br/>`,
      `Account: ${escapeHtml(input.accountName)}<br/>`,
      `Client: ${escapeHtml(input.clientName)}<br/>`,
      `Reference: ${escapeHtml(input.documentRef)}</p>`,
      `<p>The form is saved as a draft. Stock is not reserved until an admin sends it.</p>`,
      `<p><a href="${escapeHtml(input.dealUrl)}">Open the deal and send the booking form</a></p>`,
    ].join(""),
  })
}

