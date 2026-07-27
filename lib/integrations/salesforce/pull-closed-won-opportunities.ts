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
/** Force pull lookback — long enough to catch missed offline sales without scanning years. */
const FORCE_LOOKBACK_MS = 120 * 24 * 60 * 60 * 1000
const FIRST_RUN_OVERLAP_MS = 5 * 60 * 1000
/** Every cron tick also re-scans this recent window newest-first so new Closed Won
 * deals are not stuck behind an ASC cursor backlog of older opportunities. */
const RECENT_CATCHUP_MS = 2 * 60 * 60 * 1000
const CLOSED_WON_QUERY_LIMIT = 200
const RECENT_CATCHUP_LIMIT = 50

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
  /** Packages that received a new offline-sale ledger row this run. */
  affectedPackageIds: string[]
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

function buildClosedWonSoql(input: {
  stageClause: string
  since: Date
  orderDir: "ASC" | "DESC"
  limit: number
}): string {
  return (
    `SELECT Id, Name, LastModifiedDate, ` +
    `(SELECT Id, Product2Id, Quantity FROM OpportunityLineItems WHERE Product2Id != null) ` +
    `FROM Opportunity WHERE ${input.stageClause} AND LastModifiedDate >= ${soqlDateTime(input.since)} ` +
    `ORDER BY LastModifiedDate ${input.orderDir} LIMIT ${input.limit}`
  )
}

/** Merge opportunity rows by Id (prefer newer LastModifiedDate). */
function mergeOpportunityRows(batches: OpportunityRow[][]): OpportunityRow[] {
  const byId = new Map<string, OpportunityRow>()
  for (const batch of batches) {
    for (const row of batch) {
      const id = typeof row.Id === "string" ? row.Id.trim() : ""
      if (!id) continue
      const existing = byId.get(id)
      if (!existing) {
        byId.set(id, row)
        continue
      }
      const prev = new Date(existing.LastModifiedDate).getTime()
      const next = new Date(row.LastModifiedDate).getTime()
      if (!Number.isNaN(next) && (Number.isNaN(prev) || next >= prev)) {
        byId.set(id, row)
      }
    }
  }
  return [...byId.values()]
}

