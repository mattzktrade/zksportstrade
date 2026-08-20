import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Link a committed portal/admin order to a CRM deal without creating another
 * order or invoice. Safe to call more than once.
 */
export async function attachDealForCommittedOrder(orderId: string): Promise<{
  ok: boolean
  dealId?: string
  message?: string
}> {
  const id = orderId.trim()
  if (!id) return { ok: false, message: "Missing order id." }
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role is not configured." }

  const { data, error } = await admin.rpc("attach_deal_for_committed_order", {
    p_order_id: id,
  })
  if (error) {
    console.error("[attachDealForCommittedOrder]", error.message)
    return { ok: false, message: error.message }
  }
  const dealId = data ? String(data) : ""
  return dealId ? { ok: true, dealId } : { ok: true }
}
