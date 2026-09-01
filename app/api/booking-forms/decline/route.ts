import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { sha256 } from "@/lib/booking-forms/snapshot"
import { revalidateNativeBookingFormPages } from "@/lib/booking-forms/revalidate"
import { syncBookingFormDealInventory } from "@/lib/booking-forms/inventory-sync"
import { getRequestEvidence } from "@/lib/booking-forms/request-evidence"
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit"

export async function POST(request: NextRequest) {
  try {
    const ip = clientIpFromHeaders(request.headers)
    if (!checkRateLimit(`booking-form:decline:${ip}`, 20, 15 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 })
    }
    const body = (await request.json()) as Record<string, unknown>
    const token = String(body.token ?? "").trim()
    const reason = String(body.reason ?? "").trim().slice(0, 1000)
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
      return NextResponse.json({ error: "Invalid or expired signing link." }, { status: 404 })
    }
    const admin = createAdminClient()
    if (!admin) {
      return NextResponse.json({ error: "Signing service is not configured." }, { status: 503 })
    }
    const requestEvidence = getRequestEvidence(request.headers)
    const tokenHash = sha256(token)
    const { data: form } = await admin
      .from("booking_forms")
      .select("deal_id")
      .eq("client_token_hash", tokenHash)
      .maybeSingle()
    if (!form) {
      return NextResponse.json({ error: "Invalid or expired signing link." }, { status: 404 })
    }
    const { error } = await admin.rpc("decline_native_booking_form", {
      p_token_hash: tokenHash,
      p_reason: reason || null,
      p_ip_address: requestEvidence.ipAddress,
      p_location: requestEvidence.location,
      p_user_agent: requestEvidence.userAgent,
    })
    if (error) {
      return NextResponse.json({ error: "This booking form can no longer be declined." }, { status: 409 })
    }
    await syncBookingFormDealInventory(String(form.deal_id), "booking_form_declined")
    revalidateNativeBookingFormPages(form.deal_id ? String(form.deal_id) : null)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Could not decline this booking form." }, { status: 400 })
  }
}

