import { createClient } from "@/lib/supabase/server"
import type { Invoice } from "@/lib/data"
import { normalizeInvoiceStatus } from "@/lib/invoices/status"

type OrderJoin = {
  id: string
  reference: string
  package_id: string
  packages?: { name: string } | { name: string }[] | null
}

type RawInvoiceRow = {
  id: string
  reference: string
  amount: number
  currency: string
  status: string
  issued_at: string
  due_date: string | null
  orders?: OrderJoin | OrderJoin[] | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export async function getMyInvoices(): Promise<Invoice[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("invoices")
    .select(
      `
      id,
      reference,
      amount,
      currency,
      status,
      issued_at,
      due_date,
      orders (
        id,
        reference,
        package_id,
        packages ( name )
      )
    `,
    )
    .order("issued_at", { ascending: false })

  if (error || !data) return []

  return (data as RawInvoiceRow[]).map((row) => {
    const order = one(row.orders)
    const pkg = order ? one(order.packages) : null
    const pkgName = pkg?.name ?? "Package"
    const due =
      row.due_date ??
      new Date(new Date(row.issued_at).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    return {
      id: row.reference,
      bookingId: order?.reference ?? "",
      orderId: order?.id,
      amount: Number(row.amount),
      currency: row.currency,
      status: normalizeInvoiceStatus(row.status),
      issuedAt: row.issued_at,
      dueDate: due,
      packageName: pkgName,
    }
  })
}
