import { salesforceQuery } from "@/lib/integrations/salesforce/client"
import type { SalesforceConfig } from "@/lib/integrations/salesforce/config"
import {
  readSfInventorySnapshotsBulk,
  salesforceTargetSellable,
} from "@/lib/integrations/salesforce/inventory-snapshot"
import { getIntegrationSetting, setIntegrationSetting } from "@/lib/integrations/salesforce/settings-store"
import { findProduct2IdByCode } from "@/lib/integrations/salesforce/products"
import type { SupabaseClient } from "@supabase/supabase-js"

const CURSOR_KEY = "salesforce_closed_won_inventory_cursor"
const FORCE_LOOKBACK_MS = 730 * 24 * 60 * 60 * 1000
const FIRST_RUN_OVERLAP_MS = 5 * 60 * 1000

export type ClosedWonOpportunityAdjustment = {
  opportunityId: string
  opportunityName: string
  lineItemId: string
  packageId: string
  product2Id: string
  quantity: number
}

export type PullClosedWonOpportunitySalesResult = {
  opportunitiesScanned: number
  lineItemsApplied: number
  skippedPortalOrders: number
  skippedAlreadyApplied: number
  skippedUnmappedProduct: number
  adjustments: ClosedWonOpportunityAdjustment[]
  errors: string[]
}

type OpportunityRow = {
  Id: string
  Name: string
  LastModifiedDate: string
  OpportunityLineItems?: {
    records: Array<{
      Id: string
      Product2Id: string | null
      Quantity: number | string | null
    }>
  } | null
}

type PackageMappingRow = {
  id: string
  salesforce_product_id: string | null
  product_code?: string | null
  inventory_group_id?: string | null
  duration?: string | null
  package_inventory?: { qty_available: number | null; qty_held: number | null } | Array<{
    qty_available: number | null
    qty_held: number | null
  }> | null
}

type LinkedGroupPackageRow = {
  id: string
  duration: string | null
  inventory_group_id: string | null
  total_capacity?: number | null
  package_inventory?: { qty_available: number | null; qty_held: number | null } | Array<{
    qty_available: number | null
    qty_held: number | null
  }> | null
  package_cost_layers?: Array<{ quantity: number | null }> | null
}

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function soqlDateTime(d: Date): string {
  return d.toISOString()
}

function lineItemQuantity(raw: number | string | null | undefined): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

async function loadPortalOpportunityIds(admin: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await admin
    .from("orders")
    .select("salesforce_opportunity_id")
    .not("salesforce_opportunity_id", "is", null)

  if (error) throw new Error(error.message)

  const ids = new Set<string>()
  for (const row of data ?? []) {
    const id = typeof row.salesforce_opportunity_id === "string" ? row.salesforce_opportunity_id.trim() : ""
    if (id) ids.add(id)
  }
  return ids
}

async function loadAppliedLineItemKeys(admin: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await admin
    .from("salesforce_offline_sale_applications")
    .select("salesforce_opportunity_id, salesforce_line_item_id")

  if (error) {
    if (error.message.includes("does not exist") || error.code === "42P01") {
      return new Set()
    }
    throw new Error(error.message)
  }

  const keys = new Set<string>()
  for (const row of data ?? []) {
    const oppId =
      typeof row.salesforce_opportunity_id === "string" ? row.salesforce_opportunity_id.trim() : ""
    const lineId =
      typeof row.salesforce_line_item_id === "string" ? row.salesforce_line_item_id.trim() : ""
    if (oppId && lineId) keys.add(`${oppId}:${lineId}`)
  }
  return keys
}

function consumesDay(duration: string | null | undefined, day: "friday_only" | "saturday_only" | "sunday_only"): boolean {
  if (duration === "3_day") return true
  if (duration === "2_day") return day === "saturday_only" || day === "sunday_only"
  return duration === day
}

function inventoryRow(raw: LinkedGroupPackageRow["package_inventory"]) {
  return Array.isArray(raw) ? raw[0] : raw
}

