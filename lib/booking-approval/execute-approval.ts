import { createAdminClient } from "@/lib/supabase/admin"
import type { createClient } from "@/lib/supabase/server"
import { sendOrderPlacedEmail } from "@/lib/email/send-order-placed"
import { enqueueOrderIntegrationsServer } from "@/lib/integrations/enqueue-server"
import { mapPlaceOrderError } from "@/lib/orders/place-order-errors"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ExecuteBookingApprovalResult =
  | {
      ok: true
      orderReference: string
      requestReference?: string
      alreadyApproved?: boolean
    }
  | { ok: false; message: string }

type AdminSupabase = Awaited<ReturnType<typeof createClient>>

export async function executeBookingApproval(
  requestId: string,
  options?: { adminSupabase?: AdminSupabase },
): Promise<ExecuteBookingApprovalResult> {
  const trimmedId = requestId.trim()
  if (!UUID_RE.test(trimmedId)) {
    return { ok: false, message: "Invalid request id." }
  }

  const admin = createAdminClient()
  if (!admin) {
    return { ok: false, message: "Server configuration error." }
  }

  const { data: req, error: reqErr } = await admin
    .from("booking_approval_requests")
    .select("*")
    .eq("id", trimmedId)
    .maybeSingle()

  if (reqErr) return { ok: false, message: reqErr.message }
  if (!req) return { ok: false, message: "Request not found." }

  if (req.status === "approved") {
    let orderReference = ""
    if (req.order_id) {
      const { data: order } = await admin
        .from("orders")
        .select("reference")
        .eq("id", req.order_id)
        .maybeSingle()
      orderReference = order?.reference ?? ""
    }
    if (!orderReference) {
      return { ok: false, message: "This request was already approved but the order reference is missing." }
    }
    return {
      ok: true,
      orderReference,
      requestReference: req.reference,
      alreadyApproved: true,
    }
  }

  if (req.status !== "pending") {
    return { ok: false, message: "This request has already been reviewed." }
  }

  const { data: agent, error: agentErr } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", req.agent_profile_id)
    .maybeSingle()
  if (agentErr || !agent) return { ok: false, message: "Agent profile not found." }

  const { data, error } = options?.adminSupabase
    ? await options.adminSupabase.rpc("admin_approve_booking_request", {
        p_request_id: trimmedId,
      })
    : await admin.rpc("service_approve_booking_request", {
        p_request_id: trimmedId,
      })
  if (error) return { ok: false, message: mapPlaceOrderError(error.message ?? "") }

  const row = data as Record<string, unknown> | null
  const orderReference = typeof row?.order_reference === "string" ? row.order_reference : undefined
  if (!orderReference) {
    return { ok: false, message: "Order was created but the reference was missing from the response." }
  }

  const approvedOrderId = typeof row?.order_id === "string" ? row.order_id : ""
  if (approvedOrderId) {
    const enq = await enqueueOrderIntegrationsServer(approvedOrderId, "trade_portal")
    if (!enq.ok) console.warn("[approve booking] Salesforce sync not queued:", enq.message)
  }

  const emailResult = await sendOrderPlacedEmail({
    agentEmail: agent.email,
    agentName: agent.full_name || agent.email.split("@")[0] || "Partner",
    orderReference,
    packageName: String(row?.package_name ?? ""),
    circuit: String(row?.circuit ?? ""),
    guests: Number(row?.guests ?? req.guests),
    totalAmount: Number(row?.total_amount ?? req.total_amount),
    currency: String(row?.currency ?? req.currency),
    clientName: req.client_name,
    clientEmail: req.client_email,
    clientPhone: req.client_phone,
    clientNationality: req.client_nationality ?? "",
    poNumber: req.po_number,
    dietary: req.dietary_requirements,
    specialRequests: req.special_requests,
    shippingAddressLine1: req.shipping_address_line1,
    shippingAddressLine2: req.shipping_address_line2,
    shippingCity: req.shipping_city,
    shippingPostcode: req.shipping_postcode,
    shippingCountry: req.shipping_country,
    billingAddressLine1: req.billing_address_line1,
    billingAddressLine2: req.billing_address_line2,
    billingCity: req.billing_city,
    billingPostcode: req.billing_postcode,
    billingCountry: req.billing_country,
  })

  if (!emailResult.ok) {
    console.error("[executeBookingApproval] order created but email failed:", emailResult.error ?? emailResult.skipped)
  }

  return {
    ok: true,
    orderReference,
    requestReference: typeof row?.request_reference === "string" ? row.request_reference : req.reference,
  }
}
