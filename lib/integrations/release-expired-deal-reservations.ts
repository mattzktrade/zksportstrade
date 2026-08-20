import { createAdminClient } from "@/lib/supabase/admin"
import { packageIdsForInventoryChannelSync } from "@/lib/integrations/inventory-sync-packages"
import { enqueuePackageInventoryChannelSyncServer } from "@/lib/integrations/enqueue-server"
import { scheduleOutboxDrain } from "@/lib/integrations/schedule-drain"

export type ReleaseExpiredDealReservationsResult = {
  dealsExpired: number
  packagesSynced: string[]
}

export async function releaseExpiredDealReservations(): Promise<ReleaseExpiredDealReservationsResult> {
  const admin = createAdminClient()
  if (!admin) return { dealsExpired: 0, packagesSynced: [] }
  const { data: dueRows, error: dueError } = await admin
    .from("inventory_reservations")
    .select("package_id")
    .eq("status", "active")
    .not("expires_at", "is", null)
    .lte("expires_at", new Date().toISOString())
  if (dueError) throw new Error(dueError.message)

  const { data, error } = await admin.rpc("admin_expire_due_deal_reservations")
  if (error) {
    console.error("[deal-reservations] expiry failed:", error.message)
    throw new Error(error.message)
  }
  const dealsExpired = Number(data ?? 0)
  if (dealsExpired === 0) return { dealsExpired, packagesSynced: [] }

  const packagesToSync = new Set<string>()
  for (const row of dueRows ?? []) {
    for (const packageId of await packageIdsForInventoryChannelSync(admin, row.package_id)) {
      packagesToSync.add(packageId)
    }
  }
  for (const packageId of packagesToSync) {
    const queued = await enqueuePackageInventoryChannelSyncServer(packageId, {
      trigger: "deal_reservation_expired",
      scheduleDrain: false,
    })
    if (!queued.ok) {
      console.warn(`[deal-reservations] inventory sync not queued for ${packageId}:`, queued.message)
    }
  }
  scheduleOutboxDrain({ maxRounds: 10 })
  return { dealsExpired, packagesSynced: [...packagesToSync] }
}

