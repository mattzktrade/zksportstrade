import { Resend } from "resend"
import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import { getResendApiKey, getResendFromAddress } from "@/lib/email/config"
import { adminEnquiryListPath } from "@/lib/crm/deal-pipeline"

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

export async function sendFollowUpReminder(input: {
  to: string[]
  dealId: string
  reference: string
  name: string
  phone: string | null
  email: string | null
  event: string | null
  reminderNo: number
  lastSpoke: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = getResendApiKey()
  const from = getResendFromAddress()
  if (!apiKey || !from) return { ok: false, error: "Email sender is not configured." }
  const to = [...new Set(input.to.map((value) => value.trim().toLowerCase()).filter((value) => value.includes("@")))]
  if (to.length === 0) return { ok: false, error: "No recipients." }

  const link = `${getServerSiteOrigin()}${adminEnquiryListPath(input.dealId)}`
  const heading = `Still deciding: ${input.name}`
  const prompt =
    input.reminderNo <= 1
      ? "They've had a day since you first spoke. Check in by call, WhatsApp or email, then log it in the CRM."
      : input.reminderNo === 2
        ? "Still deciding. Check in again, then log it in the CRM or move the enquiry on."
        : "Last reminder. If there's no reply in 7 days, this enquiry will close as Not interested."
  const lines = [
    heading,
    input.event ?? "",
    input.phone ? `Phone: ${input.phone}` : "",
    input.email ? `Email: ${input.email}` : "",
    input.lastSpoke ? `Last spoke: ${input.lastSpoke}` : "",
    "",
    prompt,
    link,
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "")
  const html = `
    <p style="font:600 16px Arial,sans-serif;margin:0 0 6px">${escapeHtml(heading)}</p>
    ${input.event ? `<p style="font:14px Arial,sans-serif;margin:0 0 12px;color:#555">${escapeHtml(input.event)}</p>` : ""}
    ${input.phone ? `<p style="font:14px Arial,sans-serif;margin:0 0 4px"><a href="tel:${escapeHtml(input.phone)}">${escapeHtml(input.phone)}</a></p>` : ""}
    ${input.email ? `<p style="font:14px Arial,sans-serif;margin:0 0 12px">${escapeHtml(input.email)}</p>` : ""}
    ${input.lastSpoke ? `<p style="font:14px Arial,sans-serif;margin:0 0 12px;color:#555">Last spoke: ${escapeHtml(input.lastSpoke)}</p>` : ""}
    <p style="font:14px Arial,sans-serif;margin:0 0 16px">${escapeHtml(prompt)}</p>
    <a href="${escapeHtml(link)}" style="display:inline-block;background:#F90202;color:#fff;font:600 14px Arial,sans-serif;padding:10px 16px;border-radius:6px;text-decoration:none">Open ${escapeHtml(input.reference || "the enquiry")}</a>
  `
  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from,
    to,
    subject: `${heading}${input.event ? ` — ${input.event}` : ""}`,
    html,
    text: lines.join("\n"),
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}
