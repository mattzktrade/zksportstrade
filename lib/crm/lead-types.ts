import type { AccountKind } from "@/lib/crm/account-kinds"

export type LeadStatus =
  | "new"
  | "contacted"
  | "price_sent"
  | "converted"
  | "unqualified"
  | "closed"

export type LeadSource =
  | "manual"
  | "website"
  | "portal"
  | "referral"
  | "marketing"
  | "repeat_client"
  | "other"

export type LeadListRow = {
  id: string
  reference: string
  status: LeadStatus
  source: LeadSource
  account_id: string
  contact_id: string | null
  owner_profile_id: string | null
  race_id: string | null
  package_id: string | null
  quantity: number
  account_name: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  owner_name: string | null
  event_name: string | null
  package_name: string | null
  interest: string | null
  estimated_value: number | null
  currency: string
  next_action: string | null
  next_action_due_at: string | null
  notes: string | null
  converted_deal_id: string | null
  created_at: string
  updated_at: string
}

export type AccountSource =
  | "manual"
  | "website"
  | "referral"
  | "marketing"
  | "other"

export type ClientDirectoryRow = {
  id: string
  name: string
  account_type: string
  account_types: AccountKind[]
  email: string | null
  phone: string | null
  owner_profile_id: string | null
  owner_name: string | null
  source: AccountSource
  created_at: string
  contacts: Array<{
    id: string
    full_name: string
    email: string | null
    phone: string | null
    job_title: string | null
    is_primary: boolean
  }>
  deal_count: number
  lifetime_spend: number
  last_activity_at: string
}

export type StaffOption = {
  id: string
  name: string
  role: string
}

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  price_sent: "Price sent",
  converted: "Converted",
  unqualified: "Unqualified",
  closed: "Closed",
}

export const ACCOUNT_SOURCES: AccountSource[] = [
  "manual",
  "website",
  "referral",
  "marketing",
  "other",
]

export const ACCOUNT_SOURCE_LABELS: Record<AccountSource, string> = {
  manual: "Manual",
  website: "Website",
  referral: "Referral",
  marketing: "Marketing",
  other: "Other",
}

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  manual: "Manual",
  website: "Website",
  portal: "Website",
  referral: "Referral",
  marketing: "Marketing",
  repeat_client: "Other",
  other: "Other",
}

