import { createClient } from "@/lib/supabase/server"
import type { PackageSalesBreakdown } from "@/lib/admin/package-sales-breakdown"
import { getSalesforceConfig, isSalesforceConfigured } from "@/lib/integrations/salesforce/config"
import { salesforceQuery } from "@/lib/integrations/salesforce/client"
import {
  readCommittedQuantityByProductBulk,
  readWonQuantityByProductBulk,
} from "@/lib/integrations/salesforce/sold-metrics"
import { getSalesforceConnectionStatus, getStoredInstanceUrl } from "@/lib/integrations/salesforce/settings-store"

type PackageProductRow = {
  id: string
  salesforce_product_id: string | null
}

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

/**
 * Opportunity Ids created from portal / Wix orders for these packages.
 * Those deals already appear in the Portal / Wix columns — counting them again as
 * Salesforce closed-won or open pipeline double-subtracts Remaining in the admin UI.
 */
async function loadPortalSyncedOpportunityIds(
  packageIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(packageIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return new Set()

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("orders")
    .select("salesforce_opportunity_id")
    .in("package_id", ids)
    .neq("status", "cancelled")
    .not("salesforce_opportunity_id", "is", null)

  if (error) {
    console.warn("[admin] portal opportunity ids for sales breakdown:", error.message)
    return new Set()
  }

  const out = new Set<string>()
  for (const row of data ?? []) {
    const id = typeof row.salesforce_opportunity_id === "string" ? row.salesforce_opportunity_id.trim() : ""
    if (id) out.add(id)
  }
  return out
}

/** Line quantities on portal-synced opportunities, keyed by Product2 Id. */
async function readPortalMirroredQtyByProduct(input: {
  opportunityIds: readonly string[]
  product2Ids: readonly string[]
  wonStageName: string
  lostStageName: string
  mode: "won" | "committed"
}): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const oppIds = [...new Set(input.opportunityIds.map((id) => id.trim()).filter(Boolean))]
  const productIds = [...new Set(input.product2Ids.map((id) => id.trim()).filter(Boolean))]
  if (oppIds.length === 0 || productIds.length === 0) return result

  const won = escapeSoqlString(input.wonStageName.trim())
  const lost = escapeSoqlString(input.lostStageName.trim())
  const stageFilter =
    input.mode === "won"
      ? `(Opportunity.IsWon = true OR Opportunity.StageName = '${won}')`
      : `Opportunity.StageName != '${lost}'`

  for (let i = 0; i < oppIds.length; i += 100) {
    const oppBatch = oppIds.slice(i, i + 100)
    for (let j = 0; j < productIds.length; j += 100) {
      const productBatch = productIds.slice(j, j + 100)
      const oppIn = oppBatch.map((id) => `'${escapeSoqlString(id)}'`).join(",")
      const productIn = productBatch.map((id) => `'${escapeSoqlString(id)}'`).join(",")
      const rows = await salesforceQuery<{ Product2Id: string; totalQty: number | null }>(
        `SELECT Product2Id, SUM(Quantity) totalQty FROM OpportunityLineItem ` +
          `WHERE OpportunityId IN (${oppIn}) AND Product2Id IN (${productIn}) AND ${stageFilter} ` +
          `GROUP BY Product2Id`,
      )
      for (const row of rows) {
        const product2Id = typeof row.Product2Id === "string" ? row.Product2Id.trim() : ""
        const qty = Math.max(0, Math.floor(Number(row.totalQty) || 0))
        if (!product2Id || qty <= 0) continue
        result.set(product2Id, (result.get(product2Id) ?? 0) + qty)
      }
    }
  }
  return result
}

function recomputeBreakdownTotal(b: PackageSalesBreakdown): void {
  b.total =
    Math.max(0, Math.floor(b.wix)) +
    Math.max(0, Math.floor(b.tradePortal)) +
    Math.max(0, Math.floor(b.salesforceOffline)) +
    Math.max(0, Math.floor(b.salesforceOpenPipeline))
}

