import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireAdmin } from "@/lib/admin/require-admin"
import { exchangeXeroAuthorizationCode } from "@/lib/integrations/xero/auth"

const COOKIE_STATE = "xero_oauth_state"

export async function GET(request: Request) {
  await requireAdmin()

  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const oauthError = url.searchParams.get("error")
  const origin = url.origin
  const adminBase = `${origin}/admin/integrations/xero`

  if (oauthError) {
    const desc = url.searchParams.get("error_description") ?? oauthError
    return NextResponse.redirect(`${adminBase}?error=${encodeURIComponent(desc)}`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${adminBase}?error=${encodeURIComponent("Missing authorization code.")}`)
  }

  const cookieStore = await cookies()
  const expectedState = cookieStore.get(COOKIE_STATE)?.value
  cookieStore.delete(COOKIE_STATE)

  if (!expectedState || state !== expectedState) {
    return NextResponse.redirect(
      `${adminBase}?error=${encodeURIComponent("OAuth session expired. Click Connect again.")}`,
    )
  }

  try {
    await exchangeXeroAuthorizationCode(code, origin)
    return NextResponse.redirect(`${adminBase}?connected=1`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Authorization failed."
    return NextResponse.redirect(`${adminBase}?error=${encodeURIComponent(msg)}`)
  }
}
