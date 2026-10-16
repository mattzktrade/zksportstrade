import { normalizeMarketingPhone } from "@/lib/integrations/marketing-leads/parse"

export function assistantPhoneDigits(value: string | null | undefined): string {
  return normalizeMarketingPhone(value)
}

/**
 * WhatsApp IDs and CRM numbers often differ by a mobile trunk prefix.
 * Mexico Instant Forms store 52 + 10 digits; Cloud API replies come from 521 + 10.
 */
export function phoneDigitVariants(value: string | null | undefined): string[] {
  const digits = assistantPhoneDigits(value)
  if (digits.length < 8) return digits ? [digits] : []
  const out = new Set<string>([digits])
  if (digits.startsWith("521") && digits.length === 13) {
    out.add(`52${digits.slice(3)}`)
    out.add(digits.slice(3))
  } else if (digits.startsWith("52") && digits.length === 12 && digits[2] !== "1") {
    out.add(`521${digits.slice(2)}`)
    out.add(digits.slice(2))
  }
  return [...out]
}

export function phoneSearchSuffix(value: string | null | undefined): string {
  const digits = assistantPhoneDigits(value)
  const national = phoneDigitVariants(digits).find((row) => row.length === 10)
  if (national) return national
  if (digits.length >= 10) return digits.slice(-10)
  return digits
}

export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = assistantPhoneDigits(a)
  const right = assistantPhoneDigits(b)
  if (left.length < 8 || right.length < 8) return left.length > 0 && left === right
  if (left === right) return true
  const shorter = left.length < right.length ? left : right
  const longer = left.length < right.length ? right : left
  if (longer.endsWith(shorter) && shorter.length >= 8) return true
  const rightKeys = new Set(phoneDigitVariants(right))
  return phoneDigitVariants(left).some((key) => key.length >= 8 && rightKeys.has(key))
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
