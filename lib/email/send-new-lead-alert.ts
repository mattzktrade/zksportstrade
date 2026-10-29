import { Resend } from "resend"
import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import { getResendApiKey, getResendFromAddress } from "@/lib/email/config"
import { adminEnquiryListPath } from "@/lib/crm/deal-pipeline"
import { MARKETING_LEAD_NOTIFY_EMAILS } from "@/lib/integrations/marketing-leads/notify"

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

export async function sendNewLeadAlert(input: {
  dealId: string
  reference: string
  name: string
  phone: string | null
  email: string | null
  event: string | null
  packageName: string | null
}): Promise<void> {
  const apiKey = getResendApiKey()
  const from = getResendFromAddress()
  if (!apiKey || !from) return
  const to = [...MARKETING_LEAD_NOTIFY_EMAILS]

  const link = `${getServerSiteOrigin()}${adminEnquiryListPath(input.dealId)}`
  const interest = [input.packageName, input.event].filter(Boolean).join(" · ") || "Marketing lead"
  const lines = [
    `New lead: ${input.name}`,
    interest,
    input.phone ? `Phone: ${input.phone}` : "No phone number",
    input.email ? `Email: ${input.email}` : "",
    "",
    "Call them in the next 5 minutes, then log the call in the CRM.",
    link,
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "")
  const html = `
    <p style="font:600 16px Arial,sans-serif;margin:0 0 6px">New lead: ${escapeHtml(input.name)}</p>
    <p style="font:14px Arial,sans-serif;margin:0 0 12px;color:#555">${escapeHtml(interest)}</p>
    ${input.phone ? `<p style="font:14px Arial,sans-serif;margin:0 0 4px"><a href="tel:${escapeHtml(input.phone)}">${escapeHtml(input.phone)}</a></p>` : ""}
    ${input.email ? `<p style="font:14px Arial,sans-serif;margin:0 0 12px">${escapeHtml(input.email)}</p>` : ""}
    <p style="font:14px Arial,sans-serif;margin:0 0 16px">Call them in the next 5 minutes, then log the call in the CRM.</p>
    <a href="${escapeHtml(link)}" style="display:inline-block;background:#F90202;color:#fff;font:600 14px Arial,sans-serif;padding:10px 16px;border-radius:6px;text-decoration:none">Open ${escapeHtml(input.reference || "the enquiry")}</a>
  `
  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from,
    to,
    subject: `Call now: ${input.name}${input.event ? ` — ${input.event}` : ""}`,
    html,
    text: lines.join("\n"),
  })
  if (error) console.error("[new-lead-alert]", error.message)
}
