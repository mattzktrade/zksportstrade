import { getSalesforceConfig, isSalesforceConfigured } from "@/lib/integrations/salesforce/config"
import { salesforceQuery } from "@/lib/integrations/salesforce/client"
import {
  isUninitializedSfInventorySnapshot,
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
import { syncStaleLinkedGroupsFromSalesforce } from "@/lib/inventory/linked-group-inventory"
import { syncPackageCatalogToWix } from "@/lib/integrations/wix/catalog-sync"
import { importMissingStockSourcesFromSalesforce } from "@/lib/integrations/salesforce/stock-sources"
import { readOpenPipelineQuantityByProductBulk } from "@/lib/integrations/salesforce/sold-metrics"
import { createAdminClient } from "@/lib/supabase/admin"

const LAST_PULL_KEY = "salesforce_inventory_pull_last_run"
const API_LIMIT_COOLDOWN_KEY = "salesforce_api_limit_cooldown_until"
/** Full Available/linked-heal/stock-import cadence. Closed Won always runs every cron tick;
 * when new offline rows apply we still heal those groups even while this throttle is active. */
const PULL_THROTTLE_MS = 5 * 60 * 1000
/** After TotalRequests, skip heavy SF work until this cooldown elapses. */
const API_LIMIT_COOLDOWN_MS = 30 * 60 * 1000

async function readApiLimitCooldownActive(): Promise<boolean> {
  const until = await getIntegrationSetting(API_LIMIT_COOLDOWN_KEY)
  if (!until) return false
  const t = new Date(until).getTime()
  return Number.isFinite(t) && t > Date.now()
}

async function markApiLimitCooldown(): Promise<void> {
  await setIntegrationSetting(
    API_LIMIT_COOLDOWN_KEY,
    new Date(Date.now() + API_LIMIT_COOLDOWN_MS).toISOString(),
  )
}

function errorsIncludeApiLimit(errors: readonly string[]): boolean {
  return errors.some((e) => /TotalRequests|REQUEST_LIMIT_EXCEEDED|api.?limit/i.test(e))
}

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
  /** Re-sync all linked groups from SF after pull (repairs drift / cron races). */
  linkedGroupHeal: { groups: number; packagesFixed: number } | null
  /** Ledger-only import of SF Stock Sources into portal cost layers (no qty bump). */
  stockSourcesImported: { packagesChecked: number; imported: number; claimed: number } | null
  errors: string[]
}

/**
 * After offline opportunity activity (Closed Won ledger and/or any recent opp on a
 * Product2), heal affected linked groups / standalone packages so portal sellable
 * reflects Closed Won + open pipeline − Closed Lost, while Salesforce Quantity Sold
 * stays closed-won only.
 */
