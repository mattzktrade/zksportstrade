export type PackageSalesBreakdown = {
  package_id: string
  /** Wix website checkout orders. */
  wix: number
  /** Manual Closed Won deals in Salesforce (not portal orders). */
  salesforceOffline: number
  /** Trade portal, admin, and partner API bookings. */
  tradePortal: number
  total: number
}

/** Human-readable sold-by-channel line for inventory UI. */
export function formatPackageSalesBreakdown(b: PackageSalesBreakdown): string {
  if (b.total <= 0) return "No sales recorded yet"
  const parts: string[] = []
  if (b.wix > 0) parts.push(`${b.wix} on Wix`)
  if (b.salesforceOffline > 0) parts.push(`${b.salesforceOffline} in Salesforce`)
  if (b.tradePortal > 0) parts.push(`${b.tradePortal} on trade portal`)
  return parts.join(" · ")
}

export function emptyPackageSalesBreakdown(packageId: string): PackageSalesBreakdown {
  return {
    package_id: packageId,
    wix: 0,
    salesforceOffline: 0,
    tradePortal: 0,
    total: 0,
  }
}