/**
 * Apply inventory for Closed Won Salesforce opportunities that were not created by the portal.
 *
 * Portal orders already decrement inventory at checkout — those opportunities are skipped.
 *
 * IMPORTANT: The previous version of this file also called an internal helper
 * `reconcileLinkedInventoryFromRecordedSales` after applying each opportunity. That helper
 * recomputed each day-package's qty_available as `base − consumed`, where `base` was the
 * day's own cost layers (0 for linked days, whose stock lives on the 3-day parent) or a
 * fallback of `qty_available + own_sold`, and `consumed` cascaded the 3-day sold count into
 * every day sibling. That double-subtracted the 3-day committed quantity on every cron tick.
 * The reconcile helper stays removed — after new offline rows are recorded, the caller
 * heals affected linked groups (and Stock Sources) explicitly.
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
    affectedPackageIds: [],
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

  const batches: OpportunityRow[][] = []

  /** ASC cursor batch only — used to advance the incremental cursor safely. */
  let cursorBatch: OpportunityRow[] = []

  if (options?.force) {
    // Force: newest-first across the long lookback so recent offline sales apply immediately.
    try {
      batches.push(
        await salesforceQuery<OpportunityRow>(
          buildClosedWonSoql({
            stageClause,
            since,
            orderDir: "DESC",
            limit: CLOSED_WON_QUERY_LIMIT,
          }),
        ),
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : "Closed Won opportunity query failed."
      result.errors.push(message)
      return result
    }
  } else {
    // Incremental: ASC cursor drain + recent DESC catch-up (new deals within 2h).
    const recentSince = new Date(Date.now() - RECENT_CATCHUP_MS)
    try {
      const [cursorRows, recentRows] = await Promise.all([
        salesforceQuery<OpportunityRow>(
          buildClosedWonSoql({
            stageClause,
            since,
            orderDir: "ASC",
            limit: CLOSED_WON_QUERY_LIMIT,
          }),
        ),
        salesforceQuery<OpportunityRow>(
          buildClosedWonSoql({
            stageClause,
            since: recentSince,
            orderDir: "DESC",
            limit: RECENT_CATCHUP_LIMIT,
          }),
        ),
      ])
      cursorBatch = cursorRows
      batches.push(cursorRows, recentRows)
    } catch (e) {
      const message = e instanceof Error ? e.message : "Closed Won opportunity query failed."
      result.errors.push(message)
      return result
    }
  }

  const rows = mergeOpportunityRows(batches)
  // Advance cursor only from the ASC drain — never from recent catch-up (that would skip backlog).
  let maxModified = since
  for (const opp of cursorBatch) {
    const modified = new Date(opp.LastModifiedDate)
    if (!Number.isNaN(modified.getTime()) && modified > maxModified) {
      maxModified = modified
    }
  }

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
  const needsCodeLookup: PackageMappingRow[] = []
  for (const row of (packageRows ?? []) as PackageMappingRow[]) {
    const product2Id =
      typeof row.salesforce_product_id === "string" ? row.salesforce_product_id.trim() : ""
    const packageId = typeof row.id === "string" ? row.id.trim() : ""
    const productCode = typeof row.product_code === "string" ? row.product_code.trim() : ""
    if (!product2Id && productCode && packageId) {
      needsCodeLookup.push(row)
      continue
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

  // Resolve missing Product2 Ids in small parallel batches (avoid one SF round-trip per package).
  const CODE_LOOKUP_CONCURRENCY = 8
  for (let i = 0; i < needsCodeLookup.length; i += CODE_LOOKUP_CONCURRENCY) {
    const batch = needsCodeLookup.slice(i, i + CODE_LOOKUP_CONCURRENCY)
    await Promise.all(
      batch.map(async (row) => {
        const packageId = typeof row.id === "string" ? row.id.trim() : ""
        const productCode = typeof row.product_code === "string" ? row.product_code.trim() : ""
        if (!packageId || !productCode) return
        try {
          const product2Id = (await findProduct2IdByCode(productCode)) ?? ""
          if (!product2Id) return
          await admin
            .from("packages")
            .update({ salesforce_product_id: product2Id, integration_sync_error: null })
            .eq("id", packageId)
          packageByProduct2.set(product2Id, packageId)
          product2Ids.push(product2Id)
          const inv = Array.isArray(row.package_inventory) ? row.package_inventory[0] : row.package_inventory
          const available = Number(inv?.qty_available) || 0
          const held = Number(inv?.qty_held) || 0
          currentSellableByPackage.set(packageId, Math.max(0, Math.floor(available) - Math.floor(held)))
        } catch (e) {
          result.errors.push(
            `${packageId}: Product Code "${productCode}" lookup failed: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }),
    )
  }

  const sfSnapshots = await readSfInventorySnapshotsBulk(product2Ids, config)
  const affectedPackages = new Set<string>()

  for (const opp of rows) {
    result.opportunitiesScanned++
    const oppId = typeof opp.Id === "string" ? opp.Id.trim() : ""
    if (!oppId) continue

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

      const currentSellable = currentSellableByPackage.get(packageId) ?? 0
      const sfTargetSellable = salesforceTargetSellable(sfSnapshots.get(product2Id) ?? {
        quantitySold: 0,
        stock: null,
        available: null,
        quantitySoldEstimated: false,
      })
      // When Product2 Available/Sold looks corrupt (null target), do not invent a decrement —
      // linked-group heal / Available pull owns sellable. Still record the offline application.
      const reflectedInPortal =
        sfTargetSellable != null
          ? Math.max(0, currentSellable - sfTargetSellable)
          : 0
      // Never reduce qty_available below qty_held (package_inventory_held_lte_available).
      const decrement = Math.min(quantity, reflectedInPortal, currentSellable)

      if (decrement > 0) {
        const { error: rpcErr } = await admin.rpc("adjust_linked_inventory_available", {
          p_package_id: packageId,
          p_delta: -decrement,
        })
        if (rpcErr) {
          result.errors.push(`${oppId} line ${lineItemId}: ${rpcErr.message}`)
          continue
        }
        currentSellableByPackage.set(packageId, Math.max(0, currentSellable - decrement))
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
      affectedPackages.add(packageId)
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

  result.affectedPackageIds = [...affectedPackages]

  // Force pulls must not advance the incremental cursor.
  // Incremental: only advance from the ASC cursor batch (not recent catch-up).
  if (cursorBatch.length > 0 && !options?.force) {
    await setIntegrationSetting(CURSOR_KEY, maxModified.toISOString())
  }

  return result
}
