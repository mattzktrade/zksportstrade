import { syncBookingFormDealInventory } from "@/lib/booking-forms/inventory-sync"
import { enqueueInvoiceCreateServer } from "@/lib/integrations/enqueue-server"
import { scheduleOutboxDrain } from "@/lib/integrations/schedule-drain"
import { createAdminClient } from "@/lib/supabase/admin"

export type NativeDealOrderResult = {
  orderId: string
  orderReference: string
  alreadyCreated: boolean
  invoiceQueued: boolean
  warning?: string
}

export async function ensureNativeDealOrderAndInvoice(
  dealId: string,
): Promise<NativeDealOrderResult> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  const { data, error } = await admin.rpc("admin_create_order_from_signed_deal", {
    p_deal_id: dealId,
  })
  if (error) throw new Error(error.message)
  const payload = (data ?? {}) as Record<string, unknown>
  const orderId = String(payload.order_id ?? "")
  const orderReference = String(payload.order_reference ?? "")
  if (!orderId) throw new Error("Order conversion did not return an order id.")

  await syncBookingFormDealInventory(dealId, "native_deal_order_commit")
  const queued = await enqueueInvoiceCreateServer(orderId)
  if (!queued.ok) {
    await admin
      .from("deals")
      .update({
        stage: "awaiting_invoice",
        next_action: "Retry failed Xero invoice queue",
        next_action_due_at: new Date().toISOString(),
      })
      .eq("id", dealId)
    return {
      orderId,
      orderReference,
      alreadyCreated: Boolean(payload.already_created),
      invoiceQueued: false,
      warning: queued.message,
    }
  }

  scheduleOutboxDrain({ orderId, maxRounds: 20 })
  await admin
    .from("deals")
    .update({
      next_action: "Await Xero invoice",
      next_action_due_at: new Date().toISOString(),
    })
    .eq("id", dealId)
  return {
    orderId,
    orderReference,
    alreadyCreated: Boolean(payload.already_created),
    invoiceQueued: true,
  }
}

