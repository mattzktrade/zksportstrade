import { Resend } from "resend"
import { getResendApiKey, getResendFromAddress } from "@/lib/email/config"
import { ADGP_NOTIFY_EMAILS } from "@/lib/integrations/adgp/config"

export type WebsiteOrderEmailPayload = {
  orderReference: string
  dealReference: string
  packageName: string
  day?: string | null
  guests: number
  totalAmount: number
  currency: string
  clientName: string
  clientEmail: string
  clientPhone: string
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

function experienceLine(packageName: string, day?: string | null): string {
  const label = day?.trim()
  return label ? `${packageName} — ${label}` : packageName
}

export function websiteOrderNotifyRecipients(): string[] {
  return [...ADGP_NOTIFY_EMAILS]
}

export function websiteCustomerEmailSubject(packageName: string): string {
  return `Your booking is confirmed — ${packageName}`
}

export function websiteCustomerEmailHtml(p: WebsiteOrderEmailPayload): string {
  const firstName = p.clientName.trim().split(/\s+/)[0] || "there"
  return [
    `<p>Hi ${escapeHtml(firstName)},</p>`,
    `<p>Thank you for your booking. We have received your payment and your order is confirmed.</p>`,
    `<p><strong>Booking reference:</strong> ${escapeHtml(p.orderReference)}<br/>`,
    `<strong>Experience:</strong> ${escapeHtml(experienceLine(p.packageName, p.day))}<br/>`,
    `<strong>Guests:</strong> ${p.guests}<br/>`,
    `<strong>Total paid:</strong> ${escapeHtml(formatMoney(p.totalAmount, p.currency))}</p>`,
    `<p>Tickets are issued digitally by the promoter closer to race week. We will follow up with guest details then.</p>`,
    `<p>Questions: <a href="mailto:info@zk-sports.com">info@zk-sports.com</a> or WhatsApp +971 55 608 9074.</p>`,
    `<p>ZK Sports &amp; Entertainment</p>`,
  ].join("")
}

export async function sendWebsiteOrderEmail(
  p: WebsiteOrderEmailPayload,
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const apiKey = getResendApiKey()
  const from = getResendFromAddress()
  if (!apiKey || !from) {
    return { ok: false, skipped: "RESEND_API_KEY or email sender is not configured." }
  }

  const to = websiteOrderNotifyRecipients()
  const resend = new Resend(apiKey)
  const subject = `Website booking ${p.orderReference} — ${p.packageName}`
  const html = [
    `<p>A customer paid on the Abu Dhabi GP website.</p>`,
    `<p><strong>Order:</strong> ${escapeHtml(p.orderReference)}<br/>`,
    `<strong>Deal:</strong> ${escapeHtml(p.dealReference)}<br/>`,
    `<strong>Package:</strong> ${escapeHtml(experienceLine(p.packageName, p.day))}<br/>`,
    `<strong>Guests:</strong> ${p.guests}<br/>`,
    `<strong>Total:</strong> ${escapeHtml(formatMoney(p.totalAmount, p.currency))}</p>`,
    `<p><strong>Client</strong><br/>`,
    `${escapeHtml(p.clientName)}<br/>`,
    `${escapeHtml(p.clientEmail)}<br/>`,
    `${escapeHtml(p.clientPhone || "—")}</p>`,
    `<p>Source is Website. Owner is Matt. The deal is marked paid.</p>`,
  ].join("")

  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function sendWebsiteCustomerEmail(
  p: WebsiteOrderEmailPayload,
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const apiKey = getResendApiKey()
  const from = getResendFromAddress()
  const to = p.clientEmail.trim()
  if (!apiKey || !from) {
    return { ok: false, skipped: "RESEND_API_KEY or email sender is not configured." }
  }
  if (!to.includes("@")) {
    return { ok: false, skipped: "Customer email is missing." }
  }

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from,
    to,
    replyTo: "info@zk-sports.com",
    subject: websiteCustomerEmailSubject(p.packageName),
    html: websiteCustomerEmailHtml(p),
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}
