import { dealReferenceNumber } from "@/lib/crm/deal-types"

export type SaleFillOrder = {
  id: string
  createdAt: string
  reference?: string | null
  dealReference?: string | null
}

function createdAtMs(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

function saleReference(sale: SaleFillOrder): string | null {
  return sale.dealReference ?? sale.reference ?? null
}

/**
 * Oldest signed sale is filled first. Last-added deals take the shortage.
 * DL number is only a tie-break when two sales were created at the same time —
 * a later deal with a lower DL must not steal seats from an earlier booking.
 */
export function compareOldestSaleFirst(left: SaleFillOrder, right: SaleFillOrder): number {
  const byCreated = createdAtMs(left.createdAt) - createdAtMs(right.createdAt)
  if (byCreated !== 0) return byCreated
  const leftDl = dealReferenceNumber(saleReference(left))
  const rightDl = dealReferenceNumber(saleReference(right))
  if (leftDl != null && rightDl != null && leftDl !== rightDl) return leftDl - rightDl
  if (leftDl != null && rightDl == null) return -1
  if (leftDl == null && rightDl != null) return 1
  return left.id.localeCompare(right.id)
}
