import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireAdmin } from "@/lib/admin/require-admin"
import { buildXeroAuthorizeUrl } from "@/lib/integrations/xero/auth"
import { isXeroConfigured } from "@/lib/integrations/xero/config"
import { randomBytes } from "crypto"

const COOKIE_STATE = "xero_oauth_state"
const COOKIE_MAX_AGE = 600

export async function GET(request: Request) {
  await requireAdmin()

  if (!isXeroConfigured()) {
    return NextResponse.json({ error: "Xero Client ID and Secret are not configured." }, { status: 500 })
  }

  const state = randomBytes(16).toString("hex")
  const origin = new URL(request.url).origin
  const authorizeUrl = buildXeroAuthorizeUrl(state, origin)

  const cookieStore = await cookies()
  const secure = process.env.NODE_ENV === "production"
  cookieStore.set(COOKIE_STATE, state, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  })

  return NextResponse.redirect(authorizeUrl)
}
