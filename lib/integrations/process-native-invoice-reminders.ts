import { sendNativeInvoicePaymentReminder } from "@/lib/email/send-payment-reminder"
import { createAdminClient } from "@/lib/supabase/admin"
import { reconcileXeroInvoiceForOrder } from "@/lib/integrations/xero/invoices"
import {
  cancellationEligibleDate,
  daysOverdue,
  paymentReminderIsDue,
} from "@/lib/crm/deal-finance"

export type NativeInvoiceReminderResult = {
  overdueInvoices: number
  remindersSent: number
  failures: number
  cancellationEligible: number
}

export async function processNativeInvoiceReminders(): Promise<NativeInvoiceReminderResult> {
  const admin = createAdminClient()
  if (!admin) {
    return { overdueInvoices: 0, remindersSent: 0, failures: 0, cancellationEligible: 0 }
  }
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const { data: invoices, error } = await admin
    .from("invoices")
    .select(
      "id, order_id, reference, amount, currency, due_date, xero_invoice_id, xero_invoice_number, payment_reminder_count, last_payment_reminder_at",
    )
    .eq("status", "awaiting_payment")
    .lt("due_date", today)
    .not("xero_invoice_id", "is", null)
    .order("due_date")
    .limit(200)
  if (error) throw new Error(error.message)

  let remindersSent = 0
  let failures = 0
  let cancellationEligible = 0
  let overdueInvoices = 0
  for (const invoice of invoices ?? []) {
    const { data: order } = await admin
      .from("orders")
      .select(
        "id, reference, channel, deal_id, crm_account_id, crm_contact_id, agent_profile_id, client_name, client_email",
      )
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

    const reminderCount = Number(invoice.payment_reminder_count ?? 0)
    if (reminderCount >= 5) continue
    const reminderDue = paymentReminderIsDue({
      reminderCount,
      lastReminderAt: invoice.last_payment_reminder_at,
      now,
    })
    if (!reminderDue) continue

    const [{ data: account }, { data: contact }, { data: agent }] = await Promise.all([
      order.crm_account_id
        ? admin
            .from("crm_accounts")
            .select("name, email")
            .eq("id", order.crm_account_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      order.crm_contact_id
        ? admin
            .from("crm_contacts")
            .select("full_name, email")
            .eq("id", order.crm_contact_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      order.agent_profile_id
        ? admin
            .from("profiles")
            .select("company_name, full_name, email")
            .eq("id", order.agent_profile_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    const recipientEmail =
      contact?.email || account?.email || agent?.email || order.client_email
    const recipientName =
      account?.name ||
      agent?.company_name ||
      agent?.full_name ||
      contact?.full_name ||
      order.client_name
    if (!recipientEmail) {
      failures += 1
      await admin
        .from("invoices")
        .update({ payment_reminder_error: "Billing contact has no email address." })
        .eq("id", invoice.id)
      continue
    }
    const sent = await sendNativeInvoicePaymentReminder({
      recipientEmail,
      recipientName,
      orderReference: order.reference,
      xeroInvoiceId: String(invoice.xero_invoice_id),
      xeroInvoiceNumber: invoice.xero_invoice_number,
      amount: Number(invoice.amount),
      currency: invoice.currency,
      dueDate: invoice.due_date,
      daysOverdue: overdueDays,
      reminderNumber: reminderCount + 1,
    })
    if (!sent.ok) {
      failures += 1
      await admin
        .from("invoices")
        .update({
          payment_reminder_error: sent.error ?? sent.skipped ?? "Payment reminder failed.",
        })
        .eq("id", invoice.id)
      continue
    }
    remindersSent += 1
    await admin
      .from("invoices")
      .update({
        payment_reminder_count: reminderCount + 1,
        last_payment_reminder_at: now.toISOString(),
        payment_reminder_error: null,
      })
      .eq("id", invoice.id)
    if (order.deal_id) {
      await admin.from("deal_activities").insert({
        deal_id: order.deal_id,
        action: "payment_reminder_sent",
        summary: `Sent overdue payment reminder ${reminderCount + 1}`,
        metadata: {
          order_id: order.id,
          invoice_id: invoice.id,
          days_overdue: overdueDays,
        },
      })
    }
  }

  return { overdueInvoices, remindersSent, failures, cancellationEligible }
}

