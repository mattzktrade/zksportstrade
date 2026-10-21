import { safeEqualStrings } from "@/lib/crypto/timing-safe"
import { ADGP_API_SECRET_HEADER } from "@/lib/integrations/adgp/config"

function header(request: Request, name: string): string {
  return request.headers.get(name)?.trim() || ""
}

function bearerToken(request: Request): string {
  const value = header(request, "authorization")
  const match = /^Bearer\s+(.+)$/i.exec(value)
  return match?.[1]?.trim() || ""
}

export function verifyAdgpApiSecret(request: Request, secret: string): boolean {
  const provided = header(request, ADGP_API_SECRET_HEADER) || bearerToken(request)
  if (!provided || !secret) return false
  return safeEqualStrings(provided, secret)
}
