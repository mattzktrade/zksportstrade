import { createHmac, randomBytes, timingSafeEqual } from "crypto"
import { generateSigningToken } from "@/lib/booking-forms/snapshot"
import { safeEqualStrings } from "@/lib/crypto/timing-safe"

export const TICKET_SIGNING_KID = "v1"
const SHORT_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function ticketSigningSecret(explicit?: string | null): string {
  const fromEnv = explicit?.trim() || process.env.TICKET_SIGNING_SECRET?.trim() || ""
  if (fromEnv) return fromEnv
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().slice(0, 64) ?? ""
  return fallback || "dev-ticket-signing-secret"
}

export function signTicketQrPayload(ticketId: string, secret: string, kid = TICKET_SIGNING_KID): string {
  const mac = createHmac("sha256", secret).update(`${kid}:${ticketId}`).digest().subarray(0, 16)
  return `ZK1.${ticketId}.${mac.toString("base64url")}`
}

export function verifyTicketQrPayload(
  raw: string,
  secret: string,
): { ok: true; ticketId: string } | { ok: false } {
  const text = raw.trim()
  const match = /^ZK1\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]+)$/i.exec(
    text,
  )
  if (!match) return { ok: false }
  const ticketId = match[1]!
  const given = match[2]!
  const expected = signTicketQrPayload(ticketId, secret).split(".")[2] ?? ""
  if (!safeEqualStrings(given, expected)) return { ok: false }
  return { ok: true, ticketId: ticketId.toLowerCase() }
}

export function extractTicketTokenFromText(text: string): string | null {
  const fromPath = /\/t\/([A-Za-z0-9_-]{40,60})/.exec(text)
  if (fromPath?.[1]) return fromPath[1]
  const trimmed = text.trim()
  if (/^[A-Za-z0-9_-]{40,60}$/.test(trimmed)) return trimmed
  return null
}

export function extractShortCodeFromText(text: string): string | null {
  const match = /\bZK-([0-9A-Z]{6})\b/i.exec(text.trim())
  return match ? `ZK-${match[1]!.toUpperCase()}` : null
}

export function encodeShortCode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ""
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5 && out.length < 6) {
      bits -= 5
      out += SHORT_ALPHABET[(value >> bits) & 31]
    }
  }
  while (out.length < 6) out += SHORT_ALPHABET[0]
  return `ZK-${out}`
}

export function randomShortCode(): string {
  return encodeShortCode(randomBytes(4))
}

export function newTicketSecrets(): { token: string; tokenHash: string; shortCode: string } {
  const { token, tokenHash } = generateSigningToken()
  return { token, tokenHash, shortCode: randomShortCode() }
}

export function hmacEquals(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
