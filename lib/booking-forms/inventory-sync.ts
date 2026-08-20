import { createAdminClient } from "@/lib/supabase/admin"
import { packageIdsForInventoryChannelSync } from "@/lib/integrations/inventory-sync-packages"
import { enqueuePackageInventoryChannelSyncServer } from "@/lib/integrations/enqueue-server"
import { scheduleOutboxDrain } from "@/lib/integrations/schedule-drain"

export async function syncBookingFormDealInventory(
  dealId: string,
  trigger: string,
): Promise<string[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data, error } = await admin
    .from("deal_line_items")
    .select("package_id")
    .eq("deal_id", dealId)
  if (error) {
    console.warn(`[booking-forms] Could not load deal inventory for sync: ${error.message}`)
    return []
  }
  const packageIds = new Set<string>()
  for (const row of data ?? []) {
    for (const packageId of await packageIdsForInventoryChannelSync(admin, String(row.package_id))) {
      packageIds.add(packageId)
    }
  }
  for (const packageId of packageIds) {
    const result = await enqueuePackageInventoryChannelSyncServer(packageId, {
      trigger,
      scheduleDrain: false,
    })
    if (!result.ok) {
      console.warn(`[booking-forms] Inventory sync not queued for ${packageId}: ${result.message}`)
    }
  }
  if (packageIds.size) scheduleOutboxDrain({ maxRounds: 10 })
  return [...packageIds]
}

