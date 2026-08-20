import { redirect } from "next/navigation"
import { getPortalProfile } from "@/lib/supabase/profile"
import { hasCmsPermission, isCmsStaff, type CmsPermission } from "@/lib/auth/permissions"

/** Server-only: ensures session user is CMS staff (admin, finance, or sales). */
export async function requireAdmin() {
  const profile = await getPortalProfile()
  if (!profile) {
    redirect("/login")
  }
  if (!isCmsStaff(profile)) {
    redirect("/")
  }
  return profile
}

/** Server-only: CMS staff plus a specific permission. */
export async function requireCmsPermission(permission: CmsPermission) {
  const profile = await requireAdmin()
  if (!hasCmsPermission(profile, permission)) {
    redirect("/admin")
  }
  return profile
}
