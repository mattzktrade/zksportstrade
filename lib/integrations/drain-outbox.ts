import { createAdminClient } from "@/lib/supabase/admin"
import { processIntegrationOutbox, type ProcessOutboxResult } from "@/lib/integrations/process-outbox"
import { pullInventoryFromSalesforce } from "@/lib/integrations/salesforce/pull-inventory-from-salesforce"

/** Serializes drains so parallel `after()` callbacks cannot process the same outbox row twice. */
let drainMutex: Promise<void> = Promise.resolve()

export type DrainOutboxOptions = {
  /** Max processing rounds (each round handles up to 20 jobs). Default 12. */
  maxRounds?: number
  /** Skip the pre-drain Salesforce inventory pull when caller already did it. */
  skipInventoryPull?: boolean
  /** Stop early once this order has no pending outbox jobs. */
  orderId?: string
  /** Stop early once this package has no pending outbox jobs. */
  packageId?: string
}

async function hasPendingOutboxForOrder(orderId: string): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false
  const { data, error } = await admin
    .from("integration_outbox")
    .select("id")
    .in("status", ["pending", "processing"])
    .filter("payload->>order_id", "eq", orderId)
    .limit(1)
  if (error) {
    console.warn("[integrations] outbox order check failed:", error.message)
    return false
  }
  return (data?.length ?? 0) > 0
}

async function hasPendingOutboxForPackage(packageId: string): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false
  const { data, error } = await admin
    .from("integration_outbox")
    .select("id")
    .in("status", ["pending", "processing"])
    .filter("payload->>package_id", "eq", packageId)
    .limit(1)
  if (error) {
    console.warn("[integrations] outbox package check failed:", error.message)
    return false
  }
  return (data?.length ?? 0) > 0
}

/**
 * Process the integration outbox until idle or the targeted order/package jobs are done.
 * Used after enqueue so admins don't need to click "Process sync queue now".
 */
async function drainIntegrationOutboxInner(
  options: DrainOutboxOptions = {},
): Promise<ProcessOutboxResult> {
  if (!options.skipInventoryPull) {
    try {
      await pullInventoryFromSalesforce()
    } catch (e) {
      console.warn(
        "[integrations] Salesforce inventory pull before outbox drain failed:",
        e instanceof Error ? e.message : e,
      )
    }
  }

  const maxRounds = options.maxRounds ?? 12
  let last: ProcessOutboxResult = {
    processed: 0,
    completed: 0,
    failed: 0,
    orphaned: 0,
    skipped: false,
  }

  for (let round = 0; round < maxRounds; round++) {
    last = await processIntegrationOutbox()
    if (last.skipped) return last
    if (last.processed === 0) break

    if (options.orderId && !(await hasPendingOutboxForOrder(options.orderId))) break
    if (options.packageId && !(await hasPendingOutboxForPackage(options.packageId))) break
  }

  return last
}

export async function drainIntegrationOutbox(
  options: DrainOutboxOptions = {},
): Promise<ProcessOutboxResult> {
  const prev = drainMutex
  let release!: () => void
  drainMutex = new Promise<void>((resolve) => {
    release = resolve
  })
  await prev
  try {
    return await drainIntegrationOutboxInner(options)
  } finally {
    release()
  }
}
