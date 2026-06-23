import { getPortalProfile } from "@/lib/supabase/profile"
import { createAdminClient } from "@/lib/supabase/admin"

export type InvoicePdfAccess = {
  xeroInvoiceId: string
  xeroInvoiceNumber: string | null
  orderReference: string
}

/** Agent (order owner) or admin may download the Xero invoice PDF for an order. */
export async function assertInvoicePdfAccess(orderId: string): Promise<InvoicePdfAccess> {
  const profile = await getPortalProfile()
  if (!profile) throw new InvoicePdfAccessError("Not signed in.", 401)

  const admin = createAdminClient()
  if (!admin) throw new InvoicePdfAccessError("Server configuration error.", 500)

  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("id, reference, agent_profile_id")
    .eq("id", orderId)
    .maybeSingle()
  if (orderErr) throw new InvoicePdfAccessError(orderErr.message, 500)
  if (!order) throw new InvoicePdfAccessError("Order not found.", 404)

  if (profile.role !== "admin" && order.agent_profile_id !== profile.id) {
    throw new InvoicePdfAccessError("You do not have access to this invoice.", 403)
  }

  const { data: inv, error: invErr } = await admin
    .from("invoices")
    .select("xero_invoice_id, xero_invoice_number")
    .eq("order_id", orderId)
    .maybeSingle()
  if (invErr) throw new InvoicePdfAccessError(invErr.message, 500)
  if (!inv?.xero_invoice_id) {
    throw new InvoicePdfAccessError("Invoice PDF is not available yet — Xero invoice has not been created.", 404)
  }

  return {
    xeroInvoiceId: inv.xero_invoice_id,
    xeroInvoiceNumber: inv.xero_invoice_number ?? null,
    orderReference: order.reference,
  }
}

export class InvoicePdfAccessError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = "InvoicePdfAccessError"
  }
}
