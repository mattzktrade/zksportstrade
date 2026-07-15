import type { PackageSalesBreakdown } from "@/lib/admin/package-sales-breakdown"
import { getSalesforceConfig, isSalesforceConfigured } from "@/lib/integrations/salesforce/config"
import {
  readCommittedQuantityByProductBulk,
  readWonQuantityByProductBulk,
} from "@/lib/integrations/salesforce/sold-metrics"
import { getSalesforceConnectionStatus, getStoredInstanceUrl } from "@/lib/integrations/salesforce/settings-store"

type PackageProductRow = {
  id: string
  salesforce_product_id: string | null
}

/**
 * Enrich portal sales breakdown rows with live Salesforce closed-won and open-pipeline
 * quantities. Only call on package detail views — not the catalog list (keeps list loads fast).
 *
 * Closed-won from OpportunityLineItem is preferred over (or fills gaps in) portal
 * `salesforce_offline_sale_applications` so Sold / Places Sold match Salesforce when
 * Product2 Quantity_Sold is formula-corrupt or offline pulls are incomplete.
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
  for (const pkg of packages) {
    const packageId = pkg.id.trim()
    const product2Id = pkg.salesforce_product_id?.trim() ?? ""
    if (!packageId || !product2Id) continue
    productToPackage.set(product2Id, packageId)
    product2Ids.push(product2Id)
  }
  if (product2Ids.length === 0) return

  let wonByProduct: Map<string, number>
  let committedByProduct: Map<string, number>
  try {
    ;[wonByProduct, committedByProduct] = await Promise.all([
      readWonQuantityByProductBulk(product2Ids, config.opportunityStageWon),
      readCommittedQuantityByProductBulk(product2Ids, config.opportunityStageLost),
    ])
  } catch (e) {
    console.warn(
      "[admin] Salesforce sales breakdown enrich failed:",
      e instanceof Error ? e.message : e,
    )
    return
  }

  for (const [product2Id, packageId] of productToPackage) {
    const breakdown = breakdowns.get(packageId)
    if (!breakdown) continue

    const wonQty = wonByProduct.get(product2Id) ?? 0
    // Live Closed Won lines are authoritative for the Salesforce sold channel.
    if (wonQty > 0) {
      const delta = wonQty - breakdown.salesforceOffline
      breakdown.salesforceOffline = wonQty
      breakdown.total += delta
    }

    const openQty = Math.max(0, (committedByProduct.get(product2Id) ?? 0) - wonQty)
    if (openQty !== breakdown.salesforceOpenPipeline) {
      breakdown.total += openQty - breakdown.salesforceOpenPipeline
      breakdown.salesforceOpenPipeline = openQty
    }
  }
}
