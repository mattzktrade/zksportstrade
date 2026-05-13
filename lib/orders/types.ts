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
  client_company: string
  dietary_requirements: string | null
  special_requests: string | null
  po_number: string | null
  created_at: string
}

export type PackageSnippet = {
  name: string
  circuit: string
  event_date: string
  tier: string
  total_capacity: number
}
