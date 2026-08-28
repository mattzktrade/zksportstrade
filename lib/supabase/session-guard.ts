import { isCmsRole } from "@/lib/auth/permissions"

/** Auth/JWKS calls in middleware must finish well under Vercel's 25s proxy limit. */
export const SESSION_LOOKUP_TIMEOUT_MS = 6_000
export const PROFILE_LOOKUP_TIMEOUT_MS = 4_000
export const SIGNOUT_TIMEOUT_MS = 3_000

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
    path.startsWith("/api/booking-forms/")
  )
}

export function isSessionlessApiPath(path: string): boolean {
  return path.startsWith("/api/cron/") || path.startsWith("/api/webhooks/")
}

export function isPublicBookingSignerPath(path: string): boolean {
  return path.startsWith("/sign/booking/")
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

export function hasSupabaseAuthCookie(cookieNames: readonly string[]): boolean {
  return cookieNames.some((name) => name.includes("-auth-token"))
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
