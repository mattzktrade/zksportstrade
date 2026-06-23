import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type { Booking } from "@/lib/types/catalog"
import { normalizeInvoiceStatus } from "@/lib/invoices/status"
import type { BookingApprovalRequestRow } from "@/lib/booking-approval/types"
import type { OrderRow, PackageSnippet } from "@/lib/orders/types"
import { computeOrderProfit, getConsumptionsForOrders, type OrderProfit } from "@/lib/admin/cost-layers"
import { packageDurationLabel } from "@/lib/catalog/package-duration"

type OrderInvoiceSnippet = { status: string; xero_invoice_number: string | null }

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
  xero_invoice_number: string | null
}

export type AdminOrderSupplierAllocation = {
  supplier: string
  quantity: number
}

export type AdminOrderSupplierConsumption = {
  costLayerId: string | null
  supplier: string
  quantity: number
  unitCost: number | null
  currency: string
}

export type AdminOrderDeliveryProof = {
  id: string
  note: string | null
  fileName: string | null
  fileContentType: string | null
  createdAt: string
}

export type AdminOrderListRow = OrderRow & {
  packages: PackageSnippet | null
  agent: AdminOrderAgent | null
  invoice: AdminOrderInvoice | null
  supplierAllocations: AdminOrderSupplierAllocation[]
  supplierConsumptions: AdminOrderSupplierConsumption[]
  deliveryProofs: AdminOrderDeliveryProof[]
  profit: OrderProfit
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
    xeroInvoiceNumber: invoice?.xero_invoice_number ?? null,
    totalAmount: Number(row.total_amount),
    currency: row.currency,
    createdAt: row.created_at,
    clientName: row.client_name,
    clientEmail: row.client_email,
    packageTier: pkg?.tier,
    packageDuration: packageDurationLabel(pkg?.duration) ?? null,
  }
}

function mapApprovalRequestToBooking(
  row: BookingApprovalRequestRow & {
    packages?: PackageSnippet | PackageSnippet[] | null
  },
): Booking {
  const pkg = one(row.packages)
  return {
    id: row.id,
    orderReference: row.reference,
    packageId: row.package_id,
    packageName: pkg?.name ?? "Package",
    circuit: pkg?.circuit ?? "",
    date: pkg?.event_date ?? row.created_at,
    guests: row.guests,
    invoiceStatus: "awaiting_invoice",
    totalAmount: Number(row.total_amount),
    currency: row.currency,
    createdAt: row.created_at,
    clientName: row.client_name,
    clientEmail: row.client_email,
    packageTier: pkg?.tier,
    packageDuration: packageDurationLabel(pkg?.duration) ?? null,
    approvalRequestStatus: row.status,
    approvalRequestReference: row.reference,
  }
}

export async function getMyBookings(): Promise<Booking[]> {
  const supabase = await createClient()

  const { data: requestRows } = await supabase
    .from("booking_approval_requests")
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
      created_at,
      packages ( name, circuit, event_date, tier, duration, total_capacity )
    `,
    )
    .neq("status", "approved")
    .order("created_at", { ascending: false })

  const approvalBookings = (
    (requestRows ?? []) as Array<
      BookingApprovalRequestRow & { packages?: PackageSnippet | PackageSnippet[] | null }
    >
  ).map(mapApprovalRequestToBooking)

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
      created_at,
      packages (
        name,
        circuit,
        event_date,
        tier,
        duration,
        total_capacity
      ),
      invoices (
        status,
        xero_invoice_number
      )
    `,
    )
    .order("created_at", { ascending: false })

  if (error || !data) return approvalBookings

  const orderBookings = (data as (OrderRow & {
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

  return [...approvalBookings, ...orderBookings].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

type RawAdminOrder = OrderRow & {
  packages?: PackageSnippet | PackageSnippet[] | null
  profiles?: AdminOrderAgent | AdminOrderAgent[] | null
  invoices?: AdminOrderInvoice | AdminOrderInvoice[] | null
}

export async function getOrdersForPackage(packageId: string): Promise<AdminOrderListRow[]> {
  const all = await getAllOrdersForAdmin()
  return all.filter((o) => o.package_id === packageId)
}

export async function getAllOrdersForAdmin(): Promise<AdminOrderListRow[]> {
  noStore()
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
        duration,
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
        status,
        xero_invoice_number
      )
    `,
    )
    .neq("channel", "wix")
    .order("created_at", { ascending: false })
    .limit(5000)

  if (error || !data) return []

  const rows = data as RawAdminOrder[]
  const orderIds = rows.map((r) => r.id)
  const consumptionsByOrder = await getConsumptionsForOrders(orderIds)
  const { data: deliveryProofRows } =
    orderIds.length > 0
      ? await supabase
          .from("order_delivery_proofs")
          .select("id, order_id, note, file_name, file_content_type, created_at")
          .in("order_id", orderIds)
          .order("created_at", { ascending: false })
      : { data: [] }
  const deliveryProofsByOrder = new Map<string, AdminOrderDeliveryProof[]>()
  for (const row of deliveryProofRows ?? []) {
    const orderId = String(row.order_id ?? "")
    const list = deliveryProofsByOrder.get(orderId) ?? []
    list.push({
      id: String(row.id),
      note: typeof row.note === "string" ? row.note : null,
      fileName: typeof row.file_name === "string" ? row.file_name : null,
      fileContentType: typeof row.file_content_type === "string" ? row.file_content_type : null,
      createdAt: String(row.created_at),
    })
    deliveryProofsByOrder.set(orderId, list)
  }

  return rows.map((row) => {
    const consumptions = consumptionsByOrder.get(row.id) ?? []
    const suppliers = new Map<string, number>()
    for (const c of consumptions) {
      const label = c.supplier_source_snapshot?.trim() || "Unassigned"
      suppliers.set(label, (suppliers.get(label) ?? 0) + c.quantity)
    }
    const orderCurrency = (row.currency ?? "USD").trim() || "USD"
    const guests = Math.max(0, Math.floor(Number(row.guests)))
    const profit = computeOrderProfit(
      orderCurrency,
      Number(row.total_amount),
      consumptions,
      guests > 0 ? guests : undefined,
    )
    return {
      ...(row as OrderRow),
      packages: one(row.packages),
      agent: one(row.profiles),
      invoice: one(row.invoices),
      supplierAllocations: [...suppliers.entries()].map(([supplier, quantity]) => ({ supplier, quantity })),
      supplierConsumptions: consumptions.map((c) => ({
        costLayerId: c.cost_layer_id,
        supplier: c.supplier_source_snapshot?.trim() || "Unassigned",
        quantity: c.quantity,
        unitCost: c.unit_cost,
        currency: c.currency,
      })),
      deliveryProofs: deliveryProofsByOrder.get(row.id) ?? [],
      profit,
    }
  })
}
