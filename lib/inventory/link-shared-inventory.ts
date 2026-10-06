import { isSplittablePackageDuration } from "@/lib/catalog/inventory-group"

function durationRank(duration: string | null | undefined): number {
  const value = duration?.trim() ?? ""
  if (value === "3_day") return 3
  if (value === "2_day") return 2
  if (
    value === "thursday_only" ||
    value === "friday_only" ||
    value === "saturday_only" ||
    value === "sunday_only"
  ) {
    return 1
  }
  return 0
}

/** The shorter product joins; the 2-day/3-day product keeps the purchased stock. */
export function resolveLinkSharedInventoryRoles(input: {
  currentId: string
  currentDuration: string | null | undefined
  selectedId: string
  selectedDuration: string | null | undefined
}): { joiningId: string; shareWithId: string } {
  const currentRank = durationRank(input.currentDuration)
  const selectedRank = durationRank(input.selectedDuration)
  if (selectedRank > currentRank) {
    return { joiningId: input.currentId, shareWithId: input.selectedId }
  }
  if (currentRank > selectedRank) {
    return { joiningId: input.selectedId, shareWithId: input.currentId }
  }
  return { joiningId: input.currentId, shareWithId: input.selectedId }
}

/** Remaining qty on a product after it starts sharing another product's stock. */
export function joiningQtyAfterShare(input: {
  sourceAvailable: number
  joiningSold: number
  joiningHeld: number
}): number {
  const source = Math.max(0, Math.floor(Number(input.sourceAvailable) || 0))
  const sold = Math.max(0, Math.floor(Number(input.joiningSold) || 0))
  const held = Math.max(0, Math.floor(Number(input.joiningHeld) || 0))
  return Math.max(held, source - sold)
}

export function canLinkSharedInventory(a: string | null | undefined, b: string | null | undefined): boolean {
  return isSplittablePackageDuration(a) && isSplittablePackageDuration(b)
}

export function mapLinkSharedInventoryError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes("link_inventory_same_package")) {
    return "Choose a different product to share stock with."
  }
  if (m.includes("link_inventory_not_found")) {
    return "One of those products could not be found."
  }
  if (m.includes("link_inventory_shell")) {
    return "Single-ticket shells cannot share stock. Link the sellable day or weekend product instead."
  }
  if (m.includes("link_inventory_different_race")) {
    return "Those products are for different events, so they cannot share stock."
  }
  if (m.includes("link_inventory_duration")) {
    return "Set a day or weekend duration on both products before linking stock."
  }
  if (m.includes("link_inventory_already_sharing")) {
    return "Those products already share stock."
  }
  if (m.includes("link_inventory_already_grouped")) {
    return "That product already shares stock with a different group. Unlink it first."
  }
  if (m.includes("link_inventory_group_required")) {
    return "Could not create a shared stock key for those products."
  }
  if (m.includes("link_inventory_fulfilment_locked")) {
    return "A fulfilled or locked allocation is still on this product's own stock, so it cannot be moved yet."
  }
  if (m.includes("layer_already_consumed") || m.includes("layer_has_active_allocations")) {
    return "This product's own stock still fulfils a live sale and could not be removed safely."
  }
  if (m.includes("allocation_fulfilment_locked")) {
    return "A fulfilment-locked allocation is still on this product's own stock, so it cannot be moved yet."
  }
  return message
}