async function reconcileLinkedInventoryFromRecordedSales(
  admin: SupabaseClient,
  seedPackageIds: Iterable<string>,
): Promise<{ reconciledPackages: string[]; errors: string[] }> {
  const seedIds = [...new Set([...seedPackageIds].map((id) => id.trim()).filter(Boolean))]
  if (seedIds.length === 0) return { reconciledPackages: [], errors: [] }

  const { data: seedRows, error: seedErr } = await admin
    .from("packages")
    .select("id, inventory_group_id")
    .in("id", seedIds)
  if (seedErr) return { reconciledPackages: [], errors: [seedErr.message] }

  const groupIds = [
    ...new Set(
      (seedRows ?? [])
        .map((row) => (typeof row.inventory_group_id === "string" ? row.inventory_group_id.trim() : ""))
        .filter(Boolean),
    ),
  ]
  const packageIds = new Set(seedIds)

  let groupRows: LinkedGroupPackageRow[] = []
  if (groupIds.length > 0) {
    const { data, error } = await admin
      .from("packages")
      .select("id, duration, inventory_group_id, total_capacity, package_inventory ( qty_available, qty_held ), package_cost_layers ( quantity )")
      .in("inventory_group_id", groupIds)
    if (error) return { reconciledPackages: [], errors: [error.message] }
    groupRows = (data ?? []) as LinkedGroupPackageRow[]
    for (const row of groupRows) packageIds.add(row.id)
  }

  const allIds = [...packageIds]
  const [ordersRes, sfRes] = await Promise.all([
    admin
      .from("orders")
      .select("package_id, guests, status")
      .in("package_id", allIds),
    admin
      .from("salesforce_offline_sale_applications")
      .select("package_id, quantity")
      .in("package_id", allIds),
  ])

  const errors: string[] = []
  if (ordersRes.error) errors.push(ordersRes.error.message)
  if (sfRes.error) errors.push(sfRes.error.message)
  if (errors.length > 0) return { reconciledPackages: [], errors }

  const soldByPackage = new Map<string, number>()
  for (const row of ordersRes.data ?? []) {
    if (row.status === "cancelled") continue
    const packageId = typeof row.package_id === "string" ? row.package_id.trim() : ""
    if (!packageId) continue
    const qty = Math.max(0, Math.floor(Number(row.guests) || 0))
    soldByPackage.set(packageId, (soldByPackage.get(packageId) ?? 0) + qty)
  }
  for (const row of sfRes.data ?? []) {
    const packageId = typeof row.package_id === "string" ? row.package_id.trim() : ""
    if (!packageId) continue
    const qty = Math.max(0, Math.floor(Number(row.quantity) || 0))
    soldByPackage.set(packageId, (soldByPackage.get(packageId) ?? 0) + qty)
  }

  const reconciledPackages: string[] = []
  const rowsByGroup = new Map<string, LinkedGroupPackageRow[]>()
  for (const row of groupRows) {
    const groupId = row.inventory_group_id?.trim()
    if (!groupId) continue
    const list = rowsByGroup.get(groupId) ?? []
    list.push(row)
    rowsByGroup.set(groupId, list)
  }

  for (const rows of rowsByGroup.values()) {
    const byDuration = new Map(rows.map((row) => [row.duration, row]))
    const dayAvailable = new Map<"friday_only" | "saturday_only" | "sunday_only", number>()

    for (const day of ["friday_only", "saturday_only", "sunday_only"] as const) {
      const row = byDuration.get(day)
      if (!row) continue
      const layerTotal = (row.package_cost_layers ?? []).reduce((sum, layer) => sum + (Number(layer.quantity) || 0), 0)
      const totalCapacity = Math.max(0, Math.floor(Number(row.total_capacity) || 0))
      const inv = inventoryRow(row.package_inventory)
      const fallbackBase = (Number(inv?.qty_available) || 0) + (soldByPackage.get(row.id) ?? 0)
      const base = totalCapacity > 0 ? totalCapacity : Math.max(layerTotal, fallbackBase)
      const consumed = rows.reduce(
        (sum, candidate) => sum + (consumesDay(candidate.duration, day) ? (soldByPackage.get(candidate.id) ?? 0) : 0),
        0,
      )
      dayAvailable.set(day, Math.max(0, Math.floor(base - consumed)))
    }

    for (const row of rows) {
      let nextAvailable: number | null = null
      if (row.duration === "friday_only" || row.duration === "saturday_only" || row.duration === "sunday_only") {
        nextAvailable = dayAvailable.get(row.duration) ?? null
      } else if (row.duration === "2_day") {
        const sat = dayAvailable.get("saturday_only")
        const sun = dayAvailable.get("sunday_only")
        nextAvailable = sat != null && sun != null ? Math.min(sat, sun) : null
      } else if (row.duration === "3_day") {
        const values = [
          dayAvailable.get("friday_only"),
          dayAvailable.get("saturday_only"),
          dayAvailable.get("sunday_only"),
        ].filter((n): n is number => n != null)
        nextAvailable = values.length > 0 ? Math.min(...values) : null
      }

      if (nextAvailable == null) continue
      const { error } = await admin
        .from("package_inventory")
        .update({ qty_available: nextAvailable })
        .eq("package_id", row.id)
      if (error) errors.push(`${row.id}: ${error.message}`)
      else reconciledPackages.push(row.id)
    }
  }

  if (reconciledPackages.length > 0) {
    const { error } = await admin
      .from("packages")
      .update({ integration_sync_status: "synced", integration_sync_error: null })
      .in("id", reconciledPackages)
      .eq("integration_sync_status", "pending")
    if (error) errors.push(`package sync status: ${error.message}`)
  }

  return { reconciledPackages, errors }
}

