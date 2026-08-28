import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { sha256 } from "@/lib/booking-forms/snapshot"
import { downloadBookingDocument } from "@/lib/booking-forms/storage"
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit"

export const runtime = "nodejs"

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params
  if (!checkRateLimit(`booking-form:document:${clientIpFromHeaders(_request.headers)}`, 60, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 })
  }
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 })
  }
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: "Document service unavailable." }, { status: 503 })
  const { data: form } = await admin
    .from("booking_forms")
    .select(
      "document_ref, status, client_token_expires_at, unsigned_pdf_path, final_pdf_path",
    )
    .eq("client_token_hash", sha256(token))
    .maybeSingle()
  if (!form || ["voided", "declined", "failed"].includes(String(form.status))) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 })
  }
  if (
    ["sent", "viewed"].includes(String(form.status)) &&
    new Date(form.client_token_expires_at).getTime() <= Date.now()
  ) {
    return NextResponse.json({ error: "This signing link has expired." }, { status: 410 })
  }
  const path = form.final_pdf_path || form.unsigned_pdf_path
  if (!path) return NextResponse.json({ error: "Document not found." }, { status: 404 })
  try {
    const bytes = await downloadBookingDocument(path)
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="Booking-Form-${String(form.document_ref).replace(/[^\w.-]+/g, "-")}.pdf"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    })
  } catch {
    return NextResponse.json({ error: "Document not found." }, { status: 404 })
  }
}

