import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import type { PortalProfile } from "@/lib/types/profile"

const PROFILE_COLUMNS =
  "id, email, full_name, company_name, mobile, role, approval_status, approval_note, shipping_address_line1, shipping_address_line2, shipping_city, shipping_postcode, shipping_country, billing_address_line1, billing_address_line2, billing_city, billing_postcode, billing_country" as const

export const getPortalProfile = cache(async (): Promise<PortalProfile | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).single()
  if (error || !data) return null
  return data as PortalProfile
})
