export type PackageSalesBreakdown = {
  package_id: string
  /** Wix website checkout orders. */
  wix: number
  /**
   * Closed Won Salesforce deals recorded in the portal (offline applications table).
   * Does not include open pipeline opportunities — see `salesforceOpenPipeline`.
   */
  salesforceOffline: number
  /**
   * Open (non-closed) Salesforce opportunity line quantities on this package's Product2.
   * Populated on package detail pages from live SF reads; 0 on fast catalog list loads.
   */
  salesforceOpenPipeline: number
  /** Trade portal, admin, and partner API bookings. */
  tradePortal: number
  total: number
}

/** Closed-won places sold in Salesforce (excludes open pipeline). */
export function salesforceClosedWonSold(b: PackageSalesBreakdown): number {
  return Math.max(0, Math.floor(b.salesforceOffline))
}

/**
 * Closed-won offline + open pipeline — useful for capacity / commitment views.
 * Prefer {@link salesforceClosedWonSold} when showing actual sold units.
 */
export function salesforcePlacesSold(b: PackageSalesBreakdown): number {
  return Math.max(0, Math.floor(b.salesforceOffline) + Math.floor(b.salesforceOpenPipeline))
}

/**
 * Units still free after closed-won sales, open SF pipeline, and portal/Wix bookings.
 * Can be negative when oversold (pipeline + sold exceed stock) — admin UI shows that;
 * storefronts / Wix / Salesforce Available must still use max(0, …).
 */
export function commitmentSellable(input: {
  stock: number
  breakdown: PackageSalesBreakdown
}): number {
  const stock = Math.max(0, Math.floor(input.stock))
  const closedWon = salesforceClosedWonSold(input.breakdown)
  const pipeline = Math.max(0, Math.floor(input.breakdown.salesforceOpenPipeline))
  const portal =
    Math.max(0, Math.floor(input.breakdown.wix)) +
    Math.max(0, Math.floor(input.breakdown.tradePortal))
  return stock - closedWon - pipeline - portal
}

/** Human-readable sold-by-channel line for inventory UI. */
export function formatPackageSalesBreakdown(b: PackageSalesBreakdown): string {
  if (b.total <= 0 && b.salesforceOpenPipeline <= 0) return "No sales recorded yet"
  const parts: string[] = []
  if (b.wix > 0) parts.push(`${b.wix} on website`)
  const closedWon = salesforceClosedWonSold(b)
  if (closedWon > 0) parts.push(`${closedWon} offline deals`)
  if (b.salesforceOpenPipeline > 0) {
    parts.push(`${Math.floor(b.salesforceOpenPipeline)} in pipeline`)
  }
  if (b.tradePortal > 0) parts.push(`${b.tradePortal} on portal`)
  return parts.join(" · ")
}

export function emptyPackageSalesBreakdown(packageId: string): PackageSalesBreakdown {
  return {
    package_id: packageId,
    wix: 0,
    salesforceOffline: 0,
    salesforceOpenPipeline: 0,
    tradePortal: 0,
    total: 0,
  }
}

const LINKED_DAY_DURATIONS = new Set([
  "thursday_only",
  "friday_only",
  "saturday_only",
  "sunday_only",
])

export type LinkedSellableMember = {
  id: string
  duration: string | null
  breakdown: PackageSalesBreakdown
}

/** Closed-won + open pipeline + portal/Wix bookings for one package. */
export function packageCommittedUnits(b: PackageSalesBreakdown): number {
  return (
    Math.max(0, Math.floor(b.salesforceOffline)) +
    Math.max(0, Math.floor(b.salesforceOpenPipeline)) +
    Math.max(0, Math.floor(b.wix)) +
    Math.max(0, Math.floor(b.tradePortal))
  )
}

/**
 * Linked-pool Remaining for one package — same rules as inventory sync:
 * - day package: stock − 3-day commitments − that day's commitments (− 2-day on Sat/Sun)
 * - 3-day: min(Fri, Sat, Sun) remainings
 * - Sat&Sun (2-day): min(Sat, Sun), which already includes 2-day sales
 * - shell: mirrors its day sibling (or 3-day when no sellable day exists)
 *
 * Never sum every sibling's pipeline onto every row (that produced false "191" for Velocity).
 */
export function linkedPoolSellableForPackage(input: {
  stock: number
  targetId: string
  targetDuration: string | null
  members: LinkedSellableMember[]
  /** Shells pass the day duration they mirror (friday_only / …). */
  shellMirrorDuration?: string | null
}): number {
  const stock = Math.max(0, Math.floor(input.stock))
  const threeDay = input.members.find((m) => m.duration === "3_day")
  const threeDayCommitted = threeDay ? packageCommittedUnits(threeDay.breakdown) : 0
  const twoDay = input.members.find((m) => m.duration === "2_day")
  const twoDayCommitted = twoDay ? packageCommittedUnits(twoDay.breakdown) : 0

  const dayRemaining = (duration: string): number | null => {
    const day = input.members.find((m) => m.duration === duration && m.id !== threeDay?.id)
    if (!day) return null
    const weekendTake =
      duration === "saturday_only" || duration === "sunday_only" ? twoDayCommitted : 0
    return stock - threeDayCommitted - packageCommittedUnits(day.breakdown) - weekendTake
  }

  const duration = (input.shellMirrorDuration ?? input.targetDuration)?.trim() || null

  if (duration === "3_day") {
    const days = ["thursday_only", "friday_only", "saturday_only", "sunday_only"]
      .map((d) => dayRemaining(d))
      .filter((n): n is number => n != null)
    if (days.length === 0) return stock - threeDayCommitted - twoDayCommitted
    return Math.min(...days)
  }

  if (duration === "2_day") {
    const sat = dayRemaining("saturday_only")
    const sun = dayRemaining("sunday_only")
    if (sat != null && sun != null) return Math.min(sat, sun)
    if (sat != null) return sat
    if (sun != null) return sun
    return stock - threeDayCommitted - twoDayCommitted
  }

  if (duration && LINKED_DAY_DURATIONS.has(duration)) {
    const own =
      input.members.find((m) => m.id === input.targetId) ??
      input.members.find((m) => m.duration === duration)
    if (!own) return stock - threeDayCommitted - twoDayCommitted
    const weekendTake =
      duration === "saturday_only" || duration === "sunday_only" ? twoDayCommitted : 0
    return stock - threeDayCommitted - packageCommittedUnits(own.breakdown) - weekendTake
  }

  const self = input.members.find((m) => m.id === input.targetId)
  return self ? commitmentSellable({ stock, breakdown: self.breakdown }) : stock
}
