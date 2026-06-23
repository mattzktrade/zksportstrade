import { createHmac, timingSafeEqual } from "crypto"

const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function getSigningSecret(): string {
  const secret = process.env.BOOKING_APPROVAL_APPROVE_SECRET?.trim()
  if (!secret) {
    throw new Error("BOOKING_APPROVAL_APPROVE_SECRET is not configured")
  }
  return secret
}

function signPayload(payload: string): string {
  return createHmac("sha256", getSigningSecret()).update(payload).digest("base64url")
}

export function createBookingApprovalApproveToken(requestId: string): string {
  const id = requestId.trim()
  if (!UUID_RE.test(id)) {
    throw new Error("Invalid request id for approval token")
  }
  const expiresAt = Date.now() + TOKEN_TTL_MS
  const payload = `${id}:${expiresAt}`
  const signature = signPayload(payload)
  return Buffer.from(`${payload}:${signature}`).toString("base64url")
}

export function verifyBookingApprovalApproveToken(
  token: string,
): { ok: true; requestId: string } | { ok: false; error: string } {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8")
    const lastColon = decoded.lastIndexOf(":")
    if (lastColon <= 0) {
      return { ok: false, error: "This approval link is invalid." }
    }

    const payload = decoded.slice(0, lastColon)
    const signature = decoded.slice(lastColon + 1)
    const expected = signPayload(payload)

    const sigBuf = Buffer.from(signature)
    const expectedBuf = Buffer.from(expected)
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return { ok: false, error: "This approval link is invalid." }
    }

    const colon = payload.indexOf(":")
    if (colon <= 0) {
      return { ok: false, error: "This approval link is invalid." }
    }

    const requestId = payload.slice(0, colon)
    const expiresAt = Number(payload.slice(colon + 1))
    if (!UUID_RE.test(requestId) || !Number.isFinite(expiresAt)) {
      return { ok: false, error: "This approval link is invalid." }
    }
    if (Date.now() > expiresAt) {
      return { ok: false, error: "This approval link has expired. Open the admin portal to review the request." }
    }

    return { ok: true, requestId }
  } catch {
    return { ok: false, error: "This approval link is invalid." }
  }
}
