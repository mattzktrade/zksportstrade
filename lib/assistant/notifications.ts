import { Resend } from "resend"
import { getResendApiKey, getResendFromAddress } from "@/lib/email/config"
import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import { ASSISTANT_INBOX_HREF } from "@/lib/assistant/types"

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export async function sendAssistantStaffAlert(input: {
  to: string[]
  conversationId: string
  clientName: string
  reason: string
  draft?: string
  kind: "review" | "booking_form" | "source"
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = getResendApiKey()
  const from = getResendFromAddress()
  if (!apiKey || !from) return { ok: false, error: "Email sender is not configured." }
  const recipients = [...new Set(input.to.map((value) => value.trim().toLowerCase()).filter((value) => value.includes("@")))]
  if (recipients.length === 0) return { ok: false, error: "No notify addresses." }
  const href = `${getServerSiteOrigin()}${ASSISTANT_INBOX_HREF}/${input.conversationId}`
  const subject =
    input.kind === "booking_form"
      ? `Sales assistant: booking form ready to prepare — ${input.clientName}`
      : input.kind === "source"
        ? `Sales assistant: sourcing needed — ${input.clientName}`
        : `Sales assistant needs you — ${input.clientName}`
  const text = [
    input.reason,
    "",
    input.draft ? `Draft:\n${input.draft}` : "",
    "",
    href,
  ]
    .filter(Boolean)
    .join("\n")
  const html = `<p>${escapeHtml(input.reason)}</p>${
    input.draft ? `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(input.draft)}</pre>` : ""
  }<p><a href="${escapeHtml(href)}">Open the conversation</a></p>`
  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from,
    to: recipients,
    subject,
    text,
    html,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}
