import { redirect } from "next/navigation"
import { getPortalProfile } from "@/lib/supabase/profile"

/** Server-only: ensures session user is an admin profile. */
export async function requireAdmin() {
  const profile = await getPortalProfile()
  if (!profile) {
    redirect("/login")
  }
  if (profile.role !== "admin") {
    redirect("/")
  }
  return profile
}
