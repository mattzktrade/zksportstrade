import { createClient } from "@/lib/supabase/server"
import type { Booking } from "@/lib/data"
import type { OrderRow, PackageSnippet } from "@/lib/orders/types"

type OrderWithPackage = OrderRow & { packages: PackageSnippet | null }

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function mapOrderToBooking(row: OrderWithPackage): Booking {
  const pkg = row.packages
  return {
    id: row.id,
    orderReference: row.reference,
    packageId: row.package_id,
    packageName: pkg?.name ?? "Package",
    circuit: pkg?.circuit ?? "",
    date: pkg?.event_date ?? row.created_at,
    guests: row.guests,
    status: row.status,
    totalAmount: Number(row.total_amount),
    currency: row.currency,
    createdAt: row.created_at,
    clientName: row.client_name,
    clientEmail: row.client_email,
    packageTier: pkg?.tier,
  }
}

export async function getMyBookings(): Promise<Booking[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("orders")
    .select(
      `
      id,
      reference,
      agent_profile_id,
      package_id,
      status,
      guests,
      unit_price,
      total_amount,
      currency,
      client_name,
      client_email,
      client_phone,
      client_company,
      dietary_requirements,
      special_requests,
      po_number,
      created_at,
      packages (
        name,
        circuit,
        event_date,
        tier,
        total_capacity
      )
    `,
    )
    .order("created_at", { ascending: false })

  if (error || !data) return []

  return (data as (OrderRow & { packages?: PackageSnippet | PackageSnippet[] | null })[]).map((row) => {
    const normalized: OrderWithPackage = {
      ...(row as OrderRow),
      packages: one(row.packages),
    }
    return mapOrderToBooking(normalized)
  })
}

export async function getAllOrdersForAdmin(): Promise<OrderWithPackage[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("orders")
    .select(
      `
      id,
      reference,
      agent_profile_id,
      package_id,
      status,
      guests,
      unit_price,
      total_amount,
      currency,
      client_name,
      client_email,
      client_phone,
      client_company,
      dietary_requirements,
      special_requests,
      po_number,
      created_at,
      packages (
        name,
        circuit,
        event_date,
        tier,
        total_capacity
      )
    `,
    )
    .order("created_at", { ascending: false })
    .limit(200)

  if (error || !data) return []

  return (data as (OrderRow & { packages?: PackageSnippet | PackageSnippet[] | null })[]).map((row) => ({
    ...(row as OrderRow),
    packages: one(row.packages),
  }))
}
