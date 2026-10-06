import { getWhatsAppCloudConfig } from "@/lib/integrations/marketing-leads/outreach-config"

export async function sendWhatsAppText(input: {
  toPhoneDigits: string
  body: string
}): Promise<{ ok: true; id: string | null } | { ok: false; skipped?: string; error?: string }> {
  const config = getWhatsAppCloudConfig()
  if (!config) return { ok: false, skipped: "whatsapp_not_configured" }
  const to = input.toPhoneDigits.replace(/\D/g, "")
  if (to.length < 8) return { ok: false, skipped: "no_phone" }
  const body = input.body.trim()
  if (!body) return { ok: false, skipped: "empty" }

  const response = await fetch(`https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: false, body: body.slice(0, 4096) },
    }),
  })
  const raw = await response.text()
  let parsed: { messages?: Array<{ id?: string }>; error?: { message?: string } } | null = null
  try {
    parsed = JSON.parse(raw) as { messages?: Array<{ id?: string }>; error?: { message?: string } }
  } catch {
    parsed = null
  }
  if (!response.ok) {
    return { ok: false, error: parsed?.error?.message || raw.slice(0, 300) || `HTTP ${response.status}` }
  }
  return { ok: true, id: parsed?.messages?.[0]?.id ?? null }
}

export async function sendWhatsAppDocument(input: {
  toPhoneDigits: string
  link: string
  filename: string
  caption?: string
}): Promise<{ ok: true; id: string | null } | { ok: false; skipped?: string; error?: string }> {
  const config = getWhatsAppCloudConfig()
  if (!config) return { ok: false, skipped: "whatsapp_not_configured" }
  const to = input.toPhoneDigits.replace(/\D/g, "")
  if (to.length < 8) return { ok: false, skipped: "no_phone" }
  const response = await fetch(`https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        link: input.link,
        filename: input.filename,
        caption: input.caption?.slice(0, 1024) || undefined,
      },
    }),
  })
  const raw = await response.text()
  if (!response.ok) return { ok: false, error: raw.slice(0, 300) }
  try {
    const parsed = JSON.parse(raw) as { messages?: Array<{ id?: string }> }
    return { ok: true, id: parsed.messages?.[0]?.id ?? null }
  } catch {
    return { ok: true, id: null }
  }
}
