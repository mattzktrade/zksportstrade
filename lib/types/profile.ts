export type PortalProfile = {
  id: string
  email: string
  full_name: string
  company_name: string
  mobile?: string | null
  role: "agent" | "admin"
  approval_status: "pending" | "approved" | "rejected"
  approval_note?: string | null
  created_at?: string
  updated_at?: string
  shipping_address_line1?: string | null
  shipping_address_line2?: string | null
  shipping_city?: string | null
  shipping_postcode?: string | null
  shipping_country?: string | null
  billing_address_line1?: string | null
  billing_address_line2?: string | null
  billing_city?: string | null
  billing_postcode?: string | null
  billing_country?: string | null
}
