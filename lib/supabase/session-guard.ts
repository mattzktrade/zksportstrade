import { isCmsRole } from "@/lib/auth/permissions"

/** Auth/JWKS calls in middleware must finish well under Vercel's 25s proxy limit. */
export const SESSION_LOOKUP_TIMEOUT_MS = 6_000
export const PROFILE_LOOKUP_TIMEOUT_MS = 4_000
export const SIGNOUT_TIMEOUT_MS = 3_000

/** Shown by the root error page. Must not redirect to /login — that loops when the session cookie is still valid. */
export const PROFILE_LOAD_TIMEOUT_MESSAGE =
  "This page is taking too long to load. Refresh and try again."

export type GateProfile = {
  role: string | null
  approval_status: string | null
}

export type GateRedirect = {
  type: "redirect"
  pathname: string
  search?: Record<string, string>
}

export type GateDecision =
  | { type: "next" }
  | GateRedirect
  | { type: "clear_session"; then: "next" | Omit<GateRedirect, "type"> }

export function isPublicApiPath(path: string): boolean {
  return (
    path.startsWith("/api/webhooks/") ||
    path.startsWith("/api/cron/") ||
    path.startsWith("/api/integrations/") ||
    path.startsWith("/api/booking-forms/") ||
    path.startsWith("/api/contracts/") ||
    path.startsWith("/api/guest-details/") ||
    path.startsWith("/api/tickets/")
  )
}

export function isSessionlessApiPath(path: string): boolean {
  return path.startsWith("/api/cron/") || path.startsWith("/api/webhooks/")
}

export function isPublicBookingSignerPath(path: string): boolean {
  return path.startsWith("/sign/booking/") || path.startsWith("/sign/contract/")
}

export function isPublicGuestDetailsPath(path: string): boolean {
  return path.startsWith("/guest-details/")
}

export function isPublicTicketPath(path: string): boolean {
  return path.startsWith("/t/")
}

export function isAuthRoute(path: string): boolean {
  return path === "/login" || path === "/signup"
}

export function isResetPasswordPage(path: string): boolean {
  return path === "/reset-password"
}

export function isUnderAuthPath(path: string): boolean {
  return path.startsWith("/auth/")
}

export function isPendingPage(path: string): boolean {
  return path === "/pending-approval"
}

export function isAdminRoute(path: string): boolean {
  return path.startsWith("/admin")
}

export function isPublicPath(path: string): boolean {
  return (
    isAuthRoute(path) ||
    isUnderAuthPath(path) ||
    isResetPasswordPage(path) ||
    isPublicBookingSignerPath(path) ||
    isPublicGuestDetailsPath(path) ||
    isPublicTicketPath(path) ||
    isPublicApiPath(path)
  )
}

export function isRouterPrefetch(headers: { get(name: string): string | null }): boolean {
  return (
    headers.get("next-router-prefetch") === "1" ||
    headers.get("purpose") === "prefetch" ||
    headers.get("x-middleware-prefetch") === "1"
  )
}

/** App Router click/back navigations (RSC flight), not a full document load. */
export function isClientRouterRequest(headers: { get(name: string): string | null }): boolean {
  return (
    isRouterPrefetch(headers) ||
    headers.get("RSC") === "1" ||
    headers.get("rsc") === "1" ||
    Boolean(headers.get("Next-Router-State-Tree")) ||
    Boolean(headers.get("next-router-state-tree"))
  )
}

export function hasSupabaseAuthCookie(cookieNames: readonly string[]): boolean {
  return cookieNames.some((name) => name.includes("-auth-token"))
}

/** Refresh the Auth cookie when fewer than this many ms remain. */
export const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
    const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4))
    const binary = (typeof atob === "function" ? atob : null)?.(normalized + pad)
    if (binary != null) return binary
    return Buffer.from(normalized + pad, "base64").toString("utf8")
  } catch {
    return null
  }
}

