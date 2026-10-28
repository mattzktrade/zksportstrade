import { markDealSignedAfterZkCountersign } from "@/lib/booking-forms/advance-deal"
import { syncBookingFormDealInventory } from "@/lib/booking-forms/inventory-sync"
import { enqueueInvoiceCreateServer } from "@/lib/integrations/enqueue-server"
import { drainOutboxNow, scheduleOutboxDrain } from "@/lib/integrations/schedule-drain"
import { applyBookingFormPaymentScheduleToOrder, loadOrderInvoices } from "@/lib/invoices/order-invoices"
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
  await markDealSignedAfterZkCountersign(admin, dealId)
  const { data, error } = await admin.rpc("admin_create_order_from_signed_deal", {
    p_deal_id: dealId,
  })
  if (error) throw new Error(error.message)
  const payload = (data ?? {}) as Record<string, unknown>
  const orderId = String(payload.order_id ?? "")
  const orderReference = String(payload.order_reference ?? "")
  if (!orderId) throw new Error("Order conversion did not return an order id.")

  await syncBookingFormDealInventory(dealId, "native_deal_order_commit")
  try {
    await applyBookingFormPaymentScheduleToOrder(admin, orderId)
  } catch (scheduleError) {
    await admin
      .from("deals")
      .update({
        stage: "awaiting_invoice",
        next_action: "Retry failed payment-schedule invoices",
        next_action_due_at: new Date().toISOString(),
      })
      .eq("id", dealId)
    return {
      orderId,
      orderReference,
      alreadyCreated: Boolean(payload.already_created),
      invoiceQueued: false,
      warning: scheduleError instanceof Error ? scheduleError.message : "Payment schedule invoices failed.",
    }
  }
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

  let drainWarning: string | undefined
  try {
    const drain = await drainOutboxNow({ orderId, maxRounds: 20 })
    if (drain.failed > 0) {
      drainWarning =
        drain.failures?.[0]?.error ??
        `Sync queue: ${drain.failed} job(s) failed — retry from the deal if needed.`
    }
  } catch (error) {
    scheduleOutboxDrain({ orderId, maxRounds: 20 })
    drainWarning = error instanceof Error ? error.message : "Xero invoice drain failed."
  }

  const invoices = await loadOrderInvoices(admin, orderId)
  const synced = invoices.some((invoice) => invoice.xero_invoice_id)
  if (!synced) {
    await admin
      .from("deals")
      .update({
        next_action: drainWarning ? "Retry failed Xero invoice" : "Await Xero invoice",
        next_action_due_at: new Date().toISOString(),
      })
      .eq("id", dealId)
  }
  return {
    orderId,
    orderReference,
    alreadyCreated: Boolean(payload.already_created),
    invoiceQueued: true,
    warning: drainWarning,
  }
}

