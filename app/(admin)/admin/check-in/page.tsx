import { redirect } from "next/navigation"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { getPortalProfile } from "@/lib/supabase/profile"
import { CheckInClient } from "./check-in-client"

export const dynamic = "force-dynamic"

export default async function CheckInPage() {
  const profile = await getPortalProfile()
  if (!profile || !hasCmsPermission(profile, "operations.view")) redirect("/admin")
  return <CheckInClient canScan={hasCmsPermission(profile, "operations.manage")} />
}