async function applyOpportunityInventoryFollowUp(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  config: NonNullable<ReturnType<typeof getSalesforceConfig>>,
  packageIds: readonly string[],
  options?: { forcePackageIds?: ReadonlySet<string> },
): Promise<{ groups: number; packagesFixed: number; errors: string[] }> {
  const ids = [...new Set(packageIds.map((id) => id.trim()).filter(Boolean))]
  const out = { groups: 0, packagesFixed: 0, errors: [] as string[] }
  if (ids.length === 0) return out

  const forceIds = options?.forcePackageIds ?? new Set<string>()

  const { data: rows, error } = await admin
    .from("packages")
    .select("id, inventory_group_id, salesforce_product_id, shell_parent_package_id")
    .in("id", ids)
  if (error) {
    out.errors.push(error.message)
    return out
  }

  const { healLinkedGroupIfStale, syncLinkedGroupInventoryFromSalesforce } = await import(
    "@/lib/inventory/linked-group-inventory"
  )
  const { syncStockSourcesForProduct } = await import(
    "@/lib/integrations/salesforce/stock-sources"
  )
  const { syncPackageCatalogToWix } = await import("@/lib/integrations/wix/catalog-sync")

  const healedGroups = new Set<string>()
  for (const raw of rows ?? []) {
    const packageId = typeof raw.id === "string" ? raw.id.trim() : ""
    if (!packageId) continue
    const groupId =
      typeof raw.inventory_group_id === "string" ? raw.inventory_group_id.trim() : ""
    const product2Id =
      typeof raw.salesforce_product_id === "string" ? raw.salesforce_product_id.trim() : ""
    const isShell = Boolean(
      typeof raw.shell_parent_package_id === "string" && raw.shell_parent_package_id.trim(),
    )

    try {
      if (groupId) {
        if (healedGroups.has(groupId)) continue
        healedGroups.add(groupId)
        const forceGroup = [...(rows ?? [])].some((r) => {
          const gid =
            typeof r.inventory_group_id === "string" ? r.inventory_group_id.trim() : ""
          const pid = typeof r.id === "string" ? r.id.trim() : ""
          return gid === groupId && forceIds.has(pid)
        })
        const healed = await healLinkedGroupIfStale(admin, groupId, config)
        if (healed) {
          out.groups += 1
          out.packagesFixed += 1
        } else if (forceGroup) {
          await syncLinkedGroupInventoryFromSalesforce(admin, groupId, config)
          out.groups += 1
          out.packagesFixed += 1
        }
      } else if (product2Id && !isShell) {
        const ss = await syncStockSourcesForProduct({ admin, packageId, product2Id })
        if (ss.errors.length > 0) {
          out.errors.push(...ss.errors.slice(0, 3))
        }
        out.packagesFixed += 1
        const wix = await syncPackageCatalogToWix(packageId)
        if (!wix.ok) {
          out.errors.push(`Wix sync ${packageId}: ${[...wix.errors, ...wix.skipped].join("; ")}`)
        }
      }
    } catch (e) {
      out.errors.push(
        `${packageId}: ${e instanceof Error ? e.message : "Opportunity inventory follow-up failed."}`,
      )
    }
  }

  return out
}

