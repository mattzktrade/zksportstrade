/** When sellable stock is at or below this, bookings cannot leave exactly one place remaining. */
export const LOW_STOCK_NO_LEAVE_ONE_THRESHOLD = 5

export function numericSellable(availability: number | string): number | null {
  if (typeof availability !== "number" || !Number.isFinite(availability)) return null
  return Math.max(0, Math.floor(availability))
}

/** True when the low-stock rule applies (cannot leave exactly 1 unsold). */
export function appliesNoLeaveOneRule(sellable: number): boolean {
  return sellable > 0 && sellable <= LOW_STOCK_NO_LEAVE_ONE_THRESHOLD
}

export function isGuestCountAllowed(sellable: number, guests: number): boolean {
  const g = Math.floor(guests)
  if (!Number.isFinite(g) || g < 1 || g > sellable) return false
  if (!appliesNoLeaveOneRule(sellable)) return true
  return sellable - g !== 1
}

export function getAllowedGuestCounts(sellable: number): number[] {
  const cap = Math.max(0, Math.floor(sellable))
  const counts: number[] = []
  for (let g = 1; g <= cap; g++) {
    if (isGuestCountAllowed(cap, g)) counts.push(g)
  }
  return counts
}

export function clampToAllowedGuestCount(sellable: number, preferred: number): number {
  const allowed = getAllowedGuestCounts(sellable)
  if (allowed.length === 0) return 1
  const p = Math.floor(preferred)
  if (allowed.includes(p)) return p
  const atOrBelow = allowed.filter((g) => g <= p)
  if (atOrBelow.length > 0) return Math.max(...atOrBelow)
  return allowed[0]
}

export function stepAllowedGuestCount(
  sellable: number,
  current: number,
  direction: "up" | "down",
): number {
  const allowed = getAllowedGuestCounts(sellable)
  if (allowed.length === 0) return 1
  const cur = clampToAllowedGuestCount(sellable, current)
  const idx = allowed.indexOf(cur)
  if (idx === -1) return allowed[0]
  if (direction === "up") return allowed[Math.min(idx + 1, allowed.length - 1)]
  return allowed[Math.max(idx - 1, 0)]
}

export function maxBookableGuestsFromSellable(sellable: number, totalCapacity: number): number {
  const s = numericSellable(sellable) ?? 0
  return Math.max(0, Math.min(s, Math.max(0, Math.floor(totalCapacity))))
}

export function lowStockGuestHint(sellable: number): string | null {
  if (!appliesNoLeaveOneRule(sellable) || sellable <= 1) return null
  return "When only a few places remain, you cannot book a quantity that would leave a single place unsold. Choose a smaller group or book all remaining places."
}
