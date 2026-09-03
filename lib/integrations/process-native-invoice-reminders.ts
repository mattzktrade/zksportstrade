import { createAdminClient } from "@/lib/supabase/admin"
import { reconcileXeroInvoiceForOrder } from "@/lib/integrations/xero/invoices"
import { cancellationEligibleDate, daysOverdue } from "@/lib/crm/deal-finance"

export type NativeInvoiceReminderResult = {
  overdueInvoices: number
  remindersSent: number
  failures: number
  cancellationEligible: number
}

/**
 * Reconcile overdue native invoices with Xero and flag 28-day cancellation review.
 * Payment reminder emails are not sent here — Xero already handles those.
 */
export async function processNativeInvoiceReminders(): Promise<NativeInvoiceReminderResult> {
  const admin = createAdminClient()
  if (!admin) {
    return { overdueInvoices: 0, remindersSent: 0, failures: 0, cancellationEligible: 0 }
  }
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const { data: invoices, error } = await admin
    .from("invoices")
    .select("id, order_id, due_date, xero_invoice_id")
    .eq("status", "awaiting_payment")
    .lt("due_date", today)
    .not("xero_invoice_id", "is", null)
    .order("due_date")
    .limit(200)
  if (error) throw new Error(error.message)

  let failures = 0
  let cancellationEligible = 0
  let overdueInvoices = 0
  for (const invoice of invoices ?? []) {
    const { data: order } = await admin
      .from("orders")
      .select("id, channel, deal_id")
      .eq("id", invoice.order_id)
      .maybeSingle()
    if (!order || order.channel !== "native_deal") continue
    try {
      const remoteStatus = await reconcileXeroInvoiceForOrder(order.id)
      if (remoteStatus === "PAID" || remoteStatus === "VOIDED" || remoteStatus === "DELETED") {
        continue
      }
    } catch (reconcileError) {
      failures += 1
      await admin
        .from("invoices")
        .update({
          payment_reminder_error: `Could not verify Xero status: ${
            reconcileError instanceof Error ? reconcileError.message : "unknown error"
          }`,
        })
        .eq("id", invoice.id)
      continue
    }
    overdueInvoices += 1
    const overdueDays = Math.max(1, daysOverdue(invoice.due_date, now))
    const eligibleDate = cancellationEligibleDate(invoice.due_date)
    const isEligible = overdueDays >= 28
    if (isEligible) cancellationEligible += 1

    await admin
      .from("invoices")
      .update({
        overdue_since: invoice.due_date,
        cancellation_eligible_at: eligibleDate,
        payment_reminder_error: null,
      })
      .eq("id", invoice.id)
    if (isEligible && order.deal_id) {
      await admin
        .from("deals")
        .update({
          next_action: "Payment 28+ days overdue — review cancellation",
          next_action_due_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", order.deal_id)
    }
  }

  return { overdueInvoices, remindersSent: 0, failures, cancellationEligible }
}
