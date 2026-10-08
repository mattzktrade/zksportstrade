import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { buildTicketPdf } from "@/lib/tickets/pdf"
import { getPublicTicketHeadshotBytes, getPublicTicketView } from "@/lib/tickets/public"
import { isTicketPublicToken } from "@/lib/tickets/url"

export const runtime = "nodejs"

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const ip = clientIpFromHeaders(request.headers)
  if (!checkRateLimit(`ticket-pdf:${ip}`, 30, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 })
  }
  const { token } = await context.params
  if (!isTicketPublicToken(token)) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 })
  }
  const view = await getPublicTicketView(token)
  if (!view) return NextResponse.json({ error: "Ticket not found." }, { status: 404 })
  const headshotBytes = view.hasHeadshot ? await getPublicTicketHeadshotBytes(token) : null
  const bytes = await buildTicketPdf({
    guestName: view.guestName,
    eventLabel: view.eventLabel,
    packageName: view.packageName,
    venue: view.venue,
    days: view.days,
    shortCode: view.shortCode,
    qrPayload: view.qrPayload,
    voided: view.voided,
    headshotBytes,
  })
  const admin = createAdminClient()
  if (admin && !view.voided) {
    try {
      const path = `${view.ticketId}.pdf`
      await admin.storage.from("ticket-files").upload(path, Buffer.from(bytes), {
        contentType: "application/pdf",
        upsert: true,
      })
      await admin.from("ticket_assets").upsert({
        ticket_id: view.ticketId,
        pdf_path: path,
        updated_at: new Date().toISOString(),
      })
    } catch {
      /* download still works if the private bucket is not provisioned yet */
    }
  }
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${view.shortCode}.pdf"`,
    },
  })
}
