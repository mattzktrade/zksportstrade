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

const LINKED_SELLABLE_DAY_DURATIONS = new Set([
  "thursday_only",
  "friday_only",
  "saturday_only",
  "sunday_only",
])

/** Sellable single-day sibling in a linked inventory group (not a shell). */
export function isLinkedSellableDayPackage(input: {
  inventory_group_id?: string | null
  shell_parent_package_id?: string | null
  duration?: string | null
}): boolean {
  if (!input.inventory_group_id?.trim() || input.shell_parent_package_id?.trim()) return false
  const duration = input.duration?.trim() ?? ""
  return LINKED_SELLABLE_DAY_DURATIONS.has(duration)
}

/**
 * Blank Product2 created by a failed auto-match (Stock/Available/Sold all zero). Pulling this
 * onto a linked group would zero the portal and then min() the 3-day row to 0.
 */
export function isUninitializedSfInventorySnapshot(snapshot: SfInventorySnapshot): boolean {
  const stock = snapshot.stock ?? 0
  const available = snapshot.available ?? 0
  return stock <= 0 && available <= 0 && snapshot.quantitySold <= 0
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

  // When Available is 0 and Quantity_Sold equals Stock, the Product2 formula
  // (Stock − Available) is feeding back a corrupt Available push — treat that
  // explicit sold as untrusted so pull can recover from closed-won lines.
  const formulaFeedbackCorrupt =
    stock != null &&
    stock > 0 &&
    available != null &&
    Math.floor(available) === 0 &&
    explicitSold != null &&
    Math.floor(explicitSold) >= Math.floor(stock)

  if (explicitSold != null && explicitSold > 0 && !formulaFeedbackCorrupt) {
    quantitySold = Math.floor(explicitSold)
  } else if (explicitSold != null && explicitSold < 0) {
    // Corrupt DLRS rollup (e.g. Stock=0, Sold=-22 after a bad portal sync). Ignore the negative
    // field and derive from other signals.
    if (stock != null && available != null && stock > 0) {
      quantitySold = Math.max(0, Math.floor(stock) - Math.floor(available))
    } else if (valueSold != null && valueSold > 0 && unitPrice != null && unitPrice > 0) {
      quantitySold = Math.max(0, Math.floor(valueSold / unitPrice))
      quantitySoldEstimated = true
    }
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
  const fromAvailable =
    snapshot.available != null ? Math.max(0, Math.floor(snapshot.available)) : null
  const stock = snapshot.stock != null ? Math.max(0, Math.floor(snapshot.stock)) : null
  const sold = Math.max(0, snapshot.quantitySold)

  // Available wiped to 0 while Sold claims the full stock — classic formula feedback after a
  // bad Available push. Callers should fall back to closed-won lines / Stock Sources.
  if (stock != null && stock > 0 && fromAvailable === 0 && sold >= stock) {
    return null
  }

  const fromStock =
    stock != null && stock > 0 ? Math.max(0, stock - sold) : null

  if (fromAvailable != null && fromStock != null) {
    // Available__c is sometimes stale (0) while Stock − Sold is correct — use the higher.
    return Math.max(fromAvailable, fromStock)
  }
  // When Stock Quantity is 0/corrupt, trust Available alone (e.g. Sat Stock=0 Sold=-22).
  return fromAvailable ?? fromStock
}

/**
 * Sellable for a linked day package sharing a pool with the 3-day parent.
 * Each 3-day sale consumes one unit from every day; day-only sales consume that day only.
 */
export function linkedDayPoolSellable(input: {
  poolStock: number | null
  threeDayCommitted: number
  dayCommitted: number
  snapshot: SfInventorySnapshot
}): number | null {
  const poolStock =
    input.poolStock != null && input.poolStock > 0
      ? Math.max(0, Math.floor(input.poolStock))
      : null
  const threeDayCommitted = Math.max(0, Math.floor(input.threeDayCommitted))
  const dayCommitted = Math.max(0, Math.floor(input.dayCommitted))

  if (poolStock != null) {
    return Math.max(0, poolStock - threeDayCommitted - dayCommitted)
  }

  const stock = input.snapshot.stock != null ? Math.max(0, Math.floor(input.snapshot.stock)) : null
  if (stock != null && stock > 0) {
    return Math.max(0, stock - threeDayCommitted - dayCommitted)
  }

  const fromFields = salesforceTargetSellable(input.snapshot)
  if (fromFields == null) return null
  if (dayCommitted > 0 || threeDayCommitted > 0) {
    return Math.max(0, fromFields - dayCommitted)
  }
  return fromFields
}

/** Total stock for a linked pool — prefer the 3-day parent Product2 stock. */
export function linkedPoolStockQuantity(
  parentSnapshot: SfInventorySnapshot | null | undefined,
): number | null {
  const parentStock =
    parentSnapshot?.stock != null ? Math.max(0, Math.floor(parentSnapshot.stock)) : null
  return parentStock != null && parentStock > 0 ? parentStock : null
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
