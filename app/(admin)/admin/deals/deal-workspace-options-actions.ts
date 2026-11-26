"use server"

import { hasCmsPermission } from "@/lib/auth/permissions"
import { loadDealWorkspaceOptions, type DealWorkspaceOptions } from "@/lib/crm/deal-workspace-options"
import { getPortalProfile } from "@/lib/supabase/profile"

export async function loadDealWorkspaceOptionsAction(): Promise<
  { ok: true; options: DealWorkspaceOptions } | { ok: false }
> {
  const profile = await getPortalProfile()
  if (!profile || !hasCmsPermission(profile, "deals.view")) return { ok: false }
  return { ok: true, options: await loadDealWorkspaceOptions() }
}
