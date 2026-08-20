import { headers } from "next/headers"
import { createAdminClient } from "@/lib/supabase/admin"
import { sha256 } from "@/lib/booking-forms/snapshot"
import type {
  BookingFormSnapshot,
  BookingFormStatus,
} from "@/lib/booking-forms/types"
import { getRequestEvidence } from "@/lib/booking-forms/request-evidence"

export type PublicBookingForm = {
  id: string
  status: BookingFormStatus
  snapshot: BookingFormSnapshot
  expiresAt: string
  clientSignedAt: string | null
  completedAt: string | null
}

export async function getPublicBookingForm(token: string): Promise<{
  form: PublicBookingForm | null
  unavailableReason: "invalid" | "expired" | "closed" | null
}> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    return { form: null, unavailableReason: "invalid" }
  }
  const admin = createAdminClient()
  if (!admin) return { form: null, unavailableReason: "invalid" }
  const tokenHash = sha256(token)
  const { data, error } = await admin
    .from("booking_forms")
    .select(
      "id, status, snapshot_data, client_token_expires_at, client_signed_at, completed_at",
    )
    .eq("client_token_hash", tokenHash)
    .maybeSingle()
  if (error || !data) return { form: null, unavailableReason: "invalid" }

  const status = data.status as BookingFormStatus
  if (["expired", "voided", "declined", "failed"].includes(status)) {
    return { form: null, unavailableReason: status === "expired" ? "expired" : "closed" }
  }
  if (
    ["sent", "viewed"].includes(status) &&
    new Date(data.client_token_expires_at).getTime() <= Date.now()
  ) {
    return { form: null, unavailableReason: "expired" }
  }

  if (["sent", "viewed"].includes(status)) {
    const requestHeaders = await headers()
    const evidence = getRequestEvidence(requestHeaders)
    await admin.rpc("record_native_booking_form_view", {
      p_token_hash: tokenHash,
      p_ip_address: evidence.ipAddress,
      p_location: evidence.location,
      p_user_agent: evidence.userAgent,
    })
  }

  return {
    form: {
      id: String(data.id),
      status: status === "sent" ? "viewed" : status,
      snapshot: data.snapshot_data as BookingFormSnapshot,
      expiresAt: String(data.client_token_expires_at),
      clientSignedAt: data.client_signed_at ? String(data.client_signed_at) : null,
      completedAt: data.completed_at ? String(data.completed_at) : null,
    },
    unavailableReason: null,
  }
}

