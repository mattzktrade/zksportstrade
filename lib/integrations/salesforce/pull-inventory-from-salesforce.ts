import { getSalesforceConfig, isSalesforceConfigured } from "@/lib/integrations/salesforce/config"
import {
  readSfInventorySnapshotsBulk,
  salesforceTargetSellable,
  type SfInventorySnapshot,
} from "@/lib/integrations/salesforce/inventory-snapshot"
import {
  pullClosedWonOpportunitySales,
  type PullClosedWonOpportunitySalesResult,
} from "@/lib/integrations/salesforce/pull-closed-won-opportunities"
import {
  getIntegrationSetting,
  getSalesforceConnectionStatus,
  getStoredInstanceUrl,
  setIntegrationSetting,
} from "@/lib/integrations/salesforce/settings-store"
import { syncPackageCatalogToWix } from "@/lib/integrations/wix/catalog-sync"
import { createAdminClient } from "@/lib/supabase/admin"

const LAST_PULL_KEY = "salesforce_inventory_pull_last_run"
const PULL_THROTTLE_MS = 60_000

export type SalesforceInventoryPullAdjustment = {
  packageId: string
  product2Id: string
  portalSellableBefore: number
  salesforceSellable: number
  delta: number
}

export type SalesforceInventoryPullResult = {
  skipped: boolean
  message?: string
  throttled?: boolean
  closedWon: PullClosedWonOpportunitySalesResult | null
  checked: number
  adjusted: number
  skippedPackages: number
  adjustments: SalesforceInventoryPullAdjustment[]
  channelSyncQueued: number
  errors: string[]
}

type PackagePullRow = {
  id: string
  salesforce_product_id: string
  integration_sync_status: string | null
  duration: string | null
  inventory_group_id: string | null
  total_capacity: number
  qty_available: number
  qty_held: number
}

function portalSellable(qtyAvailable: number, qtyHeld: number): number {
  return Math.max(0, Math.floor(qtyAvailable) - Math.floor(qtyHeld))
}

async function shouldThrottleAvailablePull(force: boolean): Promise<boolean> {
  if (force) return false
  const last = await getIntegrationSetting(LAST_PULL_KEY)
  if (!last) return false
  const elapsed = Date.now() - new Date(last).getTime()
  return elapsed >= 0 && elapsed < PULL_THROTTLE_MS
}

async function pullAvailableQuantityFromSalesforce(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  config: NonNullable<ReturnType<typeof getSalesforceConfig>>,
): Promise<Pick<
  SalesforceInventoryPullResult,
  "checked" | "adjusted" | "skippedPackages" | "adjustments" | "channelSyncQueued" | "errors"