function jwtExpMs(accessToken: string): number | null {
  const payloadPart = accessToken.split(".")[1]
  if (!payloadPart) return null
  const decoded = decodeBase64Url(payloadPart)
  if (!decoded) return null
  try {
    const payload = JSON.parse(decoded) as { exp?: unknown }
    return typeof payload.exp === "number" ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

function parseAuthCookieJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const candidates = [trimmed]
  if (trimmed.startsWith("base64-")) {
    const decoded = decodeBase64Url(trimmed.slice(7))
    if (decoded) candidates.push(decoded)
  }
  try {
    candidates.push(decodeURIComponent(trimmed))
  } catch {
    /* ignore */
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>
        if (record.access_token || record.expires_at || record.currentSession) {
          const session = record.currentSession
          if (session && typeof session === "object") return session as Record<string, unknown>
          return record
        }
      }
    } catch {
      /* try next encoding */
    }
  }
  return null
}

function accessTokenExpiresAtMs(payload: Record<string, unknown>): number | null {
  const expiresAt = payload.expires_at
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    return expiresAt > 1e12 ? expiresAt : expiresAt * 1000
  }
  if (typeof payload.access_token === "string") {
    return jwtExpMs(payload.access_token)
  }
  return null
}

/** Local JWT/cookie expiry only — layouts still call Auth when this is false. */
export function isFreshAccessToken(
  cookies: ReadonlyArray<{ name: string; value: string }>,
  skewMs = ACCESS_TOKEN_REFRESH_SKEW_MS,
): boolean {
  const grouped = new Map<string, Array<{ name: string; value: string }>>()
  for (const cookie of cookies) {
    if (!cookie.name.includes("-auth-token")) continue
    const base = cookie.name.replace(/\.\d+$/, "")
    const list = grouped.get(base) ?? []
    list.push(cookie)
    grouped.set(base, list)
  }
  for (const list of grouped.values()) {
    const raw = [...list]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((cookie) => cookie.value)
      .join("")
    const payload = parseAuthCookieJson(raw)
    if (!payload) continue
    const expiresAt = accessTokenExpiresAtMs(payload)
    if (expiresAt != null && expiresAt - Date.now() > skewMs) return true
  }
  return false
}

export async function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  // Attach a rejection handler immediately so a late timeout/abort cannot
  // become an unhandled rejection after we have already moved on.
  const settled = promise.then(
    (value) => ({ ok: true as const, value }),
    () => ({ ok: false as const }),
  )
  try {
    return await Promise.race([
      settled,
      new Promise<{ ok: false }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false }), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Same redirects the live proxy already applied, extracted so a hung
 * getUser/profile call cannot take the whole request down with it.
 *
 * `profileKnown: false` means Auth or profiles timed out. Keep the request
 * moving and let layouts (`requireAdmin` / portal layout) enforce access.
 */
export function decideSessionGate(input: {
  path: string
  userId: string | null
  profile: GateProfile | null
  profileKnown: boolean
}): GateDecision {
  const { path, userId, profile, profileKnown } = input

  if (!userId) {
    if (isPublicPath(path)) return { type: "next" }
    return { type: "redirect", pathname: "/login", search: { redirect: path } }
  }

  if (!profileKnown) return { type: "next" }

  if (!profile && !isUnderAuthPath(path)) {
    if (isAuthRoute(path)) return { type: "clear_session", then: "next" }
    return {
      type: "clear_session",
      then: { pathname: "/login", search: { error: "no_profile" } },
    }
  }

  const cmsStaff = isCmsRole(profile?.role)
  const isApproved = profile?.approval_status === "approved" || cmsStaff
  const isPending = profile?.approval_status === "pending"
  const isRejected = profile?.approval_status === "rejected"

  if (isAdminRoute(path) && !cmsStaff) {
    return { type: "redirect", pathname: "/" }
  }

  if (isRejected && !isAuthRoute(path) && !isUnderAuthPath(path)) {
    return { type: "redirect", pathname: "/login", search: { error: "account_rejected" } }
  }

  if (isAuthRoute(path)) {
    if (isApproved) return { type: "redirect", pathname: "/" }
    if (isPending) return { type: "redirect", pathname: "/pending-approval" }
  }

  if (isPending && !isPendingPage(path) && !isUnderAuthPath(path) && !isResetPasswordPage(path)) {
    return { type: "redirect", pathname: "/pending-approval" }
  }

  if (isApproved && isPendingPage(path)) {
    return { type: "redirect", pathname: "/" }
  }

  return { type: "next" }
}
