import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { invoiceDisplayStatus } from "@/lib/invoices/status"

export type DashboardActionCounts = {
  awaitingPayment: number
  awaitingDelivery: number
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

/** Trade-portal orders needing finance or ops follow-up (excludes Wix). */
export async function getDashboardActionCounts(): Promise<DashboardActionCounts> {
  noStore()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("orders")
    .select("id, status, invoices(status)")
    .neq("channel", "wix")
    .neq("status", "cancelled")
    .limit(10000)

  if (error || !data) {
    return { awaitingPayment: 0, awaitingDelivery: 0 }
  }

  let awaitingPayment = 0
  let awaitingDelivery = 0

  for (const row of data) {
    const invoice = one(row.invoices as { status: string } | { status: string }[] | null)
    const status = invoiceDisplayStatus(invoice?.status ?? "awaiting_payment")
    if (status === "awaiting_payment") awaitingPayment += 1
    else if (status === "paid") awaitingDelivery += 1
  }

  return { awaitingPayment, awaitingDelivery }
}