/**
 * Apply inventory for Closed Won Salesforce opportunities that were not created by the portal.
 * Portal orders already decrement inventory at checkout — those opportunities are skipped.
 */
export async function pullClosedWonOpportunitySales(
  admin: SupabaseClient,
  config: SalesforceConfig,
  options?: { force?: boolean },
): Promise<PullClosedWonOpportunitySalesResult> {
  const result: PullClosedWonOpportunitySalesResult = {
    opportunitiesScanned: 0,
    lineItemsApplied: 0,
    skippedPortalOrders: 0,
    skippedAlreadyApplied: 0,
    skippedUnmappedProduct: 0,
    adjustments: [],
    errors: [],
  }

  const cursorRaw = await getIntegrationSetting(CURSOR_KEY)
  let since: Date
  if (options?.force) {
    since = new Date(Date.now() - FORCE_LOOKBACK_MS)
  } else if (cursorRaw) {
    since = new Date(cursorRaw)
  } else {
    since = new Date(Date.now() - FIRST_RUN_OVERLAP_MS)
  }

  if (Number.isNaN(since.getTime())) {
    since = new Date(Date.now() - FIRST_RUN_OVERLAP_MS)
  }

  const portalOppIds = await loadPortalOpportunityIds(admin)
  const appliedKeys = await loadAppliedLineItemKeys(admin)

  const wonStage = config.opportunityStageWon.trim()
  const stageClause = wonStage
    ? `(IsWon = true OR StageName = '${escapeSoqlString(wonStage)}')`
    : `IsWon = true`

  const soql = `SELECT Id, Name, LastModifiedDate, (SELECT Id, Product2Id, Quantity FROM OpportunityLineItems WHERE Product2Id != null) FROM Opportunity WHERE ${stageClause} AND LastModifiedDate >= ${soqlDateTime(since)} ORDER BY LastModifiedDate ASC LIMIT 500`

  let rows: OpportunityRow[]
  try {
    rows = await salesforceQuery<OpportunityRow>(soql)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Closed Won opportunity query failed."
    result.errors.push(message)
    return result
  }

  let maxModified = since

  const { data: packageRows, error: pkgErr } = await admin
    .from("packages")
    .select("id, salesforce_product_id, product_code, inventory_group_id, duration, package_inventory ( qty_available, qty_held )")
    .or("salesforce_product_id.not.is.null,product_code.not.is.null")

  if (pkgErr) {
    result.errors.push(pkgErr.message)
    return result
  }

  const packageByProduct2 = new Map<string, string>()
  const currentSellableByPackage = new Map<string, number>()
  const product2Ids: string[] = []
  for (const row of (packageRows ?? []) as PackageMappingRow[]) {
    let product2Id =
      typeof row.salesforce_product_id === "string" ? row.salesforce_product_id.trim() : ""
    const packageId = typeof row.id === "string" ? row.id.trim() : ""
    const productCode = typeof row.product_code === "string" ? row.product_code.trim() : ""
    if (!product2Id && productCode && packageId) {
      try {
        product2Id = (await findProduct2IdByCode(productCode)) ?? ""
        if (product2Id) {
          await admin
            .from("packages")
            .update({ salesforce_product_id: product2Id, integration_sync_error: null })
            .eq("id", packageId)
        }
      } catch (e) {
        result.errors.push(`${packageId}: Product Code "${productCode}" lookup failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (product2Id && packageId) {
      const existingPackageId = packageByProduct2.get(product2Id)
      if (!existingPackageId || productCode) {
        packageByProduct2.set(product2Id, packageId)
      }
      product2Ids.push(product2Id)
      const inv = Array.isArray(row.package_inventory) ? row.package_inventory[0] : row.package_inventory
      const available = Number(inv?.qty_available) || 0
      const held = Number(inv?.qty_held) || 0
      currentSellableByPackage.set(packageId, Math.max(0, Math.floor(available) - Math.floor(held)))
    }
  }

  const sfSnapshots = await readSfInventorySnapshotsBulk(product2Ids, config)

  const packagesToSync = new Set<string>()

  for (const opp of rows) {
    result.opportunitiesScanned++
    const oppId = typeof opp.Id === "string" ? opp.Id.trim() : ""
    if (!oppId) continue

    const modified = new Date(opp.LastModifiedDate)
    if (!Number.isNaN(modified.getTime()) && modified > maxModified) {
      maxModified = modified
    }

    if (portalOppIds.has(oppId)) {
      result.skippedPortalOrders++
      continue
    }

    const lineItems = opp.OpportunityLineItems?.records ?? []
    for (const line of lineItems) {
      const lineItemId = typeof line.Id === "string" ? line.Id.trim() : ""
      const product2Id = typeof line.Product2Id === "string" ? line.Product2Id.trim() : ""
      const quantity = lineItemQuantity(line.Quantity)

      if (!lineItemId || !product2Id || quantity <= 0) continue

      const appliedKey = `${oppId}:${lineItemId}`
      if (appliedKeys.has(appliedKey)) {
        result.skippedAlreadyApplied++
        continue
      }

      const packageId = packageByProduct2.get(product2Id)
      if (!packageId) {
        result.skippedUnmappedProduct++
        continue
      }

      const currentSellable = currentSellableByPackage.get(packageId)
      const sfTargetSellable = salesforceTargetSellable(sfSnapshots.get(product2Id) ?? {
        quantitySold: 0,
        stock: null,
        available: null,
        quantitySoldEstimated: false,
      })
      const reflectedInPortal =
        currentSellable != null && sfTargetSellable != null
          ? Math.max(0, currentSellable - sfTargetSellable)
          : quantity
      const decrement = Math.min(quantity, reflectedInPortal)

      if (decrement > 0) {
        const { error: rpcErr } = await admin.rpc("adjust_linked_inventory_available", {
          p_package_id: packageId,
          p_delta: -decrement,
        })
        if (rpcErr) {
          result.errors.push(`${oppId} line ${lineItemId}: ${rpcErr.message}`)
          continue
        }
        if (currentSellable != null) {
          currentSellableByPackage.set(packageId, Math.max(0, currentSellable - decrement))
        }
      }

      const { error: insertErr } = await admin.from("salesforce_offline_sale_applications").insert({
        salesforce_opportunity_id: oppId,
        salesforce_line_item_id: lineItemId,
        salesforce_product2_id: product2Id,
        package_id: packageId,
        quantity,
      })

      if (insertErr) {
        result.errors.push(`${oppId} line ${lineItemId} record: ${insertErr.message}`)
        continue
      }

      appliedKeys.add(appliedKey)
      packagesToSync.add(packageId)
      result.lineItemsApplied++
      result.adjustments.push({
        opportunityId: oppId,
        opportunityName: typeof opp.Name === "string" ? opp.Name : oppId,
        lineItemId,
        packageId,
        product2Id,
        quantity,
      })
    }
  }

  const { data: recordedSfPackages, error: recordedSfErr } = await admin
    .from("salesforce_offline_sale_applications")
    .select("package_id")
  if (recordedSfErr) {
    result.errors.push(`recorded Salesforce sales: ${recordedSfErr.message}`)
  }
  const recordedSfPackageIds = (recordedSfPackages ?? [])
    .map((row) => (typeof row.package_id === "string" ? row.package_id.trim() : ""))
    .filter(Boolean)

  const reconcile = await reconcileLinkedInventoryFromRecordedSales(admin, [
    ...packagesToSync,
    ...result.adjustments.map((adj) => adj.packageId),
    ...recordedSfPackageIds,
  ])
  result.errors.push(...reconcile.errors)

  if (rows.length > 0) {
    await setIntegrationSetting(CURSOR_KEY, maxModified.toISOString())
  }

  return result
}
