import {
  dealStageHasSignedBookingForm,
  type PackageDealSaleLine,
  type PackageDealSaleRow,
} from "@/lib/crm/deal-types"

export type PackageScopedLine = {
  packageId: string
  quantity: number
  unitSalePrice?: number
  lineTotal?: number
}

function whole(value: number): number {
  return Math.max(0, Math.floor(Number(value) || 0))
}

function money(value: number): number {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

export function packageIdSet(packageIds: readonly string[] | ReadonlySet<string>): ReadonlySet<string> {
  return packageIds instanceof Set ? packageIds : new Set(packageIds.filter(Boolean))
}

function lineInScope(packageId: string, packageIds: ReadonlySet<string>): boolean {
  return packageIds.size === 0 || packageIds.has(packageId)
}

/** Places on these packages only — never other products on the same deal or order. */
export function quantityForPackages(
  lines: readonly PackageScopedLine[],
  packageIds: ReadonlySet<string>,
): number {
  return lines.reduce((sum, line) => {
    if (!lineInScope(line.packageId, packageIds)) return sum
    return sum + whole(line.quantity)
  }, 0)
}

export function amountForPackages(
  lines: readonly PackageScopedLine[],
  packageIds: ReadonlySet<string>,
): number {
  return lines.reduce((sum, line) => {
    if (!lineInScope(line.packageId, packageIds)) return sum
    if (line.lineTotal != null) return sum + money(line.lineTotal)
    return sum + whole(line.quantity) * money(line.unitSalePrice ?? 0)
  }, 0)
}

export function dealLinesInScope(
  deal: Pick<PackageDealSaleRow, "lines">,
  packageIds: ReadonlySet<string>,
): PackageDealSaleLine[] {
  if (packageIds.size === 0) return deal.lines
  return deal.lines.filter((line) => packageIds.has(line.packageId))
}

export function dealQuantityForPackages(
  deal: Pick<PackageDealSaleRow, "quantity" | "lines">,
  packageIds: ReadonlySet<string>,
  currentPackageId?: string | null,
): number {
  const lines = deal.lines.map((line) => ({ packageId: line.packageId, quantity: line.quantity }))
  if (currentPackageId) {
    const own = quantityForPackages(lines, new Set([currentPackageId]))
    if (own > 0) return own
  }
  const scoped = quantityForPackages(lines, packageIds)
  if (scoped > 0) return scoped
  return packageIds.size === 0 ? whole(deal.quantity) : 0
}

export function dealAmountForPackages(
  deal: Pick<PackageDealSaleRow, "totalAmount" | "lines">,
  packageIds: ReadonlySet<string>,
  currentPackageId?: string | null,
): number {
  const lines = deal.lines.map((line) => ({
    packageId: line.packageId,
    quantity: line.quantity,
    unitSalePrice: line.unitSalePrice,
  }))
  if (currentPackageId) {
    const own = amountForPackages(lines, new Set([currentPackageId]))
    if (own > 0) return own
  }
  const scoped = amountForPackages(lines, packageIds)
  if (scoped > 0) return scoped
  return packageIds.size === 0 ? money(deal.totalAmount) : 0
}

export function orderQuantityForPackages(
  order: {
    guests: number
    package_id: string
    lines?: readonly PackageScopedLine[] | null
  },
  packageIds: ReadonlySet<string>,
  currentPackageId?: string | null,
): number {
  const lines = order.lines ?? []
  if (lines.length > 0) {
    if (currentPackageId) {
      const own = quantityForPackages(lines, new Set([currentPackageId]))
      if (own > 0) return own
    }
    return quantityForPackages(lines, packageIds)
  }
  if (currentPackageId && order.package_id === currentPackageId) return whole(order.guests)
  if (lineInScope(order.package_id, packageIds)) return whole(order.guests)
  return 0
}

export function orderAmountForPackages(
  order: {
    total_amount: number
    package_id: string
    lines?: readonly PackageScopedLine[] | null
  },
  packageIds: ReadonlySet<string>,
  currentPackageId?: string | null,
): number {
  const lines = order.lines ?? []
  if (lines.length > 0) {
    if (currentPackageId) {
      const own = amountForPackages(lines, new Set([currentPackageId]))
      if (own > 0) return own
    }
    return amountForPackages(lines, packageIds)
  }
  if (currentPackageId && order.package_id === currentPackageId) return money(order.total_amount)
  if (lineInScope(order.package_id, packageIds)) return money(order.total_amount)
  return 0
}

/**
 * Unique signed sales on a product page. Unsigned enquiries are listed for
 * context but do not increment the Orders tab. A deal that already has a
 * portal order is counted once.
 */
export function signedPackageSaleCount(input: {
  orders: readonly { id: string; deal_id: string | null; status: string }[]
  deals: readonly { id: string; orderId: string | null; stage: string }[]
}): number {
  const counted = new Set<string>()
  let total = 0
  for (const deal of input.deals) {
    if (!dealStageHasSignedBookingForm(deal.stage)) continue
    counted.add(`deal:${deal.id}`)
    if (deal.orderId) counted.add(`order:${deal.orderId}`)
    total += 1
  }
  for (const order of input.orders) {
    if (order.status === "cancelled") continue
    if (counted.has(`order:${order.id}`)) continue
    if (order.deal_id && counted.has(`deal:${order.deal_id}`)) continue
    const linked = input.deals.find(
      (deal) => deal.id === order.deal_id || deal.orderId === order.id,
    )
    if (linked && !dealStageHasSignedBookingForm(linked.stage)) continue
    counted.add(`order:${order.id}`)
    total += 1
  }
  return total
}
