import type { AssistantChannel, AssistantSettings, AssistantStatus } from "@/lib/assistant/types"

export const WHATSAPP_REPLY_NOTIFY_BURST_MS = 3 * 60 * 1000

export function assistantWillAutoReply(input: {
  channel: AssistantChannel | string
  status: AssistantStatus | string
  autoSendEnabled: boolean
  llmConfigured: boolean
  killSwitch: boolean
}): boolean {
  if (input.killSwitch) return false
  if (input.status === "human_takeover" || input.status === "closed") return false
  if (input.channel !== "whatsapp" && input.channel !== "email") return false
  return input.autoSendEnabled && input.llmConfigured
}

export function whatsAppReplyNoticeDue(input: {
  channel: AssistantChannel | string
  willAutoReply: boolean
  duplicate?: boolean
  mediaType?: string | null
}): boolean {
  if (input.duplicate) return false
  if (input.channel !== "whatsapp") return false
  if (input.mediaType === "reaction") return false
  return !input.willAutoReply
}

export function inWhatsAppReplyNotifyBurst(
  previousLastClientAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!previousLastClientAt) return false
  const stamp = Date.parse(previousLastClientAt)
  if (!Number.isFinite(stamp)) return false
  return now - stamp < WHATSAPP_REPLY_NOTIFY_BURST_MS
}

export function whatsAppReplyPreview(body: string, mediaType?: string | null): string {
  const text = body.replace(/\r\n/g, "\n").trim()
  if (text) return text.length > 800 ? `${text.slice(0, 797)}...` : text
  if (mediaType === "reaction") return "Reacted"
  if (mediaType && mediaType !== "text") return "(photo or file)"
  return "(no text)"
}

export function whatsAppReplyNeededEmail(input: {
  clientName: string
  preview: string
  href: string
  dealReference?: string | null
  channel?: "whatsapp" | "email"
}): { subject: string; text: string } {
  const name = input.clientName.trim() || "A client"
  const deal = input.dealReference?.trim()
  const via = input.channel === "email" ? "email" : "WhatsApp"
  return {
    subject: `${input.channel === "email" ? "Email" : "WhatsApp"} from ${name} — reply in Inbox`,
    text: [
      `${name} replied on ${via} and needs a reply.`,
      "",
      input.preview,
      "",
      deal ? `Enquiry: ${deal}` : "",
      `Open Inbox: ${input.href}`,
    ]
      .filter((line, index, rows) => line !== "" || rows[index - 1] !== "")
      .join("\n")
      .trim(),
  }
}

export function assistantWillAutoReplyFromSettings(
  settings: Pick<AssistantSettings, "autoSendEnabled" | "killSwitch">,
  input: { channel: AssistantChannel | string; status: AssistantStatus | string; llmConfigured: boolean },
): boolean {
  return assistantWillAutoReply({
    channel: input.channel,
    status: input.status,
    autoSendEnabled: settings.autoSendEnabled,
    llmConfigured: input.llmConfigured,
    killSwitch: settings.killSwitch,
  })
}
