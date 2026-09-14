import { getWhatsAppCloudConfig } from "@/lib/integrations/marketing-leads/outreach-config"

export type WhatsAppTemplateSendResult =
  | { ok: true; id: string | null }
  | { ok: false; skipped?: string; error?: string }

type WhatsAppApiResponse = {
  messages?: Array<{ id?: string }>
  error?: { message?: string }
}

export async function sendWhatsAppTemplate(input: {
  toPhoneDigits: string
  templateName: string
  language: string
  bodyParameters: string[]
}): Promise<WhatsAppTemplateSendResult> {
  const config = getWhatsAppCloudConfig()
  if (!config) return { ok: false, skipped: "whatsapp_not_configured" }
  const templateName = input.templateName.trim()
  if (!templateName) return { ok: false, skipped: "template_missing" }
  const to = input.toPhoneDigits.replace(/\D/g, "")
  if (to.length < 8) return { ok: false, skipped: "no_phone" }

  const language = (input.language.trim() || "en").toLowerCase()
  const components =
    input.bodyParameters.length > 0
      ? [
          {
            type: "body",
            parameters: input.bodyParameters.map((text) => ({ type: "text", text })),
          },
        ]
      : undefined

  const response = await fetch(`https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
        ...(components ? { components } : {}),
      },
    }),
  })
  const raw = await response.text()
  let parsed: WhatsAppApiResponse | null = null
  try {
    parsed = JSON.parse(raw) as WhatsAppApiResponse
  } catch {
    parsed = null
  }
  if (!response.ok) {
    return { ok: false, error: parsed?.error?.message || raw.slice(0, 300) || `HTTP ${response.status}` }
  }
  return { ok: true, id: parsed?.messages?.[0]?.id ?? null }
}
