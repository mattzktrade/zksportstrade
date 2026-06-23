import { packageIdsForInventoryChannelSync } from "@/lib/integrations/inventory-sync-packages"
import { enqueuePackageInventoryChannelSyncServer } from "@/lib/integrations/enqueue-server"
import { scheduleOutboxDrain } from "@/lib/integrations/schedule-drain"
import { createAdminClient } from "@/lib/supabase/admin"

export type ReleaseExpiredHoldsResult = {
  released: number
  packagesSynced: string[]
}

/**
 * Release holds past expires_at, then queue Salesforce + Wix inventory sync for affected packages.
 * Intended for Vercel cron (also runs at the start of /api/cron/integration-outbox).
 */
export async function releaseExpiredInventoryHoldsAndSync(): Promise<ReleaseExpiredHoldsResult> {
  const admin = createAdminClient()
  if (!admin) {
    return { released: 0, packagesSynced: [] }
  }

  const now = new Date().toISOString()
  const { data: expiredHolds, error: listErr } = await admin
    .from("inventory_holds")
    .select("package_id")
    .is("released_at", null)
    .lte("expires_at", now)

  if (listErr) {
    console.error("[holds] list expired holds failed:", listErr.message)
    throw new Error(listErr.message)
  }

  const affectedPackages = new Set<string>()
  for (const row of expiredHolds ?? []) {
    const packageId = typeof row.package_id === "string" ? row.package_id.trim() : ""
    if (packageId) affectedPackages.add(packageId)
  }

  const { data: releasedCount, error: releaseErr } = await admin.rpc("release_expired_inventory_holds")
  if (releaseErr) {
    console.error("[holds] release_expired_inventory_holds failed:", releaseErr.message)
    throw new Error(releaseErr.message)
  }

  const released = Number(releasedCount ?? 0)
  if (released === 0 || affectedPackages.size === 0) {
    return { released, packagesSynced: [] }
  }

  const packagesToSync = new Set<string>()
  for (const packageId of affectedPackages) {
    const ids = await packageIdsForInventoryChannelSync(admin, packageId)
    for (const id of ids) packagesToSync.add(id)
  }

  for (const packageId of packagesToSync) {
    const enq = await enqueuePackageInventoryChannelSyncServer(packageId, {
      trigger: "hold_expired",
      scheduleDrain: false,
    })
    if (!enq.ok) {
      console.warn(`[holds] inventory sync not queued for ${packageId}:`, enq.message)
    }
  }

  scheduleOutboxDrain({ maxRounds: 10 })

  return { released, packagesSynced: [...packagesToSync] }
}
