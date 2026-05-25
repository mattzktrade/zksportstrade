import { createServerClient, parseCookieHeader } from "@supabase/ssr"
import { NextResponse } from "next/server"
import { ensureProfileForUser } from "@/lib/auth/ensure-profile"
import { safeRedirectUrl } from "@/lib/auth/safe-redirect"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next")

  if (!code) {
    const safeNext = safeRedirectUrl(next, origin, "/").pathname
    return NextResponse.redirect(`${origin}/auth/complete?next=${encodeURIComponent(safeNext)}`)
  }

  const redirectUrl = safeRedirectUrl(next, origin, "/")
  const response = NextResponse.redirect(redirectUrl)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(request.headers.get("cookie") ?? "").map((c) => ({
            name: c.name,
            value: c.value ?? "",
          }))
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    },
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback`)
  }

  // Self-heal: if the after-insert trigger didn't run (e.g. signup reused an
  // existing unconfirmed auth.users row, or the profile row was deleted
  // without removing the auth user), create the profile now so the middleware
  // does not bounce the user to /login?error=no_profile.
  const sessionUser = data.session?.user ?? data.user
  if (sessionUser?.id) {
    const ensured = await ensureProfileForUser({
      id: sessionUser.id,
      email: sessionUser.email,
      user_metadata: sessionUser.user_metadata as Record<string, unknown> | null,
    })
    if (!ensured.ok) {
      console.error("[auth-callback] ensureProfileForUser:", ensured.error)
    }
  }

  return response
}
