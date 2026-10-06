import { mapNativePackageAvailabilityRow } from "@/lib/inventory/ledger"
import type { NativePackageAvailabilityRow } from "@/lib/inventory/ledger"

export { mapNativePackageAvailabilityRow }

export function sellableFromAvailability(row: NativePackageAvailabilityRow): number {
  return Math.max(0, Math.floor(Number(row.legacy_sellable ?? 0)))
}
