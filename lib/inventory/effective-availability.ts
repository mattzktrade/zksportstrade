type EffectiveAvailabilityPackage = {
  inventory?: { qty_available: number; qty_held: number } | null
  sales_breakdown?: {
    total: number
    salesforceOpenPipeline: number
  } | null
  canonical_availability?: {
    bought: number
    available: number
    net?: number
  } | null
  layer_units_purchased?: number
  effective_sellable?: number
  effective_net?: number
}

/** Conservative sellable quantity shared by admin list, CRM, and sales views. */
export function adminPackageSellable(row: EffectiveAvailabilityPackage): number {
  if (row.effective_sellable != null) {
    return Math.max(0, Math.floor(Number(row.effective_sellable) || 0))
  }
  if (row.canonical_availability) {
    const available = Math.floor(Number(row.canonical_availability.available) || 0)
    const net =
      row.canonical_availability.net == null
        ? available
        : Math.floor(Number(row.canonical_availability.net) || 0)
    return Math.max(0, Math.min(available, net))
  }
  const legacy = Math.max(
    0,
    Number(row.inventory?.qty_available ?? 0) - Number(row.inventory?.qty_held ?? 0),
  )
  const reportedDemand =
    Math.max(0, Number(row.sales_breakdown?.total ?? 0)) +
    Math.max(0, Number(row.sales_breakdown?.salesforceOpenPipeline ?? 0))
  const bought = row.layer_units_purchased
  const reportedCapacity =
    bought == null ? Number.POSITIVE_INFINITY : Number(bought) - reportedDemand
  return Math.max(
    0,
    Math.floor(
      Math.min(
        reportedCapacity,
        legacy,
      ),
    ),
  )
}

export function adminPackageNetQuantity(row: EffectiveAvailabilityPackage): number {
  if (row.effective_net != null) {
    return Math.floor(Number(row.effective_net) || 0)
  }
  if (row.canonical_availability?.net != null) {
    return Math.floor(Number(row.canonical_availability.net) || 0)
  }
  const reportedDemand =
    Math.max(0, Number(row.sales_breakdown?.total ?? 0)) +
    Math.max(0, Number(row.sales_breakdown?.salesforceOpenPipeline ?? 0))
  const bought = row.canonical_availability?.bought ?? row.layer_units_purchased
  if (bought != null) return Math.floor(Number(bought) - reportedDemand)
  return Math.floor(
    Number(row.inventory?.qty_available ?? 0) - Number(row.inventory?.qty_held ?? 0),
  )
}

/** Confirmed sales only. Pipeline and shortage records are deliberately excluded. */
export function adminPackageSoldQuantity(row: EffectiveAvailabilityPackage): number {
  return Math.max(0, Math.floor(Number(row.sales_breakdown?.total ?? 0)))
}
