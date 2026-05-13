import { createClient } from "@/lib/supabase/server"
import type { PortalProfile } from "@/lib/types/profile"

export async function getPortalProfile(): Promise<PortalProfile | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single()
  if (error || !data) return null
  return data as PortalProfile
}
