import { Resend } from "resend"
import { stripSurroundingQuotes } from "@/lib/email/config"

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export type BookingApprovalRejectedEmailPayload = {
  agentEmail: string
  agentName: string
  requestReference: string
  packageName: string
  circuit: string
  rejectionNote: string | null
}

export async function sendBookingApprovalRejectedEmail(
  p: BookingApprovalRejectedEmailPayload,
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from =
    stripSurroundingQuotes(process.env.ORDER_EMAIL_FROM?.trim() ?? "") ||
    stripSurroundingQuotes(process.env.AUTH_EMAIL_FROM?.trim() ?? "")
  if (!apiKey || !from) {
    return { ok: false, skipped: "RESEND_API_KEY or ORDER_EMAIL_FROM not configured" }
  }

  const resend = new Resend(apiKey)
  const subject = `Booking request declined — ${p.requestReference}`

  const lines = [
    `<p>Hi ${escapeHtml(p.agentName)},</p>`,
    `<p>Unfortunately we are unable to approve your Paddock Club booking request at this time.</p>`,
    `<p><strong>Request reference:</strong> ${escapeHtml(p.requestReference)}<br/>`,
    `<strong>Package:</strong> ${escapeHtml(p.packageName)} — ${escapeHtml(p.circuit)}</p>`,
  ]
  if (p.rejectionNote) {
    lines.push(`<p><strong>Note from our team:</strong><br/>${escapeHtml(p.rejectionNote)}</p>`)
  }
  lines.push(
    `<p>No booking has been created and no inventory has been reserved. Please contact us if you would like to discuss alternatives.</p>`,
    `<p>Thank you,<br/>ZK Sports &amp; Entertainment</p>`,
  )

  const { error } = await resend.emails.send({
    from,
    to: [p.agentEmail],
    subject,
    html: lines.join(""),
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
