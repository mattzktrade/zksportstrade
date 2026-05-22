import { clampToAllowedGuestCount, maxBookableGuestsFromSellable, numericSellable } from "@/lib/catalog/booking-guests"
import type { Package } from "@/lib/types/catalog"

export type AdminPlaceOrderPackageOption = {
  id: string
  name: string
  circuit: string
  dateRange: string
  price: number
  currency: string
  sellable: number
}

export function toAdminPlaceOrderPackageOptions(packages: Package[]): AdminPlaceOrderPackageOption[] {
  const options: AdminPlaceOrderPackageOption[] = []
  for (const pkg of packages) {
    if (pkg.price === null || typeof pkg.availability === "string") continue
    options.push({
      id: pkg.id,
      name: pkg.name,
      circuit: pkg.circuit,
      dateRange: pkg.dateRange,
      price: pkg.price,
      currency: pkg.currency || "USD",
      sellable: pkg.availability,
    })
  }
  return options.sort((a, b) => a.circuit.localeCompare(b.circuit) || a.name.localeCompare(b.name))
}

export function maxBookableGuests(pkg: Package | null): number {
  if (!pkg || pkg.price === null) return 0
  const sellable = numericSellable(pkg.availability)
  if (sellable === null) return 0
  return maxBookableGuestsFromSellable(sellable, pkg.totalCapacity)
}

export function clampBookableGuests(pkg: Package | null, preferred: number): number {
  if (!pkg || pkg.price === null) return 1
  const sellable = numericSellable(pkg.availability)
  if (sellable === null || sellable < 1) return 1
  const cap = maxBookableGuestsFromSellable(sellable, pkg.totalCapacity)
  if (cap < 1) return 1
  return clampToAllowedGuestCount(Math.min(sellable, cap), preferred)
}
