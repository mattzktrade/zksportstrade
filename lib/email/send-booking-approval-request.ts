import { Resend } from "resend"
import { stripSurroundingQuotes } from "@/lib/email/config"

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

function parseAdminNotifyEmails(): string[] {
  const raw =
    process.env.BOOKING_APPROVAL_NOTIFICATION_EMAILS ??
    process.env.FINANCE_NOTIFICATION_EMAILS ??
    process.env.FINANCE_TEAM_EMAIL ??
    ""
  return raw
    .split(/[,;]/g)
    .map((s) => stripSurroundingQuotes(s.trim()))
    .filter((s) => s.length > 0)
}

export type BookingApprovalRequestEmailPayload = {
  requestReference: string
  packageName: string
  circuit: string
  guests: number
  totalAmount: number
  currency: string
  agentName: string
  agentEmail: string
  agentCompany: string
  clientName: string
  clientEmail: string
  clientPhone: string
  adminReviewUrl: string
  approveUrl: string
}

export async function sendBookingApprovalRequestAdminEmail(
  p: BookingApprovalRequestEmailPayload,
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from =
    stripSurroundingQuotes(process.env.ORDER_EMAIL_FROM?.trim() ?? "") ||
    stripSurroundingQuotes(process.env.AUTH_EMAIL_FROM?.trim() ?? "")
  if (!apiKey || !from) {
    return { ok: false, skipped: "RESEND_API_KEY or ORDER_EMAIL_FROM not configured" }
  }

  const to = parseAdminNotifyEmails()
  if (to.length === 0) {
    return { ok: false, skipped: "BOOKING_APPROVAL_NOTIFICATION_EMAILS not configured" }
  }

  const resend = new Resend(apiKey)
  const subject = `Paddock Club approval needed — ${p.requestReference}`
  const safeApproveUrl = escapeHtml(p.approveUrl)
  const safeReviewUrl = escapeHtml(p.adminReviewUrl)

  const html = [
    `<p>A partner has submitted a <strong>Paddock Club booking request</strong> that needs your approval before it is confirmed.</p>`,
    `<p><strong>Request reference:</strong> ${escapeHtml(p.requestReference)}</p>`,
    `<p><strong>Package:</strong> ${escapeHtml(p.packageName)} — ${escapeHtml(p.circuit)}<br/>`,
    `Guests: ${p.guests}<br/>`,
    `Total: ${escapeHtml(formatMoney(p.totalAmount, p.currency))}</p>`,
    `<p><strong>Agent</strong><br/>`,
    `${escapeHtml(p.agentName)} (${escapeHtml(p.agentEmail)})<br/>`,
    `${escapeHtml(p.agentCompany || "—")}</p>`,
    `<p><strong>Client</strong><br/>`,
    `${escapeHtml(p.clientName)}<br/>`,
    `${escapeHtml(p.clientEmail)}<br/>`,
    `${escapeHtml(p.clientPhone)}</p>`,
  ].join("")

  const actionHtml = [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0 16px;">`,
    `<tr><td align="center">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0">`,
    `<tr><td align="center" bgcolor="#b91c1c" style="border-radius:10px;">`,
    `<a href="${safeApproveUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:15px 36px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">Approve booking</a>`,
    `</td></tr></table>`,
    `</td></tr></table>`,
    `<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#52525b;text-align:center;">`,
    `<a href="${safeReviewUrl}" target="_blank" rel="noopener noreferrer" style="color:#b91c1c;font-weight:600;">Review in admin portal</a>`,
    `</p>`,
    `<p style="margin:0 0 24px;padding:14px 16px;background-color:#fafafa;border:1px solid #e4e4e7;border-radius:10px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#52525b;">`,
    `<strong style="color:#18181b;">Button not working?</strong><br/>`,
    `<a href="${safeApproveUrl}" target="_blank" rel="noopener noreferrer" style="color:#b91c1c;font-weight:600;word-break:break-all;">${safeApproveUrl}</a>`,
    `</p>`,
    `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#a1a1aa;">ZK Sports &amp; Entertainment portal</p>`,
  ].join("")

  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    html: html + actionHtml,
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
