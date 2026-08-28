import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import {
  PROFILE_LOOKUP_TIMEOUT_MS,
  SESSION_LOOKUP_TIMEOUT_MS,
  SIGNOUT_TIMEOUT_MS,
  decideSessionGate,
  hasSupabaseAuthCookie,
  isRouterPrefetch,
  isSessionlessApiPath,
  withTimeout,
  type GateProfile,
} from "@/lib/supabase/session-guard"

function markPrivate(response: NextResponse) {
  // private + must-revalidate: not CDN-cached, but the browser may use bfcache
  // on back/forward. no-store (set on /admin in next.config) blocks that.
  response.headers.set("Cache-Control", "private, max-age=0, must-revalidate")
  return response
}

function copySessionCookies(from: NextResponse, to: NextResponse) {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie)
  }
  return to
}

function redirectWithSession(
  request: NextRequest,
  sessionResponse: NextResponse,
  pathname: string,
  search?: Record<string, string>,
) {
  const url = request.nextUrl.clone()
  url.pathname = pathname
  url.search = ""
  if (search) {
    for (const [key, value] of Object.entries(search)) {
      url.searchParams.set(key, value)
    }
  }
  return markPrivate(copySessionCookies(sessionResponse, NextResponse.redirect(url)))
}

function applyGate(
  request: NextRequest,
  sessionResponse: NextResponse,
  decision: ReturnType<typeof decideSessionGate>,
  privateCache = false,
) {
  if (decision.type === "redirect") {
    return redirectWithSession(request, sessionResponse, decision.pathname, decision.search)
  }
  return privateCache ? markPrivate(sessionResponse) : sessionResponse
}

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname

  // Cron and inbound webhooks authenticate with secrets, not cookies.
  // Creating a Supabase client here would compete with user traffic.
  if (isSessionlessApiPath(path)) {
    return NextResponse.next({ request })
  }

  // Hover/viewport prefetch must not call Auth. Layouts still enforce access
  // on the real click. Viewport prefetch + getUser used to 504 the live proxy.
  if (isRouterPrefetch(request.headers)) {
    const res = NextResponse.next({ request })
    if (hasSupabaseAuthCookie(request.cookies.getAll().map((cookie) => cookie.name))) {
      return markPrivate(res)
    }
    return res
  }

  let supabaseResponse = NextResponse.next({ request })

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet, headers = {}) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            supabaseResponse = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options),
            )
            Object.entries(headers).forEach(([key, value]) => supabaseResponse.headers.set(key, value))
          },
        },
      },
    )

    // getUser() refreshes the session cookie. getClaims() was hanging in the
    // Next middleware sandbox (JWKS) until our wait cap, which made every
    // navigation take ~6s. Do not AbortSignal.timeout the fetch — that crash
    // left the browser with no response.
    const userResult = await withTimeout(supabase.auth.getUser(), SESSION_LOOKUP_TIMEOUT_MS)
    const userId = userResult.ok ? userResult.value.data.user?.id ?? null : null
    const sessionVerified = userResult.ok

    if (!sessionVerified) {
      if (hasSupabaseAuthCookie(request.cookies.getAll().map((cookie) => cookie.name))) {
        return markPrivate(supabaseResponse)
      }
      return applyGate(
        request,
        supabaseResponse,
        decideSessionGate({ path, userId: null, profile: null, profileKnown: true }),
      )
    }

    if (!userId) {
      return applyGate(
        request,
        supabaseResponse,
        decideSessionGate({ path, userId: null, profile: null, profileKnown: true }),
      )
    }

    const profileResult = await withTimeout(
      supabase.from("profiles").select("approval_status, role").eq("id", userId).maybeSingle(),
      PROFILE_LOOKUP_TIMEOUT_MS,
    )

    if (!profileResult.ok) {
      return markPrivate(supabaseResponse)
    }

    const { data, error } = profileResult.value
    if (error) {
      console.error("[middleware] profile lookup failed:", error.message)
      return markPrivate(supabaseResponse)
    }

    const profile: GateProfile | null = data
      ? {
          role: typeof data.role === "string" ? data.role : null,
          approval_status: typeof data.approval_status === "string" ? data.approval_status : null,
        }
      : null

    const decision = decideSessionGate({
      path,
      userId,
      profile,
      profileKnown: true,
    })

    if (decision.type === "clear_session") {
      await withTimeout(supabase.auth.signOut(), SIGNOUT_TIMEOUT_MS)
      if (decision.then === "next") return markPrivate(supabaseResponse)
      return redirectWithSession(request, supabaseResponse, decision.then.pathname, decision.then.search)
    }

    return applyGate(request, supabaseResponse, decision, true)
  } catch (error) {
    console.error("[middleware] session update failed:", error)
    if (hasSupabaseAuthCookie(request.cookies.getAll().map((cookie) => cookie.name))) {
      return markPrivate(supabaseResponse)
    }
    return applyGate(
      request,
      supabaseResponse,
      decideSessionGate({ path, userId: null, profile: null, profileKnown: true }),
    )
  }
}
