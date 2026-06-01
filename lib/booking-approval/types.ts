export type BookingApprovalRequestStatus = "pending" | "approved" | "rejected"

export type BookingApprovalRequestRow = {
  id: string
  reference: string
  agent_profile_id: string
  package_id: string
  status: BookingApprovalRequestStatus
  guests: number
  unit_price: number
  total_amount: number
  currency: string
  client_name: string
  client_email: string
  client_phone: string
  client_nationality: string
  client_company: string
  dietary_requirements: string | null
  special_requests: string | null
  po_number: string | null
  shipping_address_line1: string
  shipping_address_line2: string
  shipping_city: string
  shipping_postcode: string
  shipping_country: string
  billing_address_line1: string
  billing_address_line2: string
  billing_city: string
  billing_postcode: string
  billing_country: string
  order_id: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  rejection_note: string | null
  created_at: string
}

export type AdminBookingApprovalRow = BookingApprovalRequestRow & {
  packages: { name: string; circuit: string; event_date: string } | null
  agent: { full_name: string | null; company_name: string | null; email: string } | null
}
