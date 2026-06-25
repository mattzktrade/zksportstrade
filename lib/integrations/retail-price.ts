/**
 * Public / Wix price from trade price.
 * Set RETAIL_PRICE_MULTIPLIER=1.10 for +10% on website; use 1 to match trade.
 */
export function getRetailPriceMultiplier(): number {
  const raw = process.env.RETAIL_PRICE_MULTIPLIER?.trim()
  if (!raw) return 1.1
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 1.1
  return n
}

/** Per-package override wins when set on packages.retail_price_multiplier */
export function resolveRetailPriceMultiplier(packageOverride: number | null | undefined): number {
  if (packageOverride != null && Number.isFinite(packageOverride) && packageOverride > 0) {
    return packageOverride
  }
  return getRetailPriceMultiplier()
}

export function retailPriceFromTrade(
  tradePrice: number | null | undefined,
  packageOverride?: number | null,
  manualRetailPrice?: number | null,
): number | null {
  if (manualRetailPrice != null && Number.isFinite(manualRetailPrice) && manualRetailPrice >= 0) {
    return Math.round(manualRetailPrice * 100) / 100
  }
  if (tradePrice == null || !Number.isFinite(tradePrice)) return null
  const mult = resolveRetailPriceMultiplier(packageOverride)
  const rounded = Math.round(tradePrice * mult * 100) / 100
  return rounded
}
