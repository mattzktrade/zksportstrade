import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit"
import { getPublicTicketView } from "@/lib/tickets/public"
import { isTicketPublicToken } from "@/lib/tickets/url"
import { googleWalletConfigured, walletUnavailableMessage } from "@/lib/tickets/wallet"

export const runtime = "nodejs"

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const ip = clientIpFromHeaders(request.headers)
  if (!checkRateLimit(`ticket-wallet-google:${ip}`, 20, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 })
  }
  const { token } = await context.params
  if (!isTicketPublicToken(token)) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 })
  }
  const view = await getPublicTicketView(token)
  if (!view || view.voided) return NextResponse.json({ error: "Ticket not found." }, { status: 404 })
  if (!googleWalletConfigured()) {
    return NextResponse.json({ error: walletUnavailableMessage("google") }, { status: 501 })
  }
  return NextResponse.json(
    { error: "Google Wallet objects are connected but not issued in this release." },
    { status: 501 },
  )
}