>> {
  const { data: rows, error } = await admin
    .from("packages")
    .select(
      `
      id,
      salesforce_product_id,
      integration_sync_status,
      duration,
      inventory_group_id,
      total_capacity,
      package_inventory ( qty_available, qty_held )
    `,
    )
    .not("salesforce_product_id", "is", null)

  if (error) {
    return {
      checked: 0,
      adjusted: 0,
      skippedPackages: 0,
      adjustments: [],
      channelSyncQueued: 0,
      errors: [error.message],
    }
  }

  const packages: PackagePullRow[] = []
  for (const raw of rows ?? []) {
    const id = typeof raw.id === "string" ? raw.id.trim() : ""
    const product2Id =
      typeof raw.salesforce_product_id === "string" ? raw.salesforce_product_id.trim() : ""
    if (!id || !product2Id) continue

    const inv = Array.isArray(raw.package_inventory)
      ? raw.package_inventory[0]
      : raw.package_inventory
    packages.push({
      id,
      salesforce_product_id: product2Id,
      integration_sync_status:
        typeof raw.integration_sync_status === "string" ? raw.integration_sync_status : null,
      duration: typeof raw.duration === "string" ? raw.duration : null,
      inventory_group_id:
        typeof raw.inventory_group_id === "string" ? raw.inventory_group_id : null,
      total_capacity: Math.max(0, Math.floor(Number(raw.total_capacity) || 0)),
      qty_available: Number(inv?.qty_available) || 0,
      qty_held: Number(inv?.qty_held) || 0,
    })
  }

  if (packages.length === 0) {
    return {
      checked: 0,
      adjusted: 0,
      skippedPackages: 0,
      adjustments: [],
      channelSyncQueued: 0,
      errors: [],
    }
  }

  let snapshots: Map<string, SfInventorySnapshot>
  try {
    snapshots = await readSfInventorySnapshotsBulk(
      packages.map((p) => p.salesforce_product_id),
      config,
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : "Salesforce inventory query failed."
    return {
      checked: packages.length,
      adjusted: 0,
      skippedPackages: 0,
      adjustments: [],
      channelSyncQueued: 0,
      errors: [message],
    }
  }

  const adjustments: SalesforceInventoryPullAdjustment[] = []
  const errors: string[] = []
  let skippedPackages = 0

  for (const pkg of packages) {
    if (pkg.integration_sync_status === "pending" || pkg.integration_sync_status === "failed") {
      skippedPackages++
      continue
    }

    const snapshot = snapshots.get(pkg.salesforce_product_id)
    if (!snapshot) {
      skippedPackages++
      continue
    }

    const sfSellable = salesforceTargetSellable(snapshot)
    if (sfSellable == null) {
      skippedPackages++
      continue
    }

    const currentSellable = portalSellable(pkg.qty_available, pkg.qty_held)
    const sfStockTotal = snapshot.stock == null ? null : Math.max(0, Math.floor(snapshot.stock))
    const totalChanged = sfStockTotal != null && sfStockTotal !== pkg.total_capacity
    const sellableChanged = sfSellable !== currentSellable
    const delta = sfSellable - currentSellable

    if (!totalChanged && !sellableChanged) {
      skippedPackages++
      continue
    }

    if (sellableChanged) {
      const { error: invErr } = await admin
        .from("package_inventory")
        .update({ qty_available: sfSellable + Math.max(0, Math.floor(pkg.qty_held)) })
        .eq("package_id", pkg.id)
      if (invErr) {
        errors.push(`${pkg.id}: ${invErr.message}`)
        continue
      }
    }

    if (totalChanged) {
      const { error: pkgErr } = await admin
        .from("packages")
        .update({
          total_capacity: sfStockTotal,
          integration_sync_status: "synced",
          integration_sync_error: null,
        })
        .eq("id", pkg.id)
      if (pkgErr) {
        errors.push(`${pkg.id}: ${pkgErr.message}`)
        continue
      }
    } else if (sellableChanged) {
      await admin
        .from("packages")
        .update({ integration_sync_status: "synced", integration_sync_error: null })
        .eq("id", pkg.id)
    }

    adjustments.push({
      packageId: pkg.id,
      product2Id: pkg.salesforce_product_id,
      portalSellableBefore: currentSellable,
      salesforceSellable: sfSellable,
      delta,
    })
  }

  let channelSyncQueued = 0
  for (const adj of adjustments) {
    const wix = await syncPackageCatalogToWix(adj.packageId)
    if (wix.ok) {
      channelSyncQueued++
    } else {
      errors.push(`Wix sync ${adj.packageId}: ${[...wix.errors, ...wix.skipped].join("; ")}`)
    }
  }

  return {
    checked: packages.length,
    adjusted: adjustments.length,
    skippedPackages,
    adjustments,
    channelSyncQueued,
    errors,
  }
}

/**
 * Reconcile portal inventory with offline Salesforce sales:
 * 1) Closed Won opportunities (manual SF deals) — applies line-item quantities with idempotency
 * 2) Available Quantity snapshot pull (decrease-only safety net for all mapped products)
 */
export async function pullInventoryFromSalesforce(options?: {
  force?: boolean
}): Promise<SalesforceInventoryPullResult> {
  const empty: SalesforceInventoryPullResult = {
    skipped: true,
    closedWon: null,
    checked: 0,
    adjusted: 0,
    skippedPackages: 0,
    adjustments: [],
    channelSyncQueued: 0,
    errors: [],
  }

  if (!isSalesforceConfigured()) {
    return { ...empty, message: "Salesforce env vars not set." }
  }

  const connection = await getSalesforceConnectionStatus()
  if (!connection.connected) {
    return { ...empty, message: "Salesforce not connected." }
  }

  const admin = createAdminClient()
  if (!admin) {
    return { ...empty, message: "Service role not configured." }
  }

  const instanceUrl =
    (await getStoredInstanceUrl()) ?? process.env.SALESFORCE_INSTANCE_URL?.trim() ?? ""
  const config = getSalesforceConfig(instanceUrl || undefined)
  if (!config) {
    return { ...empty, message: "Salesforce config missing instance URL." }
  }

  const errors: string[] = []
  let closedWon: PullClosedWonOpportunitySalesResult | null = null

  try {
    closedWon = await pullClosedWonOpportunitySales(admin, config, {
      force: Boolean(options?.force),
    })
    errors.push(...closedWon.errors)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Closed Won opportunity pull failed."
    errors.push(message)
  }

  const throttled = await shouldThrottleAvailablePull(Boolean(options?.force))
  if (throttled) {
    await setIntegrationSetting(LAST_PULL_KEY, new Date().toISOString())
    return {
      skipped: false,
      throttled: true,
      closedWon,
      checked: 0,
      adjusted: 0,
      skippedPackages: 0,
      adjustments: [],
      channelSyncQueued: 0,
      errors,
    }
  }

  const available = await pullAvailableQuantityFromSalesforce(admin, config)
  errors.push(...available.errors)

  await setIntegrationSetting(LAST_PULL_KEY, new Date().toISOString())

  return {
    skipped: false,
    closedWon,
    checked: available.checked,
    adjusted: available.adjusted,
    skippedPackages: available.skippedPackages,
    adjustments: available.adjustments,
    channelSyncQueued: available.channelSyncQueued,
    errors,
  }
}
