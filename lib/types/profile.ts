export const COMPANY_TYPES = [
  "concierge",
  "travel_agency",
  "ticket_agent",
  "hospitality_agency",
  "other",
] as const

export type CompanyType = (typeof COMPANY_TYPES)[number]

export const COMPANY_TYPE_OPTIONS: { value: CompanyType; label: string }[] = [
  { value: "concierge", label: "Concierge company" },
  { value: "travel_agency", label: "Travel agency" },
  { value: "ticket_agent", label: "Ticket agent" },
  { value: "hospitality_agency", label: "Hospitality agency" },
  { value: "other", label: "Other" },
]

export function getCompanyTypeLabel(companyType: CompanyType | string | null | undefined): string {
  if (!companyType) return "—"
  return COMPANY_TYPE_OPTIONS.find((o) => o.value === companyType)?.label ?? companyType
}

export type PortalProfile = {
  id: string
  email: string
  full_name: string
  company_name: string
  company_type?: CompanyType | null
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
