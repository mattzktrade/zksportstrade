import { salesforceQuery } from "@/lib/integrations/salesforce/client"
import type { SalesforceConfig } from "@/lib/integrations/salesforce/config"

/** Salesforce-owned — portal sync must never PATCH these (DLRS rollups). */
export const PROTECTED_SALESFORCE_PRODUCT_FIELDS = new Set([
  "Quantity_Sold__c",
])

export type SfInventorySnapshot = {
  /** Units already sold (website, offline, portal, etc.) — preserved across sync. */
  quantitySold: number
  stock: number | null
  available: number | null
  /** True when quantitySold was estimated from Value Sold ÷ Unit Price. */
  quantitySoldEstimated: boolean
}

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function finiteNum(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const SF_INVENTORY_BATCH_SIZE = 200

function inventorySelectFields(config: SalesforceConfig): string[] {
  const select = new Set<string>(["Id"])
  if (config.fieldQuantitySold) select.add(config.fieldQuantitySold)
  if (config.fieldStockQty) select.add(config.fieldStockQty)
  if (config.fieldAvailableQty) select.add(config.fieldAvailableQty)
  if (config.fieldValueSold) select.add(config.fieldValueSold)
  if (config.fieldUnitPrice) select.add(config.fieldUnitPrice)
  return [...select]
}

export function parseSfInventorySnapshotFromRow(
  row: Record<string, unknown>,
  config: SalesforceConfig,
): SfInventorySnapshot {
  const stock = config.fieldStockQty ? finiteNum(row[config.fieldStockQty]) : null
  const available = config.fieldAvailableQty ? finiteNum(row[config.fieldAvailableQty]) : null
  const explicitSold = config.fieldQuantitySold ? finiteNum(row[config.fieldQuantitySold]) : null
  const valueSold = config.fieldValueSold ? finiteNum(row[config.fieldValueSold]) : null
  const unitPrice = config.fieldUnitPrice ? finiteNum(row[config.fieldUnitPrice]) : null

  let quantitySold = 0
  let quantitySoldEstimated = false

  if (explicitSold != null && explicitSold > 0) {
    quantitySold = explicitSold
  } else if (valueSold != null && valueSold > 0 && unitPrice != null && unitPrice > 0) {
    quantitySold = Math.max(0, Math.floor(valueSold / unitPrice))
    quantitySoldEstimated = true
  } else if (stock != null && available != null && stock > available) {
    quantitySold = stock - available
  }

  return { quantitySold, stock, available, quantitySoldEstimated }
}

/** Portal sellable units implied by Salesforce Product2 inventory fields. */
export function salesforceTargetSellable(snapshot: SfInventorySnapshot): number | null {
  if (snapshot.available != null) {
    return Math.max(0, Math.floor(snapshot.available))
  }
  if (snapshot.stock != null) {
    return Math.max(0, Math.floor(snapshot.stock - snapshot.quantitySold))
  }
  return null
}

/**
 * Reads current Salesforce inventory so we can push portal *available* stock without
 * wiping Quantity Sold (often Stock − Available on the product).
 */
export async function readSfInventorySnapshot(
  product2Id: string,
  config: SalesforceConfig,
): Promise<SfInventorySnapshot> {
  const rows = await salesforceQuery<Record<string, unknown>>(
    `SELECT ${inventorySelectFields(config).join(", ")} FROM Product2 WHERE Id = '${escapeSoqlString(product2Id)}' LIMIT 1`,
  )
  return parseSfInventorySnapshotFromRow(rows[0] ?? {}, config)
}

/** Bulk read Product2 inventory for offline-sale reconciliation (cron). */
export async function readSfInventorySnapshotsBulk(
  product2Ids: string[],
  config: SalesforceConfig,
): Promise<Map<string, SfInventorySnapshot>> {
  const uniqueIds = [...new Set(product2Ids.map((id) => id.trim()).filter(Boolean))]
  const result = new Map<string, SfInventorySnapshot>()
  if (uniqueIds.length === 0) return result

  const select = inventorySelectFields(config).join(", ")
  for (let i = 0; i < uniqueIds.length; i += SF_INVENTORY_BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + SF_INVENTORY_BATCH_SIZE)
    const inList = batch.map((id) => `'${escapeSoqlString(id)}'`).join(", ")
    const rows = await salesforceQuery<Record<string, unknown>>(
      `SELECT ${select} FROM Product2 WHERE Id IN (${inList})`,
    )
    for (const row of rows) {
      const id = typeof row.Id === "string" ? row.Id : null
      if (!id) continue
      result.set(id, parseSfInventorySnapshotFromRow(row, config))
    }
  }

  return result
}

/** Total stock in SF = portal sellable + units already sold elsewhere. */
export function stockQuantityForSalesforce(sellable: number, snapshot: SfInventorySnapshot): number {
  return Math.max(0, sellable) + Math.max(0, snapshot.quantitySold)
}
