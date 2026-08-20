import { Resend } from "resend"
import { getResendApiKey, getResendFromAddress } from "@/lib/email/config"
import { stripSurroundingQuotes } from "@/lib/email/config"
import { createAdminClient } from "@/lib/supabase/admin"

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

async function send(input: {
  to: string[]
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
  const { error } = await resend.emails.send({
    from,
    to: input.to,
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
    `<p><a href="${escapeHtml(input.signingUrl)}" style="display:inline-block;background:#12a66f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:700">Review and sign booking form</a></p>`,
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
    `<p><a href="${escapeHtml(input.signingUrl)}" style="display:inline-block;background:#12a66f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:700">Review and sign booking form</a></p>`,
    `<p>This secure link expires on ${escapeHtml(expiry)} UTC. Stock is held until then.</p>`,
    "<p>Thank you,<br/>ZK Sports &amp; Entertainment</p>",
  ].join("")
}

export function sendNativeBookingFormEmail(input: BookingFormEmail) {
  return send({
    to: [input.recipientEmail],
    subject: `Signature requested: ${input.eventName} — ${input.documentRef}`,
    html: signingEmailHtml(input, false),
    attachments: bookingPdfAttachment(input),
  })
}

export function sendManualNativeBookingFormEmail(input: BookingFormEmail) {
  return send({
    to: [input.recipientEmail],
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
  adminEmail: string
  documentRef: string
  eventName: string
  pdf: Uint8Array
}) {
  return send({
    to: [...new Set([input.clientEmail.toLowerCase(), input.adminEmail.toLowerCase()])],
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

function parseNotifyEmails(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,;]/)
        .map((value) => stripSurroundingQuotes(value.trim()).toLowerCase())
        .filter(Boolean),
    ),
  ]
}

async function resolveBookingFormAdminEmails(extra: string[] = []): Promise<string[]> {
  const fromEnv = parseNotifyEmails(
    [
      process.env.BOOKING_FORM_ADMIN_EMAILS,
      process.env.BOOKING_APPROVAL_NOTIFICATION_EMAILS,
      process.env.FINANCE_NOTIFICATION_EMAILS,
      process.env.FINANCE_TEAM_EMAIL,
    ]
      .filter(Boolean)
      .join(","),
  )
  const fromStaff: string[] = []
  const admin = createAdminClient()
  if (admin) {
    const { data } = await admin
      .from("profiles")
      .select("email, role")
      .eq("role", "admin")
    for (const row of data ?? []) {
      const email = String(row.email ?? "").trim().toLowerCase()
      if (email.includes("@")) fromStaff.push(email)
    }
  }
  return [
    ...new Set([
      ...fromEnv,
      ...fromStaff,
      ...extra.map((value) => value.trim().toLowerCase()).filter((value) => value.includes("@")),
    ]),
  ]
}

export async function sendClientSignedBookingFormNotification(input: {
  documentRef: string
  clientName: string
  accountName: string
  eventName: string
  dealsUrl: string
  extraEmails?: string[]
}): Promise<EmailResult> {
  const recipients = await resolveBookingFormAdminEmails(input.extraEmails)
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

