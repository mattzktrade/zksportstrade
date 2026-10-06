"use server"

import { requireAdminAction } from "@/app/(admin)/actions"
import type { AdminRaceOption } from "@/lib/admin/queries"
import type { ClientDirectoryRow, StaffOption } from "@/lib/crm/lead-types"

export async function fetchClientDirectoryPage(): Promise<
  | {
      ok: true
      clients: ClientDirectoryRow[]
      staffOptions: StaffOption[]
      races: AdminRaceOption[]
    }
  | { ok: false; message: string }
> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  try {
    const [{ getClientDirectoryRows, getSalesStaffOptions }, { getAdminRaceOptions }] = await Promise.all([
      import("@/lib/crm/leads"),
      import("@/lib/admin/queries"),
    ])
    const [clients, staffOptions, races] = await Promise.all([
      getClientDirectoryRows(),
      getSalesStaffOptions(),
      getAdminRaceOptions(),
    ])
    return { ok: true, clients, staffOptions, races }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Accounts could not be loaded.",
    }
  }
}
