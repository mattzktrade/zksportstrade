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
 * Places on this SKU that the shared weekend purchase cannot cover.
 * Saturday-only and Sunday-only both draw from the same 2-day buy, so do not
 * add their sold totals against stock.
 */
export function linkedPoolOwnedShortage(input: LinkedPoolInput): number {
  return Math.max(0, -linkedPoolClosedWonRemaining(input))
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

const LINKED_DURATION_ORDER = [
  "3_day",
  "2_day",
  "thursday_only",
  "friday_only",
  "saturday_only",
  "sunday_only",
] as const

function linkedDaySlotsForDuration(
  duration: string | null | undefined,
  saturdayRace: boolean,
): string[] {
  if (duration === "3_day") {
    return saturdayRace
      ? ["thursday", "friday", "saturday"]
      : ["friday", "saturday", "sunday"]
  }
  if (duration === "2_day") {
    return saturdayRace ? ["friday", "saturday"] : ["saturday", "sunday"]
  }
  if (duration && LINKED_DAY_DURATIONS.has(duration)) {
    return [duration.replace(/_only$/, "")]
  }
  return []
}

/**
 * Linked-pool remaining for one package.
 *
 * Longer stays are seated first. A 3-day or 2-day row only goes negative when
 * that SKU itself sold more than the purchase. Extra single-day sales stay on
 * that day — a Sunday oversale does not mark the 3-day as −2.
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
  const duration = (input.shellMirrorDuration ?? input.targetDuration)?.trim() || null
  const saturdayRace = input.members.some((member) => member.duration === "thursday_only")
  const targetSlots = linkedDaySlotsForDuration(duration, saturdayRace)
  if (!duration || targetSlots.length === 0) {
    const self = input.members.find((member) => member.id === input.targetId)
    return self ? commitmentSellable({ stock, breakdown: self.breakdown }) : stock
  }

  const demand = new Map<string, number>()
  for (const member of input.members) {
    const memberDuration = member.duration?.trim() || ""
    if (!memberDuration) continue
    demand.set(
      memberDuration,
      (demand.get(memberDuration) ?? 0) + packageCommittedUnits(member.breakdown),
    )
  }

  const remaining = new Map<string, number>()
  for (const step of LINKED_DURATION_ORDER) {
    for (const slot of linkedDaySlotsForDuration(step, saturdayRace)) {
      if (!remaining.has(slot)) remaining.set(slot, stock)
    }
  }

  let own = 0
  for (const step of LINKED_DURATION_ORDER) {
    const stepSlots = linkedDaySlotsForDuration(step, saturdayRace)
    if (stepSlots.length === 0) continue
    const qty = demand.get(step) ?? 0
    const available = Math.min(...stepSlots.map((slot) => remaining.get(slot) ?? 0))
    if (step === duration) own = available - qty
    for (const slot of stepSlots) {
      remaining.set(slot, (remaining.get(slot) ?? 0) - qty)
    }
  }

  const leftover = Math.min(...targetSlots.map((slot) => remaining.get(slot) ?? 0))
  const soldQty = demand.get(duration) ?? 0
  if (soldQty <= 0) return leftover >= 0 ? leftover : 0
  if (own < 0) return own
  return Math.min(own, Math.max(0, leftover))
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
    const physicalStock = Math.max(0, Number(row.inventory?.qty_available ?? 0))
    const sellableStock = purchasedStock > 0 ? purchasedStock : physicalStock
    if (groupMembers.length > 1) {
      const members: LinkedSellableMember[] = groupMembers.map((member) => ({
        id: member.id,
        duration: member.duration ?? null,
        breakdown: member.sales_breakdown,
      }))
      row.effective_sellable = Math.max(
        0,
        linkedPoolSellableForPackage({
          stock: sellableStock,
          targetId: row.id,
          targetDuration: row.duration ?? null,
          members,
        }),
      )
      row.effective_net = linkedPoolSellableForPackage({
        stock: purchasedStock,
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
          sellableStock -
            Number(row.sales_breakdown.total ?? 0) -
            Number(row.sales_breakdown.salesforceOpenPipeline ?? 0),
        ),
      )
      row.effective_net = Math.floor(
        purchasedStock - Number(row.sales_breakdown.total ?? 0),
      )
    }
    const held = Math.max(0, Math.floor(Number(row.inventory?.qty_held ?? 0)))
    row.effective_sellable = Math.max(0, Math.floor(Number(row.effective_sellable) || 0) - held)
  }
  return rows
}