type PackagePullRow = {
  id: string
  salesforce_product_id: string
  product_code: string | null
  integration_sync_status: string | null
  inventory_group_id: string | null
  shell_parent_package_id: string | null
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

function isStandalonePullPackage(pkg: PackagePullRow): boolean {
  return !pkg.inventory_group_id?.trim() && !pkg.shell_parent_package_id?.trim()
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
      inventory_group_id,
      shell_parent_package_id,
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
  const linkedGroupIds = new Set<string>()
  for (const raw of rows ?? []) {
    const id = typeof raw.id === "string" ? raw.id.trim() : ""
    const product2Id =
      typeof raw.salesforce_product_id === "string" ? raw.salesforce_product_id.trim() : ""
    if (!id || !product2Id) continue

    const inv = Array.isArray(raw.package_inventory)
      ? raw.package_inventory[0]
      : raw.package_inventory
    const inventoryGroupId =
      typeof raw.inventory_group_id === "string" ? raw.inventory_group_id.trim() : ""
    const shellParentId =
      typeof raw.shell_parent_package_id === "string" ? raw.shell_parent_package_id.trim() : ""

    if (inventoryGroupId) linkedGroupIds.add(inventoryGroupId)

    packages.push({
      id,
      salesforce_product_id: product2Id,
      product_code: typeof raw.product_code === "string" ? raw.product_code.trim() : null,
      integration_sync_status:
        typeof raw.integration_sync_status === "string" ? raw.integration_sync_status : null,
      inventory_group_id: inventoryGroupId || null,
      shell_parent_package_id: shellParentId || null,
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

  const adjustments: SalesforceInventoryPullAdjustment[] = []
  const errors: string[] = []
  let skippedPackages = 0
  let checked = 0

  // Linked groups are synced in one heal pass at the end of pullInventoryFromSalesforce.
  // Syncing each group here (~57 sequential SF reads) left a long window where cron could
  // corrupt Hungary etc., and the final state depended on loop order.
  for (const groupId of linkedGroupIds) {
    const members = packages.filter((p) => p.inventory_group_id === groupId && !p.shell_parent_package_id)
    checked += members.length
    skippedPackages += members.length
  }

  // Standalone packages only (not linked group members, not shells).
  const standalonePackages = packages.filter(isStandalonePullPackage)

  const byProduct2Id = new Map<string, PackagePullRow>()
  for (const pkg of standalonePackages) {
    const existing = byProduct2Id.get(pkg.salesforce_product_id)
    if (!existing || (!existing.product_code && pkg.product_code)) {
      byProduct2Id.set(pkg.salesforce_product_id, pkg)
    }
  }
  const uniqueStandalone = [...byProduct2Id.values()]
  checked += uniqueStandalone.length

  const standaloneWithLedger = new Set<string>()
  if (uniqueStandalone.length > 0) {
    const { data: standaloneLayers } = await admin
      .from("package_cost_layers")
      .select("package_id")
      .in(
        "package_id",
        uniqueStandalone.map((pkg) => pkg.id),
      )
    for (const row of standaloneLayers ?? []) standaloneWithLedger.add(String(row.package_id))
  }

  if (uniqueStandalone.length > 0) {
    let snapshots: Map<string, SfInventorySnapshot>
    let closedWonQtyByProduct: Map<string, number>
    let openPipelineByProduct: Map<string, number>
    try {
      const productIds = uniqueStandalone.map((p) => p.salesforce_product_id)
      snapshots = await readSfInventorySnapshotsBulk(productIds, config)
      ;[closedWonQtyByProduct, openPipelineByProduct] = await Promise.all([
        readClosedWonQuantityByProduct(productIds, config.opportunityStageWon),
        readOpenPipelineQuantityByProductBulk(
          productIds,
          config.opportunityStageLost,
          config.opportunityStageWon,
        ),
      ])
    } catch (e) {
      const message = e instanceof Error ? e.message : "Salesforce inventory query failed."
      errors.push(message)
      snapshots = new Map()
      closedWonQtyByProduct = new Map()
      openPipelineByProduct = new Map()
    }

    for (const pkg of uniqueStandalone) {
      if (standaloneWithLedger.has(pkg.id)) {
        skippedPackages++
        continue
      }
      const currentSellable = portalSellable(pkg.qty_available, pkg.qty_held)
      if (pkg.integration_sync_status === "pending" || pkg.integration_sync_status === "failed") {
        // After relink the package is queued for sync — still pull SF stock when portal is empty.
        if (currentSellable > 0) {
          skippedPackages++
          continue
        }
      }

      const snapshot = snapshots.get(pkg.salesforce_product_id)
      if (!snapshot) {
        skippedPackages++
        continue
      }

      const closedWonQty = closedWonQtyByProduct.get(pkg.salesforce_product_id) ?? 0
      const openQty = openPipelineByProduct.get(pkg.salesforce_product_id) ?? 0
      const sfLineSellable =
        snapshot.stock != null && (closedWonQty > 0 || openQty > 0)
          ? Math.max(0, Math.floor(snapshot.stock) - closedWonQty - openQty)
          : null

      const sfSellable = salesforceTargetSellable(snapshot)

      // Prefer commitment sellable when Product2 Available/Sold look corrupt
      // (Available=0 while closed-won implies remaining stock) or when it is
      // lower than the portal (offline sales / pipeline not yet reflected).
      const product2LooksCorrupt =
        snapshot.available != null &&
        Math.floor(snapshot.available) === 0 &&
        snapshot.stock != null &&
        snapshot.stock > 0 &&
        sfLineSellable != null &&
        sfLineSellable > 0

      const targetSellable =
        sfLineSellable != null &&
        (product2LooksCorrupt ||
          sfLineSellable < currentSellable ||
          (currentSellable === 0 && (sfSellable == null || sfSellable === 0) && sfLineSellable > 0))
          ? sfLineSellable
          : sfSellable != null && openQty > 0 && snapshot.stock != null
            ? Math.min(sfSellable, Math.max(0, Math.floor(snapshot.stock) - closedWonQty - openQty))
            : sfSellable

      if (targetSellable == null) {
        skippedPackages++
        continue
      }
      if (targetSellable === currentSellable) {
        skippedPackages++
        continue
      }

      const { error: invErr } = await admin
        .from("package_inventory")
        .update({ qty_available: targetSellable + Math.max(0, Math.floor(pkg.qty_held)) })
        .eq("package_id", pkg.id)
      if (invErr) {
        errors.push(`${pkg.id}: ${invErr.message}`)
        continue
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
        delta: targetSellable - currentSellable,
      })
    }
  }

  // Shells are synced via their parent — count as skipped for metrics.
  skippedPackages += packages.filter((p) => p.shell_parent_package_id?.trim()).length

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
    checked,
    adjusted: adjustments.length,
    skippedPackages,
    adjustments,
    channelSyncQueued,
    errors,
  }
}

/**
 * Reconcile portal inventory with Salesforce:
 * 1) Closed Won opportunities — audit/idempotency only (no portal decrement)
 * 2) Linked groups — syncLinkedGroupInventoryFromSalesforce per group (same as admin repair)
 * 3) Standalone packages — per-Product2 Available pull
 */
export async function pullInventoryFromSalesforce(options?: {
  force?: boolean
  /**
   * Admin "Pull offline sales" mode: Closed Won + heal only packages that got new
   * offline rows. Skips org-wide Available pull / stale-group heal / stock-source import
   * so we do not burn TotalRequests when the daily limit is nearly exhausted.
   */
  offlineSalesOnly?: boolean
}): Promise<SalesforceInventoryPullResult> {
  const empty: SalesforceInventoryPullResult = {
    skipped: true,
    closedWon: null,
    checked: 0,
    adjusted: 0,
    skippedPackages: 0,
    adjustments: [],
    channelSyncQueued: 0,
    linkedGroupHeal: null,
    stockSourcesImported: null,
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
  const offlineSalesOnly = Boolean(options?.offlineSalesOnly)
  const force = Boolean(options?.force)
  const apiCooldownActive = !force && (await readApiLimitCooldownActive())

  try {
    // Closed Won is cheap (1–2 SOQL) and must keep running even during API-limit cooldown.
    closedWon = await pullClosedWonOpportunitySales(admin, config, {
      force: force || offlineSalesOnly,
    })
    errors.push(...closedWon.errors)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Closed Won opportunity pull failed."
    errors.push(message)
  }

  if (errorsIncludeApiLimit(errors)) {
    await markApiLimitCooldown()
  }

  // Closed Won ledger + any recently touched opportunity (open / won / lost) so pipeline
  // holds and releases update without waiting for a full Available scan.
  let linkedGroupHeal: SalesforceInventoryPullResult["linkedGroupHeal"] = null
  const followUpPackageIds = new Set<string>(closedWon?.affectedPackageIds ?? [])
  const forceFollowUpIds = new Set<string>(closedWon?.affectedPackageIds ?? [])

  // Drop offline ledger rows for deals that are no longer Closed Won (Closed Lost / cancelled).
  // Without this, heal + Stock Sources keep treating Lost units as sold forever.
  try {
    const {
      revokeStaleOfflineSaleApplications,
      readRecentlyModifiedOpportunityIds,
    } = await import("@/lib/integrations/salesforce/revoke-stale-offline-sales")
    const lookbackMs = offlineSalesOnly || force ? 7 * 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000
    let revokeOpts: { checkAllApplied?: boolean; opportunityIds?: string[] } = {
      checkAllApplied: offlineSalesOnly || force,
    }
    if (!revokeOpts.checkAllApplied) {
      const recentOpps = await readRecentlyModifiedOpportunityIds(lookbackMs, 100)
      errors.push(...recentOpps.errors)
      revokeOpts = { opportunityIds: recentOpps.opportunityIds }
    }
    const revoked = await revokeStaleOfflineSaleApplications(admin, config, revokeOpts)
    errors.push(...revoked.errors)
    for (const id of revoked.affectedPackageIds) {
      followUpPackageIds.add(id)
      forceFollowUpIds.add(id)
    }
  } catch (e) {
    errors.push(
      e instanceof Error ? e.message : "Failed to revoke stale offline Closed Won applications.",
    )
  }

  try {
    const { resolvePackagesTouchedByRecentOpportunities } = await import(
      "@/lib/integrations/salesforce/recent-opportunity-packages"
    )
    const recent = await resolvePackagesTouchedByRecentOpportunities(admin, config, {
      lookbackMs: offlineSalesOnly || force ? 7 * 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000,
      limit: offlineSalesOnly || force ? 100 : 50,
    })
    errors.push(...recent.errors)
    for (const id of recent.packageIds) followUpPackageIds.add(id)
  } catch (e) {
    errors.push(
      e instanceof Error ? e.message : "Recent opportunity package resolution failed.",
    )
  }

  if (followUpPackageIds.size > 0) {
    try {
      const applied = await applyOpportunityInventoryFollowUp(admin, config, [...followUpPackageIds], {
        forcePackageIds: forceFollowUpIds,
      })
      linkedGroupHeal = {
        groups: applied.groups,
        packagesFixed: applied.packagesFixed,
      }
      errors.push(...applied.errors)
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "Opportunity inventory follow-up failed.")
    }
  }

  if (errorsIncludeApiLimit(errors)) {
    await markApiLimitCooldown()
  }

  // Light admin path: Closed Won ledger + heal packages touched by any recent opportunity.
  if (offlineSalesOnly) {
    return {
      skipped: false,
      closedWon,
      checked: followUpPackageIds.size,
      adjusted: linkedGroupHeal?.packagesFixed ?? 0,
      skippedPackages: 0,
      adjustments: [],
      channelSyncQueued: 0,
      linkedGroupHeal,
      stockSourcesImported: null,
      errors,
    }
  }

  const throttled = await shouldThrottleAvailablePull(force)
  if (throttled || apiCooldownActive || (await readApiLimitCooldownActive())) {
    // Do NOT bump LAST_PULL_KEY here — that made every cron tick look "fresh" and skipped
    // Available/linked heal indefinitely while still recording Closed Won rows.
    return {
      skipped: false,
      throttled: true,
      closedWon,
      checked: 0,
      adjusted: 0,
      skippedPackages: 0,
      adjustments: [],
      channelSyncQueued: 0,
      linkedGroupHeal,
      stockSourcesImported: null,
      errors: apiCooldownActive
        ? [...errors, "Salesforce API limit cooldown — deferred Available/linked heal."]
        : errors,
    }
  }

  const available = await pullAvailableQuantityFromSalesforce(admin, config)
  errors.push(...available.errors)

  try {
    // syncStaleLinkedGroupsFromSalesforce already runs an internal drift-repair pass —
    // do not call repairAllDriftedLinkedGroupsFromSalesforce again (that doubled SF work).
    const stale = await syncStaleLinkedGroupsFromSalesforce(admin, config)
    linkedGroupHeal = {
      groups: (linkedGroupHeal?.groups ?? 0) + stale.groups,
      packagesFixed: (linkedGroupHeal?.packagesFixed ?? 0) + stale.packagesFixed,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Linked group inventory heal failed."
    errors.push(message)
  }

  let stockSourcesImported: SalesforceInventoryPullResult["stockSourcesImported"] = null
  try {
    // Only scan packages that still have no cost layers — keep this small so cron
    // does not burn TotalRequests importing ledgers for dozens of packages every tick.
    const imported = await importMissingStockSourcesFromSalesforce(admin, { limit: 8 })
    stockSourcesImported = {
      packagesChecked: imported.packagesChecked,
      imported: imported.imported,
      claimed: imported.claimed,
    }
    errors.push(...imported.errors)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Stock source import failed."
    errors.push(message)
  }

  if (errorsIncludeApiLimit(errors)) {
    await markApiLimitCooldown()
  }

  await setIntegrationSetting(LAST_PULL_KEY, new Date().toISOString())

  return {
    skipped: false,
    closedWon,
    checked: available.checked,
    adjusted: available.adjusted,
    skippedPackages: available.skippedPackages,
    adjustments: available.adjustments,
    channelSyncQueued: available.channelSyncQueued,
    linkedGroupHeal,
    stockSourcesImported,
    errors,
  }
}
