import { Resend } from "resend"
import { getResendApiKey, getResendFromAddress } from "@/lib/email/config"
import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import { whatsAppReplyNeededEmail } from "@/lib/assistant/reply-needed"
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
  kind: "review" | "booking_form" | "source" | "reply_needed"
  dealReference?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = getResendApiKey()
  const from = getResendFromAddress()
  if (!apiKey || !from) return { ok: false, error: "Email sender is not configured." }
  const recipients = [...new Set(input.to.map((value) => value.trim().toLowerCase()).filter((value) => value.includes("@")))]
  if (recipients.length === 0) return { ok: false, error: "No notify addresses." }
  const href = `${getServerSiteOrigin()}${ASSISTANT_INBOX_HREF}/${input.conversationId}`
  const replyNeeded =
    input.kind === "reply_needed"
      ? whatsAppReplyNeededEmail({
          clientName: input.clientName,
          preview: input.draft?.trim() || input.reason,
          href,
          dealReference: input.dealReference,
        })
      : null
  const subject = replyNeeded
    ? replyNeeded.subject
    : input.kind === "booking_form"
      ? `Sales assistant: booking form ready to prepare — ${input.clientName}`
      : input.kind === "source"
        ? `Sales assistant: sourcing needed — ${input.clientName}`
        : `Sales assistant needs you — ${input.clientName}`
  const text = replyNeeded
    ? replyNeeded.text
    : [
        input.reason,
        "",
        input.draft ? `Draft:\n${input.draft}` : "",
        "",
        href,
      ]
        .filter(Boolean)
        .join("\n")
  const html = replyNeeded
    ? `<p>${escapeHtml(input.clientName.trim() || "A client")} replied on WhatsApp and needs a reply.</p><pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(input.draft?.trim() || input.reason)}</pre>${
        input.dealReference?.trim() ? `<p>Enquiry: ${escapeHtml(input.dealReference.trim())}</p>` : ""
      }<p><a href="${escapeHtml(href)}">Reply in Inbox</a></p>`
    : `<p>${escapeHtml(input.reason)}</p>${
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
