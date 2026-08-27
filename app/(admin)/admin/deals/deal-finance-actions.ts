"use server"

import { revalidatePath } from "next/cache"
import { getPortalProfile } from "@/lib/supabase/profile"
import { createClient } from "@/lib/supabase/server"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { ensureNativeDealOrderAndInvoice } from "@/lib/crm/deal-order-automation"
import {
  prepareXeroInvoiceReplacement,
  reconcileXeroInvoiceForOrder,
  resendXeroInvoiceForOrder,
  voidXeroInvoiceForOrder,
} from "@/lib/integrations/xero/invoices"
import { enqueueInvoiceCreateServer, enqueueInvoiceReplaceServer } from "@/lib/integrations/enqueue-server"
import { scheduleOutboxDrain } from "@/lib/integrations/schedule-drain"
import { syncBookingFormDealInventory } from "@/lib/booking-forms/inventory-sync"
import { prepareOrderCancelRelease } from "@/lib/inventory/prepare-order-cancel-release"
import {
  assertOrderCanBeCancelled,
  finalizeNativeDealOrderCancel,
  orderCancelMustSkipCogsDelete,
  postgresErrorText,
  releaseOrderStockSkippingRestatedCogs,
  shouldUseRestatementSafeOrderCancel,
} from "@/lib/inventory/cancel-order-stock"

type Result = { ok: true; message: string } | { ok: false; message: string }

async function financeGate() {
  const [profile, supabase] = await Promise.all([getPortalProfile(), createClient()])
  if (!profile || !hasCmsPermission(profile, "finance.manage")) return null
  return { profile, supabase }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected finance automation error."
}

function cancelOrderErrorMessage(detail: string): string {
  if (detail.includes("tickets_or_delivery_block_cancellation")) {
    return "This order cannot be cancelled because tickets have already been received or delivered."
  }
  if (detail.includes("paid_or_delivered_order_cannot_be_cancelled")) {
    return "A paid or delivered order cannot be cancelled."
  }
  if (detail.includes("allocation_fulfilment_locked")) {
    return "Stock cannot be restored because supplier fulfilment has already started."
  }
  return detail
}

