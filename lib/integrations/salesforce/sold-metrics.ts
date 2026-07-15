import { salesforceQuery, salesforceRequest } from "@/lib/integrations/salesforce/client"
import type { SalesforceConfig } from "@/lib/integrations/salesforce/config"
import { getProduct2UpdateableFields } from "@/lib/integrations/salesforce/describe"

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

/**
 * Sum line totals on Closed Won opportunities only — matches Quantity Sold.
 * Open pipeline must not inflate Value Sold (that made Spanish Club Suite jump
 * from ~$953k actual won revenue toward list-price / pipeline-inclusive totals).
 */
export async function computeProductValueSoldFromLines(
  product2Id: string,
  wonStageName: string,
): Promise<number> {
  const won = escapeSoqlString(wonStageName.trim())
  const pid = escapeSoqlString(product2Id)
  const rows = await salesforceQuery<{ totalValue: number | null }>(
    `SELECT SUM(TotalPrice) totalValue FROM OpportunityLineItem WHERE Product2Id = '${pid}' AND (Opportunity.IsWon = true OR Opportunity.StageName = '${won}')`,
  )
  const v = rows[0]?.totalValue
  if (v == null || !Number.isFinite(Number(v))) return 0
  return Math.max(0, Number(v))
}

export async function computeProductQuantitySoldFromWonLines(
  product2Id: string,
  wonStageName: string,
): Promise<number> {
  const won = escapeSoqlString(wonStageName.trim())
  const pid = escapeSoqlString(product2Id)
  const rows = await salesforceQuery<{ totalQty: number | null }>(
    `SELECT SUM(Quantity) totalQty FROM OpportunityLineItem WHERE Product2Id = '${pid}' AND (Opportunity.IsWon = true OR Opportunity.StageName = '${won}')`,
  )
  const v = rows[0]?.totalQty
  if (v == null || !Number.isFinite(Number(v))) return 0
  return Math.max(0, Math.floor(Number(v)))
}

export async function computeProductCommittedQuantityFromLines(
  product2Id: string,
  lostStageName: string,
): Promise<number> {
  const lost = escapeSoqlString(lostStageName.trim())
  const pid = escapeSoqlString(product2Id)
  const rows = await salesforceQuery<{ totalQty: number | null }>(
    `SELECT SUM(Quantity) totalQty FROM OpportunityLineItem WHERE Product2Id = '${pid}' AND Opportunity.StageName != '${lost}'`,
  )
  const v = rows[0]?.totalQty
  if (v == null || !Number.isFinite(Number(v))) return 0
  return Math.max(0, Math.floor(Number(v)))
}

/** Bulk read Closed Won opportunity line quantities per Product2. */
export async function readWonQuantityByProductBulk(
  product2Ids: string[],
  wonStageName: string,
): Promise<Map<string, number>> {
  const uniqueIds = [...new Set(product2Ids.map((id) => id.trim()).filter(Boolean))]
  const result = new Map<string, number>()
  if (uniqueIds.length === 0) return result

  const won = escapeSoqlString(wonStageName.trim())
  for (let i = 0; i < uniqueIds.length; i += 200) {
    const batch = uniqueIds.slice(i, i + 200)
    const inList = batch.map((id) => `'${escapeSoqlString(id)}'`).join(",")
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

/** Bulk read open-pipeline (non-lost) opportunity line quantities per Product2. */
export async function readCommittedQuantityByProductBulk(
  product2Ids: string[],
  lostStageName: string,
): Promise<Map<string, number>> {
  const uniqueIds = [...new Set(product2Ids.map((id) => id.trim()).filter(Boolean))]
  const result = new Map<string, number>()
  if (uniqueIds.length === 0) return result

  const lost = escapeSoqlString(lostStageName.trim())
  for (let i = 0; i < uniqueIds.length; i += 200) {
    const batch = uniqueIds.slice(i, i + 200)
    const inList = batch.map((id) => `'${escapeSoqlString(id)}'`).join(",")
    const rows = await salesforceQuery<{ Product2Id: string; totalQty: number | null }>(
      `SELECT Product2Id, SUM(Quantity) totalQty FROM OpportunityLineItem WHERE Product2Id IN (${inList}) AND Opportunity.StageName != '${lost}' GROUP BY Product2Id`,
    )
    for (const row of rows) {
      const product2Id = typeof row.Product2Id === "string" ? row.Product2Id.trim() : ""
      const qty = Math.max(0, Math.floor(Number(row.totalQty) || 0))
      if (product2Id && qty > 0) result.set(product2Id, qty)
    }
  }
  return result
}

/** Bulk read open-pipeline opportunity line quantities per Product2.
 *
 * Open pipeline = all non-lost lines minus Closed Won. Prefer this over
 * `IsClosed = false` alone — some orgs leave pipeline deals in stages where
 * IsClosed is unreliable, and the Pipeline related list still counts them.
 */
export async function readOpenPipelineQuantityByProductBulk(
  product2Ids: string[],
  lostStageName: string,
  wonStageName?: string,
): Promise<Map<string, number>> {
  const uniqueIds = [...new Set(product2Ids.map((id) => id.trim()).filter(Boolean))]
  const result = new Map<string, number>()
  if (uniqueIds.length === 0) return result

  const [committed, won] = await Promise.all([
    readCommittedQuantityByProductBulk(uniqueIds, lostStageName),
    readWonQuantityByProductBulk(
      uniqueIds,
      (wonStageName ?? "Closed Won").trim() || "Closed Won",
    ),
  ])

  for (const id of uniqueIds) {
    const open = Math.max(0, (committed.get(id) ?? 0) - (won.get(id) ?? 0))
    if (open > 0) result.set(id, open)
  }
  return result
}

/** Push Value Sold on Product2 from Closed Won OpportunityLineItem totals only. */
export async function syncProductValueSold(args: {
  product2Id: string
  config: SalesforceConfig
  fieldsUpdated?: string[]
  fieldsSkipped?: string[]
}): Promise<void> {
  const { product2Id, config } = args
  const fieldsUpdated = args.fieldsUpdated ?? []
  const fieldsSkipped = args.fieldsSkipped ?? []

  if (!config.fieldValueSold) {
    fieldsSkipped.push("Value Sold (SALESFORCE_FIELD_VALUE_SOLD not configured)")
    return
  }

  const updateable = await getProduct2UpdateableFields()
  if (!updateable.has(config.fieldValueSold)) {
    fieldsSkipped.push(`Value Sold (${config.fieldValueSold} is read-only — cannot sync from portal)`)
    return
  }

  const valueSold = await computeProductValueSoldFromLines(product2Id, config.opportunityStageWon)

  try {
    await salesforceRequest("PATCH", `/sobjects/Product2/${product2Id}`, {
      body: { [config.fieldValueSold]: valueSold },
    })
    fieldsUpdated.push(config.fieldValueSold)
  } catch (e) {
    fieldsSkipped.push(`Value Sold: ${e instanceof Error ? e.message : String(e)}`)
  }
}
