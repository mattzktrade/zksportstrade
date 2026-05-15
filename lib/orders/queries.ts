import { createClient } from "@/lib/supabase/server"
import type { Booking } from "@/lib/data"
import { normalizeInvoiceStatus } from "@/lib/invoices/status"
import type { OrderRow, PackageSnippet } from "@/lib/orders/types"

type OrderInvoiceSnippet = { status: string }

type OrderWithPackage = OrderRow & {
  packages: PackageSnippet | null
  invoices?: OrderInvoiceSnippet | OrderInvoiceSnippet[] | null
}

export type AdminOrderAgent = {
  full_name: string | null
  company_name: string | null
  email: string
}

export type AdminOrderInvoice = {
  id: string
  reference: string
  status: string
}

export type AdminOrderListRow = OrderRow & {
  packages: PackageSnippet | null
  agent: AdminOrderAgent | null
  invoice: AdminOrderInvoice | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function mapOrderToBooking(row: OrderWithPackage): Booking {
  const pkg = row.packages
  const invoice = one(row.invoices)
  return {
    id: row.id,
    orderReference: row.reference,
    packageId: row.package_id,
    packageName: pkg?.name ?? "Package",
    circuit: pkg?.circuit ?? "",
    date: pkg?.event_date ?? row.created_at,
    guests: row.guests,
    invoiceStatus: normalizeInvoiceStatus(invoice?.status ?? "awaiting_invoice"),
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
      client_nationality,
      dietary_requirements,
      special_requests,
      po_number,
      shipping_address_line1,
      shipping_address_line2,
      shipping_city,
      shipping_postcode,
      shipping_country,
      billing_address_line1,
      billing_address_line2,
      billing_city,
      billing_postcode,
      billing_country,
      created_at,
      packages (
        name,
        circuit,
        event_date,
        tier,
        total_capacity
      ),
      invoices (
        status
      )
    `,
    )
    .order("created_at", { ascending: false })

  if (error || !data) return []

  return (data as (OrderRow & {
    packages?: PackageSnippet | PackageSnippet[] | null
    invoices?: OrderInvoiceSnippet | OrderInvoiceSnippet[] | null
  })[]).map((row) => {
    const normalized: OrderWithPackage = {
      ...(row as OrderRow),
      packages: one(row.packages),
      invoices: one(row.invoices),
    }
    return mapOrderToBooking(normalized)
  })
}

type RawAdminOrder = OrderRow & {
  packages?: PackageSnippet | PackageSnippet[] | null
  profiles?: AdminOrderAgent | AdminOrderAgent[] | null
  invoices?: AdminOrderInvoice | AdminOrderInvoice[] | null
}

export async function getAllOrdersForAdmin(): Promise<AdminOrderListRow[]> {
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
      client_nationality,
      dietary_requirements,
      special_requests,
      po_number,
      shipping_address_line1,
      shipping_address_line2,
      shipping_city,
      shipping_postcode,
      shipping_country,
      billing_address_line1,
      billing_address_line2,
      billing_city,
      billing_postcode,
      billing_country,
      created_at,
      packages (
        name,
        circuit,
        event_date,
        tier,
        total_capacity
      ),
      profiles (
        full_name,
        company_name,
        email
      ),
      invoices (
        id,
        reference,
        status
      )
    `,
    )
    .order("created_at", { ascending: false })
    .limit(5000)

  if (error || !data) return []

  return (data as RawAdminOrder[]).map((row) => ({
    ...(row as OrderRow),
    packages: one(row.packages),
    agent: one(row.profiles),
    invoice: one(row.invoices),
  }))
}
