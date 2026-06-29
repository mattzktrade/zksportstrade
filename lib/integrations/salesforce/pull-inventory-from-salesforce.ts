import { getSalesforceConfig, isSalesforceConfigured } from "@/lib/integrations/salesforce/config"
import { salesforceQuery } from "@/lib/integrations/salesforce/client"
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
  product_code: string | null
  integration_sync_status: string | null
  duration: string | null
  inventory_group_id: string | null
  qty_available: number
  qty_held: number
}

function portalSellable(qtyAvailable: number, qtyHeld: number): number {
  return Math.max(0, Math.floor(qtyAvailable) - Math.floor(qtyHeld))
}

async function readClosedWonQuantityByProduct(
  product2Ids: string[],
  wonStageName: string,
): Promise<Map<string, number>> {
  const uniqueIds = [...new Set(product2Ids.map((id) => id.trim()).filter(Boolean))]
  const result = new Map<string, number>()
  if (uniqueIds.length === 0) return result

  const won = wonStageName.trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'")
  for (let i = 0; i < uniqueIds.length; i += 200) {
    const batch = uniqueIds.slice(i, i + 200)
    const inList = batch.map((id) => `'${id.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`).join(",")
    const rows = await salesforceQuery<{ Product2Id: string; totalQty: number | null }>(
      `SELECT Product2Id, SUM(Quantity) totalQty FROM OpportunityLineItem WHERE Product2Id IN (${inList}) AND (Opportunity.IsWon = true OR Opportunity.StageName = '${won}') GROUP BY Product2Id`,
    )
    for (const row of rows) {
      const product2Id = typeof row.Product2Id === "string" ? row.Product2Id.trim() : ""
      const qty = Math.max(0, Math.floor(Number(row.totalQty) || 0))
      if (product2Id && qty > 0) result.set(product2Id, qty)
    }
  }
  return result
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
      product_code,
      integration_sync_status,
      duration,
      inventory_group_id,
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
      product_code: typeof raw.product_code === "string" ? raw.product_code.trim() : null,
      integration_sync_status:
        typeof raw.integration_sync_status === "string" ? raw.integration_sync_status : null,
      duration: typeof raw.duration === "string" ? raw.duration : null,
      inventory_group_id:
        typeof raw.inventory_group_id === "string" ? raw.inventory_group_id : null,
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

  const byProduct2Id = new Map<string, PackagePullRow>()
  for (const pkg of packages) {
    const existing = byProduct2Id.get(pkg.salesforce_product_id)
    if (!existing || (!existing.product_code && pkg.product_code)) {
      byProduct2Id.set(pkg.salesforce_product_id, pkg)
    }
  }
  const uniquePackages = [...byProduct2Id.values()]

  let snapshots: Map<string, SfInventorySnapshot>
  let closedWonQtyByProduct: Map<string, number>
  try {
    snapshots = await readSfInventorySnapshotsBulk(
      uniquePackages.map((p) => p.salesforce_product_id),
      config,
    )
    closedWonQtyByProduct = await readClosedWonQuantityByProduct(
      uniquePackages.map((p) => p.salesforce_product_id),
      config.opportunityStageWon,
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : "Salesforce inventory query failed."
    return {
      checked: uniquePackages.length,
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

  for (const pkg of uniquePackages) {
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
    const closedWonQty = closedWonQtyByProduct.get(pkg.salesforce_product_id) ?? 0
    const sfLineSellable =
      snapshot.stock != null && closedWonQty > 0
        ? Math.max(0, Math.floor(snapshot.stock) - closedWonQty)
        : null

    const currentSellable = portalSellable(pkg.qty_available, pkg.qty_held)
    const targetSellable =
      sfLineSellable != null &&
      (sfLineSellable < currentSellable || (currentSellable === 0 && sfSellable === 0 && sfLineSellable > 0))
        ? sfLineSellable
        : sfSellable
    if (targetSellable == null) {
      skippedPackages++
      continue
    }
    const sellableChanged = targetSellable !== currentSellable
    const delta = targetSellable - currentSellable

    if (!sellableChanged) {
      skippedPackages++
      continue
    }

    if (sellableChanged) {
      const { error: invErr } = await admin
        .from("package_inventory")
        .update({ qty_available: targetSellable + Math.max(0, Math.floor(pkg.qty_held)) })
        .eq("package_id", pkg.id)
      if (invErr) {
        errors.push(`${pkg.id}: ${invErr.message}`)
        continue
      }
    }

    await admin
      .from("packages")
      .update({ integration_sync_status: "synced", integration_sync_error: null })
      .eq("id", pkg.id)

    adjustments.push({
      packageId: pkg.id,
      product2Id: pkg.salesforce_product_id,
      portalSellableBefore: currentSellable,
      salesforceSellable: targetSellable,
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
    checked: uniquePackages.length,
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
