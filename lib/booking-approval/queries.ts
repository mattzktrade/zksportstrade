import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type { AdminBookingApprovalRow, BookingApprovalRequestRow } from "@/lib/booking-approval/types"
import { getBookingFulfillmentSupplierOptions } from "@/lib/booking-approval/fulfillment-suppliers"

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

const REQUEST_COLUMNS = `
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
  client_company,
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
  order_id,
  reviewed_at,
  reviewed_by,
  rejection_note,
  created_at
` as const

export async function getMyBookingApprovalRequests(): Promise<BookingApprovalRequestRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("booking_approval_requests")
    .select(REQUEST_COLUMNS)
    .order("created_at", { ascending: false })

  if (error || !data) return []
  return data as BookingApprovalRequestRow[]
}

export async function getPendingBookingApprovalRequestsForAdmin(): Promise<AdminBookingApprovalRow[]> {
  noStore()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("booking_approval_requests")
    .select(
      `
      ${REQUEST_COLUMNS},
      packages ( name, circuit, event_date ),
      agent:profiles!agent_profile_id ( full_name, company_name, email )
    `,
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })

  if (error || !data) return []

  const admin = createAdminClient() ?? supabase
  const rows = data as Array<
    BookingApprovalRequestRow & {
      packages?: AdminBookingApprovalRow["packages"] | AdminBookingApprovalRow["packages"][]
      agent?: AdminBookingApprovalRow["agent"] | AdminBookingApprovalRow["agent"][]
    }
  >

  return Promise.all(
    rows.map(async (row) => {
      const fulfillmentSuppliers = await getBookingFulfillmentSupplierOptions(
        admin,
        row.package_id,
        row.guests,
      ).catch(() => [
        {
          costLayerId: "",
          label: "Automatic (prefer single supplier / suite)",
          remaining: 0,
          canCover: true,
        },
      ])
      return {
        ...row,
        packages: one(row.packages),
        agent: one(row.agent),
        fulfillmentSuppliers,
      }
    }),
  )
}

export async function countPendingBookingApprovalRequests(): Promise<number> {
  noStore()
  const supabase = await createClient()
  const { count, error } = await supabase
    .from("booking_approval_requests")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending")

  if (error) return 0
  return count ?? 0
}
