import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit"
import { getPublicTicketHeadshotBytes } from "@/lib/tickets/public"
import { isTicketPublicToken } from "@/lib/tickets/url"

export const runtime = "nodejs"

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const ip = clientIpFromHeaders(request.headers)
  if (!checkRateLimit(`ticket-photo:${ip}`, 60, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 })
  }
  const { token } = await context.params
  if (!isTicketPublicToken(token)) {
    return NextResponse.json({ error: "Photo not found." }, { status: 404 })
  }
  const bytes = await getPublicTicketHeadshotBytes(token)
  if (!bytes) return NextResponse.json({ error: "Photo not found." }, { status: 404 })
  const jpeg = bytes[0] === 0xff
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": jpeg ? "image/jpeg" : "image/png",
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  })
}
