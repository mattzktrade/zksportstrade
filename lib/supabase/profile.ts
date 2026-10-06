import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import {
  ACCESS_TOKEN_REFRESH_SKEW_MS,
  PROFILE_LOAD_TIMEOUT_MESSAGE,
  PROFILE_LOOKUP_TIMEOUT_MS,
  SESSION_LOOKUP_TIMEOUT_MS,
  withTimeout,
} from "@/lib/supabase/session-guard"
import type { PortalProfile } from "@/lib/types/profile"

const PROFILE_COLUMNS =
  "id, email, full_name, company_name, company_type, mobile, role, approval_status, approval_note, shipping_address_line1, shipping_address_line2, shipping_city, shipping_postcode, shipping_country, billing_address_line1, billing_address_line2, billing_city, billing_postcode, billing_country" as const

export const getPortalProfile = cache(async (): Promise<PortalProfile | null> => {
  const supabase = await createClient()
  // Prefer the local session cookie. getUser() hits Auth over the network and
  // used to stall ~30s with the click looking dead. Refresh via getUser only
  // when the access token is missing or close to expiry.
  const sessionResult = await withTimeout(supabase.auth.getSession(), 1_500)
  const session = sessionResult.ok ? sessionResult.value.data.session : null
  const expiresAtMs = typeof session?.expires_at === "number" ? session.expires_at * 1000 : 0
  const sessionFresh = Boolean(session?.user) && expiresAtMs - Date.now() > ACCESS_TOKEN_REFRESH_SKEW_MS
  let user = sessionFresh ? session?.user ?? null : null
  let userLookupFailed = false
  if (!user) {
    const userResult = await withTimeout(supabase.auth.getUser(), SESSION_LOOKUP_TIMEOUT_MS)
    user = userResult.ok ? userResult.value.data.user : null
    userLookupFailed = !userResult.ok
    if (!user) user = session?.user ?? null
  }
  if (!user && userLookupFailed) {
    throw new Error(PROFILE_LOAD_TIMEOUT_MESSAGE)
  }
  if (!user) return null

  const profileResult = await withTimeout(
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).single(),
    PROFILE_LOOKUP_TIMEOUT_MS,
  )
  if (!profileResult.ok) {
    throw new Error(PROFILE_LOAD_TIMEOUT_MESSAGE)
  }
  const { data, error } = profileResult.value
  if (error || !data) return null
  return data as PortalProfile
})
