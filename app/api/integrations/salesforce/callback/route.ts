import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireAdmin } from "@/lib/admin/require-admin"
import { exchangeAuthorizationCode } from "@/lib/integrations/salesforce/auth"
import { getOAuthRedirectUri } from "@/lib/integrations/salesforce/config"
import { saveOAuthTokens } from "@/lib/integrations/salesforce/settings-store"

const COOKIE_VERIFIER = "sf_pkce_verifier"
const COOKIE_STATE = "sf_oauth_state"

export async function GET(request: Request) {
  await requireAdmin()

  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const oauthError = url.searchParams.get("error")
  const origin = url.origin
  const adminBase = `${origin}/admin/integrations/salesforce`

  if (oauthError) {
    const desc = url.searchParams.get("error_description") ?? oauthError
    return NextResponse.redirect(`${adminBase}?error=${encodeURIComponent(desc)}`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${adminBase}?error=${encodeURIComponent("Missing authorization code.")}`)
  }

  const cookieStore = await cookies()
  const expectedState = cookieStore.get(COOKIE_STATE)?.value
  const verifier = cookieStore.get(COOKIE_VERIFIER)?.value

  cookieStore.delete(COOKIE_VERIFIER)
  cookieStore.delete(COOKIE_STATE)

  if (!expectedState || state !== expectedState || !verifier) {
    return NextResponse.redirect(
      `${adminBase}?error=${encodeURIComponent("OAuth session expired. Click Connect again.")}`,
    )
  }

  try {
    const redirectUri = getOAuthRedirectUri(origin)
    const { refreshToken, instanceUrl } = await exchangeAuthorizationCode(code, redirectUri, verifier)
    await saveOAuthTokens(refreshToken, instanceUrl)
    return NextResponse.redirect(`${adminBase}?connected=1`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Authorization failed."
    return NextResponse.redirect(`${adminBase}?error=${encodeURIComponent(msg)}`)
  }
}
