import { normalizeMarketingPhone } from "@/lib/integrations/marketing-leads/parse"

export function assistantPhoneDigits(value: string | null | undefined): string {
  return normalizeMarketingPhone(value)
}

export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = assistantPhoneDigits(a)
  const right = assistantPhoneDigits(b)
  if (left.length < 8 || right.length < 8) return left.length > 0 && left === right
  if (left === right) return true
  const shorter = left.length < right.length ? left : right
  const longer = left.length < right.length ? right : left
  return longer.endsWith(shorter) && shorter.length >= 8
}

export function normalizeAssistantEmail(value: string | null | undefined): string | null {
  const email = (value ?? "").trim().toLowerCase()
  if (!email.includes("@") || email.length < 5) return null
  return email
}

export function displayNameForUnknownWhatsApp(phoneDigits: string, profileName?: string | null): string {
  const name = profileName?.trim() || ""
  if (name) return name
  const tail = phoneDigits.replace(/\D/g, "").slice(-4)
  return tail ? `WhatsApp customer ${tail}` : "WhatsApp customer"
}