export async function retryNativeDealInvoice(dealId: string): Promise<Result> {
  const gate = await financeGate()
  if (!gate) return { ok: false, message: "Finance permission is required." }
  try {
    const { data: deal, error } = await gate.supabase
      .from("deals")
      .select("id, order_id")
      .eq("id", dealId)
      .maybeSingle()
    if (error || !deal) throw new Error(error?.message ?? "Deal not found.")
    if (!deal.order_id) {
      const result = await ensureNativeDealOrderAndInvoice(deal.id)
      revalidatePath("/admin/deals")
      revalidatePath("/admin")
      return {
        ok: true,
        message: result.warning
          ? `Order created, but invoice queue needs attention: ${result.warning}`
          : "Order created and Xero invoice queued.",
      }
    }
    const queued = await enqueueInvoiceCreateServer(String(deal.order_id))
    if (!queued.ok) throw new Error(queued.message)
    scheduleOutboxDrain({ orderId: String(deal.order_id), maxRounds: 20 })
    revalidatePath("/admin/deals")
    return { ok: true, message: "Xero invoice creation queued for retry." }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

export async function resendNativeDealInvoice(orderId: string): Promise<Result> {
  const gate = await financeGate()
  if (!gate) return { ok: false, message: "Finance permission is required." }
  try {
    await resendXeroInvoiceForOrder(orderId)
    revalidatePath("/admin/deals")
    return { ok: true, message: "Invoice PDF resent to the billing contact." }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

export async function reconcileNativeDealInvoice(orderId: string): Promise<Result> {
  const gate = await financeGate()
  if (!gate) return { ok: false, message: "Finance permission is required." }
  try {
    const status = await reconcileXeroInvoiceForOrder(orderId, gate.profile.id)
    revalidatePath("/admin/deals")
    return { ok: true, message: `Xero reconciliation complete: ${status}.` }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

export async function cancelNativeDealOrder(input: {
  dealId: string
  orderId: string
  reason: string
}): Promise<Result> {
  const gate = await financeGate()
  if (!gate) return { ok: false, message: "Finance permission is required." }
  if (!input.reason.trim()) return { ok: false, message: "A cancellation reason is required." }
  try {
    await voidXeroInvoiceForOrder(input.orderId)
    const cancellable = await assertOrderCanBeCancelled(input.orderId)
    if (cancellable.alreadyCancelled) {
      revalidatePath("/admin/deals")
      revalidatePath("/admin/orders")
      return { ok: true, message: "This order is already cancelled." }
    }
    await prepareOrderCancelRelease(input.orderId)
    const skipCogsDelete = await orderCancelMustSkipCogsDelete(input.orderId)
    if (!skipCogsDelete) {
      const { error } = await gate.supabase.rpc("admin_cancel_native_deal_order", {
        p_order_id: input.orderId,
        p_reason: input.reason.trim(),
        p_xero_void_confirmed: true,
      })
      if (error) {
        if (!shouldUseRestatementSafeOrderCancel(postgresErrorText(error))) {
          throw new Error(error.message)
        }
      } else {
        await syncBookingFormDealInventory(input.dealId, "native_deal_order_cancelled")
        revalidatePath("/admin/deals")
        revalidatePath("/admin/orders")
        return { ok: true, message: "Xero invoice voided, order cancelled, and stock restored." }
      }
    }
    await releaseOrderStockSkippingRestatedCogs(
      input.orderId,
      `Native deal order cancelled: ${input.reason.trim()}`,
    )
    await finalizeNativeDealOrderCancel({
      dealId: input.dealId,
      orderId: input.orderId,
      reason: input.reason.trim(),
    })
    await syncBookingFormDealInventory(input.dealId, "native_deal_order_cancelled")
    revalidatePath("/admin/deals")
    revalidatePath("/admin/orders")
    return { ok: true, message: "Xero invoice voided, order cancelled, and stock restored." }
  } catch (error) {
    return { ok: false, message: cancelOrderErrorMessage(message(error)) }
  }
}

export async function markFinanceRowPaid(input: {
  invoiceId?: string | null
  dealId?: string | null
}): Promise<Result> {
  const gate = await financeGate()
  if (!gate) return { ok: false, message: "Finance permission is required." }
  if (!input.invoiceId && !input.dealId) {
    return { ok: false, message: "Choose a deal or invoice to mark paid." }
  }
  try {
    const { error } = await gate.supabase.rpc("admin_mark_finance_paid", {
      p_invoice_id: input.invoiceId || null,
      p_deal_id: input.dealId || null,
    })
    if (error) throw new Error(error.message)
    revalidatePath("/admin/finance")
    revalidatePath("/admin/deals")
    revalidatePath("/admin/operations")
    return { ok: true, message: "Marked as paid." }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

export async function markFinanceRowUnpaid(input: {
  invoiceId?: string | null
  dealId?: string | null
}): Promise<Result> {
  const gate = await financeGate()
  if (!gate) return { ok: false, message: "Finance permission is required." }
  if (!input.invoiceId && !input.dealId) {
    return { ok: false, message: "Choose a deal or invoice to mark unpaid." }
  }
  try {
    const { error } = await gate.supabase.rpc("admin_mark_finance_unpaid", {
      p_invoice_id: input.invoiceId || null,
      p_deal_id: input.dealId || null,
    })
    if (error) throw new Error(error.message)
    revalidatePath("/admin/finance")
    revalidatePath("/admin/deals")
    revalidatePath("/admin/operations")
    return { ok: true, message: "Marked as unpaid." }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

export async function replaceFinanceInvoice(orderId: string): Promise<Result> {
  const gate = await financeGate()
  if (!gate) return { ok: false, message: "Finance permission is required." }
  const id = orderId.trim()
  if (!id || id.startsWith("deal:")) {
    return { ok: false, message: "This deal has no order invoice to replace." }
  }
  try {
    const replaceKey = await prepareXeroInvoiceReplacement(id)
    const queued = await enqueueInvoiceReplaceServer(id, replaceKey)
    if (!queued.ok) throw new Error(queued.message)
    scheduleOutboxDrain({ orderId: id, maxRounds: 20 })
    revalidatePath("/admin/finance")
    revalidatePath("/admin/deals")
    return { ok: true, message: "Previous invoice voided. A replacement is being created in Xero." }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

