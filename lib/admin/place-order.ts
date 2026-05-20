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
  if (!pkg || pkg.price === null || typeof pkg.availability === "string") return 0
  return Math.max(0, Math.min(pkg.availability, pkg.totalCapacity))
}
