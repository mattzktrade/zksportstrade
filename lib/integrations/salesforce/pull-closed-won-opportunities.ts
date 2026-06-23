import { enqueuePackageInventoryChannelSyncServer } from "@/lib/integrations/enqueue-server"
import { salesforceQuery } from "@/lib/integrations/salesforce/client"
import type { SalesforceConfig } from "@/lib/integrations/salesforce/config"
import { getIntegrationSetting, setIntegrationSetting } from "@/lib/integrations/salesforce/settings-store"
import type { SupabaseClient } from "@supabase/supabase-js"

const CURSOR_KEY = "salesforce_closed_won_inventory_cursor"
const FORCE_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000
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
    .select("id, salesforce_product_id")
    .not("salesforce_product_id", "is", null)

  if (pkgErr) {
    result.errors.push(pkgErr.message)
    return result
  }

  const packageByProduct2 = new Map<string, string>()
  for (const row of packageRows ?? []) {
    const product2Id =
      typeof row.salesforce_product_id === "string" ? row.salesforce_product_id.trim() : ""
    const packageId = typeof row.id === "string" ? row.id.trim() : ""
    if (product2Id && packageId) packageByProduct2.set(product2Id, packageId)
  }

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

      const { error: rpcErr } = await admin.rpc("adjust_linked_inventory_available", {
        p_package_id: packageId,
        p_delta: -quantity,
      })
      if (rpcErr) {
        result.errors.push(`${oppId} line ${lineItemId}: ${rpcErr.message}`)
        continue
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

  for (const packageId of packagesToSync) {
    const enq = await enqueuePackageInventoryChannelSyncServer(packageId, {
      trigger: "salesforce.closed_won",
      scheduleDrain: false,
    })
    if (!enq.ok) {
      result.errors.push(`channel sync ${packageId}: ${enq.message}`)
    }
  }

  if (rows.length > 0) {
    await setIntegrationSetting(CURSOR_KEY, maxModified.toISOString())
  }

  return result
}
