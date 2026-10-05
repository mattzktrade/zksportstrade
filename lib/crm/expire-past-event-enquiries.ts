import { createAdminClient } from "@/lib/supabase/admin"
import { enqueuePackageInventoryChannelSyncServer } from "@/lib/integrations/enqueue-server"
import { scheduleOutboxDrain } from "@/lib/integrations/schedule-drain"

export type ExpirePastEventEnquiriesResult = {
  deals: number
  packagesSynced: string[]
}

export async function syncReleasedEnquiryPackages(packageIds: string[]): Promise<string[]> {
  const unique = [...new Set(packageIds.map((id) => id.trim()).filter(Boolean))]
  if (unique.length === 0) return []
  const packagesSynced: string[] = []
  for (const packageId of unique) {
    const queued = await enqueuePackageInventoryChannelSyncServer(packageId, {
      trigger: "enquiry_expired",
      scheduleDrain: false,
    })
    if (queued.ok) packagesSynced.push(packageId)
    else console.warn(`[enquiry-expiry] inventory sync not queued for ${packageId}:`, queued.message)
  }
  scheduleOutboxDrain({ maxRounds: 10 })
  return packagesSynced
}

/**
 * Moves enquiries to Expired when every event on them has taken place.
 * Safe to call often: enquiries that still have a future event are left alone.
 */
export async function expirePastEventEnquiries(): Promise<ExpirePastEventEnquiriesResult> {
  const admin = createAdminClient()
  if (!admin) return { deals: 0, packagesSynced: [] }

  const { data, error } = await admin.rpc("expire_past_event_enquiries")
  if (error) {
    console.error("[enquiry-expiry]", error.message)
    return { deals: 0, packagesSynced: [] }
  }

  const payload = (data ?? {}) as { deals?: number; packages?: string[] }
  const deals = Number(payload.deals ?? 0)
  const safeDeals = Number.isFinite(deals) ? deals : 0
  if (safeDeals === 0) return { deals: 0, packagesSynced: [] }
  const packagesSynced = await syncReleasedEnquiryPackages((payload.packages ?? []).map((id) => String(id)))
  return { deals: safeDeals, packagesSynced }
}
