/**
 * Canonical Phase 1B availability equation (storefront floors at 0):
 *
 *   owned stock
 *   − committed order allocations
 *   − active manual holds
 *   − active deal reservations
 *   = available to sell
 *
 * Sourcing shortages are tracked separately and never increase sellable.
 */

export type NativeAvailabilityInput = {
  ownedStock: number
  committedOrders: number
  activeManualHolds: number
  activeDealReservations: number
  openShortageQty?: number
}

export type NativeAvailabilityBreakdown = {
  ownedStock: number
  committedOrders: number
  activeManualHolds: number
  activeDealReservations: number
  openShortageQty: number
  rawAvailable: number
  sellable: number
}

export function computeNativeAvailability(
  input: NativeAvailabilityInput,
): NativeAvailabilityBreakdown {
  const ownedStock = Math.max(0, Math.floor(input.ownedStock))
  const committedOrders = Math.max(0, Math.floor(input.committedOrders))
  const activeManualHolds = Math.max(0, Math.floor(input.activeManualHolds))
  const activeDealReservations = Math.max(0, Math.floor(input.activeDealReservations))
  const openShortageQty = Math.max(0, Math.floor(input.openShortageQty ?? 0))

  const rawAvailable =
    ownedStock - committedOrders - activeManualHolds - activeDealReservations

  return {
    ownedStock,
    committedOrders,
    activeManualHolds,
    activeDealReservations,
    openShortageQty,
    rawAvailable,
    sellable: Math.max(0, rawAvailable),
  }
}

/** Supplier quote for negative-stock confirmation must be within 24 hours of signing. */
export function isSupplierQuoteFresh(
  supplierQuoteAt: string | Date | null | undefined,
  now: Date = new Date(),
  maxAgeMs = 24 * 60 * 60 * 1000,
): boolean {
  if (supplierQuoteAt == null) return false
  const t = supplierQuoteAt instanceof Date ? supplierQuoteAt : new Date(supplierQuoteAt)
  if (Number.isNaN(t.getTime())) return false
  return now.getTime() - t.getTime() <= maxAgeMs && t.getTime() <= now.getTime() + 60_000
}

export type InventoryReconcileRow = {
  packageId: string
  isLegacyShell: boolean
  legacySellable: number
  layerUnitsRemaining: number
  activeReservations: number
  openShortageQty: number
  qtyAvailable: number
  qtyHeld: number
}

export function inventoryProjectionDrift(row: InventoryReconcileRow): number {
  if (row.isLegacyShell) return 0
  const projected = Math.max(0, row.qtyAvailable - row.qtyHeld)
  return projected - row.legacySellable
}
