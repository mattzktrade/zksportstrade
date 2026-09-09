import { createHmac } from "crypto"
import { safeEqualStrings } from "@/lib/crypto/timing-safe"

function header(request: Request, name: string): string {
  return request.headers.get(name)?.trim() || ""
}

function bearerToken(request: Request): string {
  const value = header(request, "authorization")
  const match = /^Bearer\s+(.+)$/i.exec(value)
  return match?.[1]?.trim() || ""
}

function hmacHex(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex")
}

function signatureMatches(provided: string, secret: string, rawBody: string): boolean {
  const trimmed = provided.trim()
  if (!trimmed) return false
  const hex = trimmed.replace(/^sha256=/i, "")
  const expectedHex = hmacHex(secret, rawBody)
  if (safeEqualStrings(hex.toLowerCase(), expectedHex.toLowerCase())) return true
  const expectedB64 = createHmac("sha256", secret).update(rawBody).digest("base64")
  return safeEqualStrings(trimmed, expectedB64)
}

export function verifyMarketingLeadWebhook(request: Request, rawBody: string, secret: string): boolean {
  const shared =
    header(request, "x-marketing-webhook-secret") ||
    header(request, "x-webhook-secret") ||
    bearerToken(request)
  if (shared && safeEqualStrings(shared, secret)) return true

  const signature =
    header(request, "x-webhook-signature") ||
    header(request, "x-hub-signature-256") ||
    header(request, "x-hub-signature")
  return signatureMatches(signature, secret, rawBody)
}
