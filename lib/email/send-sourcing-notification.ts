import { Resend } from "resend"
import { getResendApiKey, getResendFromAddress } from "@/lib/email/config"
import {
  buildSourcingNotification,
  type SourcingEnquirySnapshot,
  type SourcingNotification,
} from "@/lib/crm/sourcing-notifications"

export async function sendSourcingNotificationEmail(
  notification: SourcingNotification,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = getResendApiKey()
  const from = getResendFromAddress()
  if (!apiKey || !from) {
    return { ok: false, error: "RESEND_API_KEY or email sender is not configured." }
  }

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from,
    to: [notification.to],
    subject: notification.subject,
    html: notification.html,
    text: notification.text,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** Sends only when the enquiry has just moved into a sourcing stage. Stage saves must not depend on this. */
export async function deliverSourcingStageNotification(
  snapshot: SourcingEnquirySnapshot | null | undefined,
  nextStage: string,
): Promise<"sent" | "skipped" | "failed"> {
  if (!snapshot) return "skipped"
  const notification = buildSourcingNotification({ snapshot, nextStage })
  if (!notification) return "skipped"
  try {
    const result = await sendSourcingNotificationEmail(notification)
    if (!result.ok) {
      console.error("Sourcing notification email failed", result.error)
      return "failed"
    }
    return "sent"
  } catch (error) {
    console.error("Sourcing notification email failed", error)
    return "failed"
  }
}

export function sourcingEmailWarning(failedCount: number): string {
  if (failedCount <= 0) return ""
  if (failedCount === 1) return " The enquiry was saved, but the sourcing email could not be sent."
  return ` ${failedCount} sourcing emails could not be sent.`
}