/**
 * Enrich portal sales breakdown rows with live Salesforce closed-won and open-pipeline
 * quantities. Only call on package detail views — not the catalog list (keeps list loads fast).
 *
 * Closed-won from OpportunityLineItem is preferred over (or fills gaps in) portal
 * `salesforce_offline_sale_applications` so Sold / Places Sold match Salesforce when
 * Product2 Quantity_Sold is formula-corrupt or offline pulls are incomplete.
 *
 * Portal/Wix orders that sync to Salesforce are excluded from the Salesforce columns —
 * they already appear under Portal / Wix. Counting them again made Sellable look like
 * stock − portal − pipeline for the same booking.
 */
export async function enrichPackageSalesBreakdownWithOpenPipeline(
  breakdowns: Map<string, PackageSalesBreakdown>,
  packages: PackageProductRow[],
): Promise<void> {
  if (!isSalesforceConfigured()) return

  const connection = await getSalesforceConnectionStatus()
  if (!connection.connected) return

  const instanceUrl =
    (await getStoredInstanceUrl()) ?? process.env.SALESFORCE_INSTANCE_URL?.trim() ?? ""
  const config = getSalesforceConfig(instanceUrl || undefined)
  if (!config) return

  const productToPackage = new Map<string, string>()
  const product2Ids: string[] = []
  const packageIds: string[] = []
  for (const pkg of packages) {
    const packageId = pkg.id.trim()
    const product2Id = pkg.salesforce_product_id?.trim() ?? ""
    if (!packageId || !product2Id) continue
    productToPackage.set(product2Id, packageId)
    product2Ids.push(product2Id)
    packageIds.push(packageId)
  }
  if (product2Ids.length === 0) return

  let wonByProduct: Map<string, number>
  let committedByProduct: Map<string, number>
  let portalOppIds: Set<string>
  try {
    ;[wonByProduct, committedByProduct, portalOppIds] = await Promise.all([
      readWonQuantityByProductBulk(product2Ids, config.opportunityStageWon),
      readCommittedQuantityByProductBulk(product2Ids, config.opportunityStageLost),
      loadPortalSyncedOpportunityIds(packageIds),
    ])
  } catch (e) {
    console.warn(
      "[admin] Salesforce sales breakdown enrich failed:",
      e instanceof Error ? e.message : e,
    )
    return
  }

  let portalWonByProduct = new Map<string, number>()
  let portalCommittedByProduct = new Map<string, number>()
  if (portalOppIds.size > 0) {
    try {
      ;[portalWonByProduct, portalCommittedByProduct] = await Promise.all([
        readPortalMirroredQtyByProduct({
          opportunityIds: [...portalOppIds],
          product2Ids,
          wonStageName: config.opportunityStageWon,
          lostStageName: config.opportunityStageLost,
          mode: "won",
        }),
        readPortalMirroredQtyByProduct({
          opportunityIds: [...portalOppIds],
          product2Ids,
          wonStageName: config.opportunityStageWon,
          lostStageName: config.opportunityStageLost,
          mode: "committed",
        }),
      ])
    } catch (e) {
      console.warn(
        "[admin] portal-mirrored SF qty exclusion failed (breakdown may double-count):",
        e instanceof Error ? e.message : e,
      )
    }
  }

  for (const [product2Id, packageId] of productToPackage) {
    const breakdown = breakdowns.get(packageId)
    if (!breakdown) continue

    const rawWon = wonByProduct.get(product2Id) ?? 0
    const portalWon = portalWonByProduct.get(product2Id) ?? 0
    const wonQty = Math.max(0, rawWon - portalWon)

    // Live Closed Won lines (excluding portal-synced deals) are authoritative for the
    // Salesforce sold channel. Prefer them over offline applications when present.
    if (rawWon > 0 || portalWon > 0) {
      breakdown.salesforceOffline = wonQty
    }

    const rawCommitted = committedByProduct.get(product2Id) ?? 0
    const rawOpen = Math.max(0, rawCommitted - rawWon)
    const portalCommitted = portalCommittedByProduct.get(product2Id) ?? 0
    const portalOpen = Math.max(0, portalCommitted - portalWon)
    breakdown.salesforceOpenPipeline = Math.max(0, rawOpen - portalOpen)

    recomputeBreakdownTotal(breakdown)
  }
}
