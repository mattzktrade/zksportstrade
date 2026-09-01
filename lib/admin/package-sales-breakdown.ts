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
   * Open Salesforce pipeline overlay. Native signed deals count as sold instead.
   * Live Salesforce overlay may also land here on package expand.
   */
  salesforceOpenPipeline: number
  /**
   * Unsigned open deals (proposal, booking form, awaiting signature). Shown in Pipeline
   * and does not reduce Sellable.
   */
  unsignedOpenPipeline: number
  /** Trade portal and partner API bookings. Native/offline deal orders are not included. */
  tradePortal: number
  total: number
}

/** Closed-won places sold in Salesforce (excludes open pipeline). */
export function salesforceClosedWonSold(b: PackageSalesBreakdown): number {
  return Math.max(0, Math.floor(b.salesforceOffline))
}

/** Unsigned open deals shown in the Pipeline column — does not reduce Sellable. */
export function unsignedPipelinePlaces(b: PackageSalesBreakdown): number {
  return Math.max(0, Math.floor(b.unsignedOpenPipeline ?? 0))
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
  const unsigned = unsignedPipelinePlaces(b)
  if (b.total <= 0 && b.salesforceOpenPipeline <= 0 && unsigned <= 0) {
    return "No sales recorded yet"
  }
  const parts: string[] = []
  if (b.wix > 0) parts.push(`${b.wix} on website`)
  const closedWon = salesforceClosedWonSold(b)
  if (closedWon > 0) parts.push(`${closedWon} offline deals`)
  if (unsigned > 0) {
    parts.push(`${unsigned} in pipeline`)
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
    unsignedOpenPipeline: 0,
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

/** Closed-won + portal/Wix bookings — the units that count as Sold (not unsigned pipeline). */
export function packageClosedWonUnits(b: PackageSalesBreakdown): number {
  return (
    salesforceClosedWonSold(b) +
    Math.max(0, Math.floor(b.wix)) +
    Math.max(0, Math.floor(b.tradePortal))
  )
}

/** Closed-won + open pipeline + portal/Wix bookings for one package. */
export function packageCommittedUnits(b: PackageSalesBreakdown): number {
  return (
    packageClosedWonUnits(b) +
    Math.max(0, Math.floor(b.salesforceOpenPipeline))
  )
}

/** Closed-won remaining — same as Sellable with signed pipeline zeroed. */
function withoutOpenPipeline(members: readonly LinkedSellableMember[]): LinkedSellableMember[] {
  return members.map((member) => ({
    ...member,
    breakdown: {
      ...member.breakdown,
      salesforceOpenPipeline: 0,
    },
  }))
}

type LinkedPoolInput = {
  stock: number
  targetId: string
  targetDuration: string | null
  members: readonly LinkedSellableMember[]
  shellMirrorDuration?: string | null
}

export function linkedPoolClosedWonRemaining(input: LinkedPoolInput): number {
  return linkedPoolSellableForPackage({
    stock: input.stock,
    targetId: input.targetId,
    targetDuration: input.targetDuration,
    members: withoutOpenPipeline(input.members),
    shellMirrorDuration: input.shellMirrorDuration,
  })
}

/**
 * Units of the shared pool this package can no longer sell — stock minus
 * closed-won remaining. Matches the Inventory Sold box.
 *
 * Never sum sibling SKU totals: Friday-only and Sunday-only both draw from the
 * same 3-day purchase, so adding their Places Sold rows overstates 3-day Sold
 * and understates Left. 3-day Sold is the busiest-day take (Sunday + Sat&Sun).
 */
export function linkedPoolAttributedSold(input: LinkedPoolInput): number {
  const stock = Math.max(0, Math.floor(input.stock))
  return Math.max(0, stock - linkedPoolClosedWonRemaining(input))
}

/**
 * Signed pipeline that actually reduces this package's Sellable after Sold.
 * Friday-only pipeline does not hold 3-day remaining.
 */
export function linkedPoolAttributedPipeline(input: LinkedPoolInput): number {
  return Math.max(
    0,
    linkedPoolClosedWonRemaining(input) - linkedPoolSellableForPackage({
      stock: input.stock,
      targetId: input.targetId,
      targetDuration: input.targetDuration,
      members: input.members,
      shellMirrorDuration: input.shellMirrorDuration,
    }),
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
  members: readonly LinkedSellableMember[]
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

export type EffectiveSellablePackage = {
  id: string
  duration?: string | null
  inventory_group_id?: string | null
  shell_parent_package_id?: string | null
  inventory?: { qty_available?: number | null; qty_held?: number | null } | null
  layer_units_purchased?: number
  sales_breakdown: PackageSalesBreakdown
  effective_sellable?: number
  effective_net?: number
}

/**
 * Remaining after purchased stock minus committed sales.
 * Linked 3-day / 2-day / day SKUs share one purchase pool, so sibling sales
 * reduce every row. This is the number admin Live qty uses and what storefronts
 * must show — not raw package_inventory.qty_available.
 */
export function applyEffectiveSellable<T extends EffectiveSellablePackage>(rows: T[]): T[] {
  const linkedGroups = new Map<string, T[]>()
  for (const row of rows) {
    const groupId = row.inventory_group_id?.trim()
    if (!groupId || row.shell_parent_package_id) continue
    const members = linkedGroups.get(groupId) ?? []
    members.push(row)
    linkedGroups.set(groupId, members)
  }
  for (const row of rows) {
    const groupId = row.inventory_group_id?.trim()
    const groupMembers = groupId ? linkedGroups.get(groupId) ?? [] : []
    const stockSource = groupMembers.length > 1 ? groupMembers : [row]
    const purchasedStock = Math.max(
      ...stockSource.map((member) => Number(member.layer_units_purchased ?? 0)),
      0,
    )
    const stock =
      purchasedStock > 0
        ? purchasedStock
        : Math.max(0, Number(row.inventory?.qty_available ?? 0))
    if (groupMembers.length > 1) {
      const members: LinkedSellableMember[] = groupMembers.map((member) => ({
        id: member.id,
        duration: member.duration ?? null,
        breakdown: member.sales_breakdown,
      }))
      row.effective_sellable = Math.max(
        0,
        linkedPoolSellableForPackage({
          stock,
          targetId: row.id,
          targetDuration: row.duration ?? null,
          members,
        }),
      )
      row.effective_net = linkedPoolSellableForPackage({
        stock,
        targetId: row.id,
        targetDuration: row.duration ?? null,
        members: members.map((member) => ({
          ...member,
          breakdown: {
            ...member.breakdown,
            salesforceOpenPipeline: 0,
          },
        })),
      })
    } else {
      row.effective_sellable = Math.max(
        0,
        Math.floor(
          stock -
            Number(row.sales_breakdown.total ?? 0) -
            Number(row.sales_breakdown.salesforceOpenPipeline ?? 0),
        ),
      )
      row.effective_net = Math.floor(stock - Number(row.sales_breakdown.total ?? 0))
    }
  }
  return rows
}
