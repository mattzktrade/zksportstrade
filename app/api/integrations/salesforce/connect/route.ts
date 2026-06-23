import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireAdmin } from "@/lib/admin/require-admin"
import { buildAuthorizeUrl } from "@/lib/integrations/salesforce/auth"
import { getOAuthRedirectUri, isSalesforceConfigured } from "@/lib/integrations/salesforce/config"
import { generateOAuthState, generatePkcePair } from "@/lib/integrations/salesforce/pkce"

const COOKIE_VERIFIER = "sf_pkce_verifier"
const COOKIE_STATE = "sf_oauth_state"
const COOKIE_MAX_AGE = 600

export async function GET(request: Request) {
  await requireAdmin()

  if (!isSalesforceConfigured()) {
    return NextResponse.json({ error: "Salesforce Client ID and Secret are not configured." }, { status: 500 })
  }

  const { verifier, challenge } = generatePkcePair()
  const state = generateOAuthState()
  const origin = new URL(request.url).origin
  const redirectUri = getOAuthRedirectUri(origin)
  const authorizeUrl = buildAuthorizeUrl({ redirectUri, state, codeChallenge: challenge })

  const cookieStore = await cookies()
  const secure = process.env.NODE_ENV === "production"
  cookieStore.set(COOKIE_VERIFIER, verifier, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  })
  cookieStore.set(COOKIE_STATE, state, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  })

  return NextResponse.redirect(authorizeUrl)
}
