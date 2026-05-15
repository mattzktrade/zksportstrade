export type OrderRow = {
  id: string
  reference: string
  agent_profile_id: string
  package_id: string
  status: "pending" | "confirmed" | "cancelled"
  guests: number
  unit_price: number
  total_amount: number
  currency: string
  client_name: string
  client_email: string
  client_phone: string
  client_nationality: string
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
  created_at: string
}

export type PackageSnippet = {
  name: string
  circuit: string
  event_date: string
  tier: string
  duration?: string | null
  total_capacity: number
}
