import { enqueueInvoiceCreateServer } from "@/lib/integrations/enqueue-server"
import { isInvoiceIssuable } from "@/lib/invoices/order-invoices"
import { createAdminClient } from "@/lib/supabase/admin"

export type InstallmentInvoiceIssueResult = {
  checked: number
  queued: number
  failed: number
}

/** Queue Xero invoices for later booking-form installments once they are within the due window. */
export async function processInstallmentInvoiceCreates(): Promise<InstallmentInvoiceIssueResult> {
  const admin = createAdminClient()
  if (!admin) return { checked: 0, queued: 0, failed: 0 }

  const { data, error } = await admin
    .from("invoices")
    .select("*, orders!inner(channel, status)")
    .is("xero_invoice_id", null)
    .eq("status", "awaiting_invoice")
    .eq("orders.channel", "native_deal")
    .neq("orders.status", "cancelled")
    .order("due_date", { ascending: true, nullsFirst: true })
    .limit(40)
  if (error) throw new Error(error.message)

  const rows = data ?? []
  let queued = 0
  let failed = 0
  const seenOrders = new Set<string>()
  for (const row of rows) {
    if ((row.installment_index ?? 1) <= 1) continue
    if (!isInvoiceIssuable(row)) continue
    if (seenOrders.has(row.order_id)) continue
    seenOrders.add(row.order_id)
    const result = await enqueueInvoiceCreateServer(row.order_id)
    if (result.ok) queued += 1
    else failed += 1
  }

  return { checked: rows.length, queued, failed }
}