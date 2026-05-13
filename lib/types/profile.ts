export type PortalProfile = {
  id: string
  email: string
  full_name: string
  company_name: string
  role: "agent" | "admin"
  approval_status: "pending" | "approved" | "rejected"
  approval_note?: string | null
  created_at?: string
  updated_at?: string
}
