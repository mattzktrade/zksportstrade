import { salesforceQuery, salesforceRequest } from "@/lib/integrations/salesforce/client"
import type { SalesforceConfig } from "@/lib/integrations/salesforce/config"
import { getProduct2UpdateableFields } from "@/lib/integrations/salesforce/describe"

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

/**
 * Sum line totals on the product's open pipeline (everything except Closed Lost).
 * Matches the Pipeline tab and drops cancelled portal orders once their Opportunity
 * moves to Closed Lost.
 */
export async function computeProductValueSoldFromLines(
  product2Id: string,
  lostStageName: string,
): Promise<number> {
  const lost = escapeSoqlString(lostStageName.trim())
  const pid = escapeSoqlString(product2Id)
  const rows = await salesforceQuery<{ totalValue: number | null }>(
    `SELECT SUM(TotalPrice) totalValue FROM OpportunityLineItem WHERE Product2Id = '${pid}' AND Opportunity.StageName != '${lost}'`,
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

/**
 * Push Value Sold on Product2 so it tracks Quantity Sold for portal bookings.
 * Uses opportunity line totals; falls back to Quantity Sold × Unit Price when the
 * line sum is zero but DLRS has already incremented quantity.
 */
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

  let valueSold = await computeProductValueSoldFromLines(product2Id, config.opportunityStageLost)

  if (valueSold === 0 && config.fieldQuantitySold && config.fieldUnitPrice) {
    const rows = await salesforceQuery<Record<string, unknown>>(
      `SELECT ${config.fieldQuantitySold}, ${config.fieldUnitPrice} FROM Product2 WHERE Id = '${escapeSoqlString(product2Id)}' LIMIT 1`,
    )
    const qty = Number(rows[0]?.[config.fieldQuantitySold])
    const price = Number(rows[0]?.[config.fieldUnitPrice])
    if (Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price > 0) {
      valueSold = qty * price
    }
  }

  try {
    await salesforceRequest("PATCH", `/sobjects/Product2/${product2Id}`, {
      body: { [config.fieldValueSold]: valueSold },
    })
    fieldsUpdated.push(config.fieldValueSold)
  } catch (e) {
    fieldsSkipped.push(`Value Sold: ${e instanceof Error ? e.message : String(e)}`)
  }
}
