import type { SupabaseClient } from "@supabase/supabase-js"
import { getSalesforceConfig, isSalesforceConfigured, type SalesforceConfig } from "@/lib/integrations/salesforce/config"
import {
  isUninitializedSfInventorySnapshot,
  linkedPoolStockQuantity,
  readSfInventorySnapshotsBulk,
  salesforceTargetSellable,
  type SfInventorySnapshot,
} from "@/lib/integrations/salesforce/inventory-snapshot"
import {
  readCommittedQuantityByProductBulk,
  readWonQuantityByProductBulk,
} from "@/lib/integrations/salesforce/sold-metrics"
import {
  getSalesforceConnectionStatus,
  getStoredInstanceUrl,
} from "@/lib/integrations/salesforce/settings-store"
import { pushLinkedGroupAvailabilityToSalesforce } from "@/lib/inventory/linked-group-sf-push"
import { resolveShellInventorySource } from "@/lib/catalog/ensure-shell-single-tickets"
import { createAdminClient } from "@/lib/supabase/admin"

type GroupMember = {
  id: string
  name: string
  duration: string | null
  salesforce_product_id: string | null
  shell_parent_package_id: string | null
  package_inventory?: { qty_available: number | null; qty_held: number | null } | Array<{
    qty_available: number | null
    qty_held: number | null
  }> | null
}

const DAY_DURATIONS = new Set([
  "thursday_only",
  "friday_only",
  "saturday_only",
  "sunday_only",
])

function inventoryRow(raw: GroupMember["package_inventory"]) {
  return Array.isArray(raw) ? raw[0] : raw
}

/** Bulk portal + offline sold for linked-group members (avoids per-row catch → 0 drops). */
async function loadPortalSoldByPackageIds(
  admin: SupabaseClient,
  packageIds: readonly string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const ids = [...new Set(packageIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return result

  const { data: orders, error: orderErr } = await admin
    .from("orders")
    .select("package_id, guests")
    .in("package_id", ids)
    .neq("status", "cancelled")
  if (orderErr) {
    console.warn("[linked-inventory] portal sold orders query failed:", orderErr.message)
  } else {
    for (const row of orders ?? []) {
      const id = String((row as { package_id: string }).package_id ?? "").trim()
      if (!id) continue
      const guests = Math.max(0, Math.floor(Number((row as { guests: number | null }).guests) || 0))
      result.set(id, (result.get(id) ?? 0) + guests)
    }
  }

  const { data: offline, error: offlineErr } = await admin
    .from("salesforce_offline_sale_applications")
    .select("package_id, quantity")
    .in("package_id", ids)
  if (offlineErr) {
    console.warn("[linked-inventory] portal sold offline query failed:", offlineErr.message)
  } else {
    for (const row of offline ?? []) {
      const id = String((row as { package_id: string }).package_id ?? "").trim()
      if (!id) continue
      const qty = Math.max(0, Math.floor(Number((row as { quantity: number | null }).quantity) || 0))
      result.set(id, (result.get(id) ?? 0) + qty)
    }
  }

  return result
}

export type LinkedGroupSyncRow = {
  id: string
  name: string
  duration: string | null
  sellable: number
}

type InventoryTarget = {
  package_id: string
  qty_available: number
  sellable: number
  name: string
  duration: string | null
}

function isMissingBulkSyncRpc(error: { message?: string; code?: string }): boolean {
  const message = error.message ?? ""
  return (
    error.code === "42883" ||
    message.includes("apply_linked_group_inventory_sync") ||
    message.includes("does not exist")
  )
}

function resolveLinkedDaySellable(input: {
  poolStock: number | null
  threeDayCommitted: number
  dayCommitted: number
  snapshot: SfInventorySnapshot
}): number | null {
  // When poolStock is known, always use it — never fall back to the day product's own
  // Stock. Day products in a linked pool have Stock rolled up by Salesforce workflows
  // that momentarily lag behind the 3-day parent (a transient SF read of dayStock=22
  // would otherwise produce sellable = 22 − 8 = 14 for Hungary Fri/Sat).
  //
  // Committed = Closed Won + open pipeline on the 3-day and this day. Open pipeline
  // holds stock until Closed Lost; result is floored at 0 for DB / storefronts.
  if (input.poolStock != null && input.poolStock > 0) {
    return Math.max(0, input.poolStock - input.threeDayCommitted - input.dayCommitted)
  }
  // Without a poolStock we cannot compute pool sellable safely. Return null so the
  // caller skips this member — cron will retry with a fresh parent snapshot.
  return null
}

async function applyLinkedGroupInventoryTargets(
  admin: SupabaseClient,
  groupId: string,
  targets: InventoryTarget[],
): Promise<void> {
  if (targets.length === 0) return

  const payload = targets.map((t) => ({
    package_id: t.package_id,
    qty_available: t.qty_available,
  }))
  if (process.env.ZK_LINKED_TRACE === "1" && groupId.includes("hungary")) {
    console.log(
      `[linked-sync] APPLY ${groupId} targets=${JSON.stringify(payload)}`,
    )
  }
  const { error: bulkErr } = await admin.rpc("apply_linked_group_inventory_sync", {
    p_group_id: groupId,
    p_targets: payload,
  })
  if (bulkErr) {
    if (isMissingBulkSyncRpc(bulkErr)) {
      throw new Error(
        "apply_linked_group_inventory_sync is missing or outdated. Run the SQL in " +
          "supabase/migrations/20260702180000_drop_linked_reconcile_trigger.sql " +
          "(or: npx tsx scripts/apply-linked-trigger-fix.ts with SUPABASE_DB_URL set).",
      )
    }
    throw new Error(`Bulk inventory sync failed: ${bulkErr.message}`)
  }
}

/**
 * Sum of `package_cost_layers.quantity` for the 3-day parent. This is the portal's DB-authoritative
 * "how many units of this pool exist" — it changes only when admins add/remove stock through the
 * cost-layer UI.
 */
async function readCostLayerPoolQuantity(
  admin: SupabaseClient,
  threeDayPackageId: string,
): Promise<number | null> {
  if (!threeDayPackageId) return null
  const { data, error } = await admin
    .from("package_cost_layers")
    .select("quantity")
    .eq("package_id", threeDayPackageId)
  if (error) return null
  const total = (data ?? []).reduce((sum, r) => sum + Number((r as { quantity: unknown }).quantity ?? 0), 0)
  return Number.isFinite(total) && total > 0 ? Math.floor(total) : null
}

/**
 * Resolve linked-group pool stock.
 *
 * Cost layers win whenever present so deleting stock purchases reduces the pool.
 * Previously `max(SF, layers)` re-inflated portal qty from stale Salesforce Stock after
 * admins removed layers (e.g. Singapore Velocity Terrace stuck at 182 after deleting +32).
 *
 * Keep a higher SF stock only when layers cannot cover closed-won (purchases recorded
 * outside the portal).
 */
export function resolveLinkedPoolStock(input: {
  sfPoolStock: number | null
  costLayerPool: number | null
  closedWonSold?: number
}): number | null {
  const sf =
    input.sfPoolStock != null && Number.isFinite(input.sfPoolStock)
      ? Math.max(0, Math.floor(input.sfPoolStock))
      : null
  const layers =
    input.costLayerPool != null && Number.isFinite(input.costLayerPool)
      ? Math.max(0, Math.floor(input.costLayerPool))
      : null
  const won = Math.max(0, Math.floor(input.closedWonSold ?? 0))

  if (layers != null && layers > 0) {
    if (sf != null && sf > layers && layers < won) return sf
    return layers
  }
  return sf
}

/**
 * Per-group in-process mutex. Multiple concurrent callers for the same linked group share
 * the same in-flight sync — this is what stops N=8 concurrent page loads from racing on
 * Salesforce PATCHes and occasionally reading a transient Stock=0 in the middle of a write.
 *
 * Different groups still sync in parallel — the mutex is keyed by group id.
 */
type SyncResult = { updated: LinkedGroupSyncRow[]; threeDaySellable: number | null }
const inFlightGroupSync = new Map<string, Promise<SyncResult>>()

async function runWithGroupMutex<T extends SyncResult>(
  groupId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = groupId.trim()
  if (!key) return fn()
  const existing = inFlightGroupSync.get(key)
  if (existing) {
    return existing as Promise<T>
  }
  const promise = (async () => {
    try {
      return await fn()
    } finally {
      inFlightGroupSync.delete(key)
    }
  })()
  inFlightGroupSync.set(key, promise)
  return promise as Promise<T>
}

async function mirrorShellPortalInventory(
  admin: SupabaseClient,
  threeDayPackageId: string,
  daySellables: Map<string, number>,
): Promise<void> {
  const { data: shells, error } = await admin
    .from("packages")
    .select("id")
    .eq("shell_parent_package_id", threeDayPackageId)
  if (error) throw new Error(error.message)

  for (const raw of shells ?? []) {
    const shellId = (raw as { id: string }).id?.trim()
    if (!shellId) continue
    const source = await resolveShellInventorySource(admin, shellId).catch(() => null)
    if (!source) continue
    const sellable =
      daySellables.get(source.qtyAvailablePackageId) ??
      daySellables.get(threeDayPackageId)
    if (sellable == null) continue
    if (process.env.ZK_LINKED_TRACE === "1" && shellId.includes("hungary")) {
      console.log(
        `[linked-sync] SHELL MIRROR shell=${shellId} source=${source.qtyAvailablePackageId} sellable=${sellable}`,
      )
    }
    const { data: shellInv } = await admin
      .from("package_inventory")
      .select("qty_held")
      .eq("package_id", shellId)
      .maybeSingle()
    const held = Math.max(0, Math.floor(Number(shellInv?.qty_held) || 0))
    await admin
      .from("package_inventory")
      .update({ qty_available: Math.max(held, sellable + held) })
      .eq("package_id", shellId)
  }
}

/**
 * Linked 3-day inventory in the portal mirrors Salesforce — each **day** package reads its
 * own Product2 Available. The 3-day (and 2-day) row is then set to min(day siblings) via
 * `reconcile_linked_multi_day_inventory`, not from the 3-day Product2 directly.
 *
 * Concurrent callers for the same group share a single in-flight sync via `runWithGroupMutex`
 * — that eliminates the race where 8 parallel heals stomped Hungary to zero.
 */
export async function syncLinkedGroupInventoryFromSalesforce(
  admin: SupabaseClient,
  inventoryGroupId: string,
  config: SalesforceConfig,
): Promise<{ updated: LinkedGroupSyncRow[]; threeDaySellable: number | null }> {
  const groupId = inventoryGroupId.trim()
  if (!groupId) return { updated: [], threeDaySellable: null }
  return runWithGroupMutex(groupId, () =>
    syncLinkedGroupInventoryFromSalesforceInner(admin, groupId, config),
  )
}

async function syncLinkedGroupInventoryFromSalesforceInner(
  admin: SupabaseClient,
  groupId: string,
  config: SalesforceConfig,
): Promise<{ updated: LinkedGroupSyncRow[]; threeDaySellable: number | null }> {

  const { data: rows, error } = await admin
    .from("packages")
    .select(
      "id, name, duration, salesforce_product_id, shell_parent_package_id, package_inventory ( qty_available, qty_held )",
    )
    .eq("inventory_group_id", groupId)
  if (error) throw new Error(error.message)

  const members = (rows ?? []).filter(
    (r) => !(r as GroupMember).shell_parent_package_id,
  ) as GroupMember[]
  if (members.length === 0) return { updated: [], threeDaySellable: null }

  const dayMembers = members.filter((m) => DAY_DURATIONS.has(m.duration ?? ""))
  const threeDayMember = members.find((m) => m.duration === "3_day")
  const threeDayProduct2Id = threeDayMember?.salesforce_product_id?.trim() ?? ""

  const productIds = [
    ...new Set(
      [
        ...dayMembers.map((m) => m.salesforce_product_id?.trim() ?? ""),
        threeDayProduct2Id,
      ].filter((id) => id.length > 0),
    ),
  ]
  const snapshots = await readSfInventorySnapshotsBulk(productIds, config)
  // Committed = Closed Won + open (non-lost) pipeline. Pipeline holds Remaining until
  // Closed Lost. Portal sellable and Salesforce Available both use this math so live
  // stock matches across portal / Wix / Salesforce. Quantity_Sold is not written by us.
  const [wonByProduct, committedByProduct] = await Promise.all([
    readWonQuantityByProductBulk(productIds, config.opportunityStageWon),
    readCommittedQuantityByProductBulk(productIds, config.opportunityStageLost),
  ])
  const openByProduct = new Map<string, number>()
  for (const id of productIds) {
    const open = Math.max(0, (committedByProduct.get(id) ?? 0) - (wonByProduct.get(id) ?? 0))
    if (open > 0) openByProduct.set(id, open)
  }

  const parentSnapshot = threeDayProduct2Id ? snapshots.get(threeDayProduct2Id) : null
  const sfPoolStock = linkedPoolStockQuantity(parentSnapshot)
  const costLayerPool = threeDayMember?.id
    ? await readCostLayerPoolQuantity(admin, threeDayMember.id)
    : null

  // Portal bookings decrement inventory immediately; Salesforce opportunity lines can lag.
  // Bulk-load sold so a single failed readLocalSold call cannot silently drop Sunday sales.
  const portalSoldByPackage = await loadPortalSoldByPackageIds(
    admin,
    members.map((m) => m.id),
  )

  const threeDayWon = threeDayProduct2Id ? wonByProduct.get(threeDayProduct2Id) ?? 0 : 0
  const threeDayOpen = threeDayProduct2Id ? openByProduct.get(threeDayProduct2Id) ?? 0 : 0
  const threeDayPortalSold = threeDayMember?.id ? portalSoldByPackage.get(threeDayMember.id) ?? 0 : 0
  const threeDayCommitted = Math.max(threeDayWon + threeDayOpen, threeDayPortalSold)
  const poolStock = resolveLinkedPoolStock({
    sfPoolStock,
    costLayerPool,
    closedWonSold: Math.max(threeDayWon, threeDayPortalSold),
  })

  if (process.env.ZK_LINKED_TRACE === "1") {
    console.log(
      `[linked-sync] group=${groupId} sfPool=${sfPoolStock} costPool=${costLayerPool} effPool=${poolStock} won3day=${threeDayWon} open3day=${threeDayOpen} portal3day=${threeDayPortalSold} portalSold=${JSON.stringify(Object.fromEntries(portalSoldByPackage))}`,
    )
  }

  const updated: LinkedGroupSyncRow[] = []
  const targets: InventoryTarget[] = []
  /** Portal + Salesforce Remaining: stock − (3-day committed + day committed). */
  const daySellables = new Map<string, number>()

  for (const member of dayMembers) {
    const product2Id = member.salesforce_product_id?.trim() ?? ""
    const snapshot = product2Id ? snapshots.get(product2Id) : undefined

    const held = Math.max(0, Math.floor(Number(inventoryRow(member.package_inventory)?.qty_held) || 0))
    const currentAvail = Math.max(0, Math.floor(Number(inventoryRow(member.package_inventory)?.qty_available) || 0))
    const currentSellable = Math.max(0, currentAvail - held)

    const dayWon = product2Id ? wonByProduct.get(product2Id) ?? 0 : 0
    const dayOpen = product2Id ? openByProduct.get(product2Id) ?? 0 : 0
    const dayPortalSold = portalSoldByPackage.get(member.id) ?? 0
    // Do not use SF Closed Won on day Product2 for pool math. Salesforce often mirrors
    // the 3-day Quantity Sold onto Fri/Sat/Sun (or OLI rollups), which would wrongly
    // cut sellable (e.g. Fri → 15−6−6=3 instead of 9). Portal local sold + SF open
    // pipeline on this day are authoritative for day consumption.
    const dayCommitted = dayPortalSold + dayOpen

    // When cost-layer pool is known, portal sold is enough — do not skip the day just
    // because the Product2 snapshot failed (that left Sunday stuck at 9 while Fri/Sat
    // healed, and SF Available still looked right via Stock Source formulas).
    if (poolStock != null && poolStock > 0) {
      let sellable = Math.max(0, poolStock - threeDayCommitted - dayCommitted)
      // Never raise above portal-implied remaining (ignores SF day Closed Won mirrors).
      const portalImplied = Math.max(0, poolStock - threeDayPortalSold - dayPortalSold)
      sellable = Math.min(sellable, portalImplied)
      if (process.env.ZK_LINKED_TRACE === "1") {
        console.log(
          `[linked-sync]   day ${member.id.padEnd(50)} sellable=${sellable} (held=${held}, dayWon=${dayWon}, dayOpen=${dayOpen}, dayPortal=${dayPortalSold}, pool=${poolStock}, threeDayCommitted=${threeDayCommitted}, portalImplied=${portalImplied})`,
        )
      }
      daySellables.set(member.id, sellable)
      targets.push({
        package_id: member.id,
        qty_available: sellable + held,
        sellable,
        name: member.name,
        duration: member.duration,
      })
      updated.push({
        id: member.id,
        name: member.name,
        duration: member.duration,
        sellable,
      })
      continue
    }

    if (!product2Id || !snapshot) continue

    if (isUninitializedSfInventorySnapshot(snapshot) && currentSellable > 0 && dayPortalSold <= 0) {
      updated.push({
        id: member.id,
        name: member.name,
        duration: member.duration,
        sellable: currentSellable,
      })
      daySellables.set(member.id, currentSellable)
      continue
    }

    const sellable = resolveLinkedDaySellable({
      poolStock,
      threeDayCommitted,
      dayCommitted,
      snapshot,
    })
    if (sellable == null) continue

    if (process.env.ZK_LINKED_TRACE === "1") {
      console.log(
        `[linked-sync]   day ${member.id.padEnd(50)} sellable=${sellable} (held=${held}, dayWon=${dayWon}, dayOpen=${dayOpen}, dayPortal=${dayPortalSold})`,
      )
    }

    daySellables.set(member.id, sellable)
    targets.push({
      package_id: member.id,
      qty_available: sellable + held,
      sellable,
      name: member.name,
      duration: member.duration,
    })
    updated.push({
      id: member.id,
      name: member.name,
      duration: member.duration,
      sellable,
    })
  }

  // 3-day-only groups (Single Ticket shells are excluded from inventory_group_id). Read stock
  // directly from the 3-day Product2 — there are no sellable day siblings to min() against.
  if (dayMembers.length === 0 && threeDayMember?.id && parentSnapshot) {
    const held = Math.max(0, Math.floor(Number(inventoryRow(threeDayMember.package_inventory)?.qty_held) || 0))
    const currentAvail = Math.max(
      0,
      Math.floor(Number(inventoryRow(threeDayMember.package_inventory)?.qty_available) || 0),
    )
    const currentSellable = Math.max(0, currentAvail - held)

    let sellable: number | null = null
    if (isUninitializedSfInventorySnapshot(parentSnapshot) && currentSellable > 0) {
      sellable = currentSellable
    } else if (poolStock != null && poolStock > 0) {
      // Prefer commitment math over Product2 Available — Available may lag or be formula-corrupt.
      sellable = Math.max(0, poolStock - threeDayCommitted)
    } else {
      sellable = salesforceTargetSellable(parentSnapshot)
      if (sellable == null && parentSnapshot.stock != null && parentSnapshot.stock > 0) {
        sellable = Math.max(0, Math.floor(parentSnapshot.stock) - threeDayCommitted)
      }
    }

    if (sellable != null) {
      daySellables.set(threeDayMember.id, sellable)
      updated.push({
        id: threeDayMember.id,
        name: threeDayMember.name,
        duration: threeDayMember.duration,
        sellable,
      })
      if (sellable !== currentSellable) {
        targets.push({
          package_id: threeDayMember.id,
          qty_available: sellable + held,
          sellable,
          name: threeDayMember.name,
          duration: threeDayMember.duration,
        })
      }
    }
  }

  // Safety net: a SF PATCH from a concurrent caller can leave Salesforce transiently reporting
  // Stock=0 for a Product2. If poolStock was > 0 for THIS caller, we can trust its targets.
  // But if poolStock was null/0 AND every computed target is 0 AND the DB currently has any
  // sellable stock, refuse to wipe it — the stale SF read is not authoritative.
  const wouldWipe =
    targets.length > 0 &&
    targets.every((t) => t.sellable === 0) &&
    (poolStock == null || poolStock <= 0)
  if (wouldWipe) {
    const anyCurrentSellable = dayMembers.some((m) => {
      const inv = inventoryRow(m.package_inventory)
      return portalSellable(inv?.qty_available, inv?.qty_held) > 0
    })
    if (anyCurrentSellable) {
      console.warn(
        `[linked-inventory] refusing to wipe group ${groupId} to zero — Salesforce read likely stale (poolStock=${poolStock}).`,
      )
      return { updated: [], threeDaySellable: null }
    }
  }

  if (targets.length > 0) {
    await applyLinkedGroupInventoryTargets(admin, groupId, targets)
  }

  const threeDay = members.find((m) => m.duration === "3_day")
  if (threeDay?.id && daySellables.size > 0) {
    await mirrorShellPortalInventory(admin, threeDay.id, daySellables)
  }

  let threeDaySellable: number | null = null
  if (threeDay) {
    // Prefer min(day sellables) we just computed — do not trust a stale DB row if reconcile lagged.
    const computedDayVals = [...daySellables.entries()]
      .filter(([id]) => dayMembers.some((m) => m.id === id))
      .map(([, v]) => v)
    const expectedThreeDay =
      computedDayVals.length > 0 ? Math.min(...computedDayVals) : null

    const { data: inv } = await admin
      .from("package_inventory")
      .select("qty_available, qty_held")
      .eq("package_id", threeDay.id)
      .maybeSingle()
    const held = inv ? Math.max(0, Math.floor(Number(inv.qty_held ?? 0))) : 0
    const dbSellable = inv
      ? Math.max(0, Math.max(0, Math.floor(Number(inv.qty_available ?? 0))) - held)
      : null

    threeDaySellable = expectedThreeDay != null ? expectedThreeDay : dbSellable

    if (
      threeDaySellable != null &&
      expectedThreeDay != null &&
      (dbSellable == null || dbSellable !== expectedThreeDay)
    ) {
      await applyLinkedGroupInventoryTargets(admin, groupId, [
        {
          package_id: threeDay.id,
          qty_available: threeDaySellable + held,
          sellable: threeDaySellable,
          name: threeDay.name,
          duration: threeDay.duration,
        },
      ])
    }

    if (threeDaySellable != null) {
      daySellables.set(threeDay.id, threeDaySellable)
      updated.push({
        id: threeDay.id,
        name: threeDay.name,
        duration: threeDay.duration,
        sellable: threeDaySellable,
      })
    }
  }

  const twoDay = members.find((m) => m.duration === "2_day")
  if (twoDay) {
    const { data: inv } = await admin
      .from("package_inventory")
      .select("qty_available, qty_held")
      .eq("package_id", twoDay.id)
      .maybeSingle()
    if (inv) {
      const avail = Math.max(0, Math.floor(Number(inv.qty_available ?? 0)))
      const held = Math.max(0, Math.floor(Number(inv.qty_held ?? 0)))
      const twoDaySellable = Math.max(0, avail - held)
      daySellables.set(twoDay.id, twoDaySellable)
      updated.push({
        id: twoDay.id,
        name: twoDay.name,
        duration: twoDay.duration,
        sellable: twoDaySellable,
      })
    }
  }

  await admin
    .from("packages")
    .update({ integration_sync_status: "synced", integration_sync_error: null })
    .in(
      "id",
      members.map((m) => m.id),
    )

  // Re-assert portal qty from local orders BEFORE any Salesforce writes. SF Available is a
  // writable field whose companion Quantity_Sold__c is a formula (Stock − Available). Stock
  // Source child upserts can fire PackageInventoryManager and snap Available back to
  // Stock − open-pipeline (9). Portal must not follow that — portal sold is authoritative.
  try {
    await reconcileLinkedGroupFromPortalSales(admin, groupId)
  } catch (e) {
    console.warn(
      "[linked-inventory] portal reassert before SF push failed:",
      e instanceof Error ? e.message : e,
    )
  }

  // Refresh sellables from DB after reassert (daySellables map may predate reconcile).
  const pushSellables = new Map<string, number>(daySellables)
  {
    const { data: invRows } = await admin
      .from("packages")
      .select("id, duration, shell_parent_package_id, package_inventory ( qty_available, qty_held )")
      .eq("inventory_group_id", groupId)
    for (const raw of invRows ?? []) {
      const row = raw as GroupMember
      if (row.shell_parent_package_id) continue
      const inv = inventoryRow(row.package_inventory)
      pushSellables.set(row.id, portalSellable(inv?.qty_available, inv?.qty_held))
    }
  }

  if (pushSellables.size > 0) {
    // Available only on inventory heals. Stock Sources are rewritten on product.upsert /
    // cost-layer sync (and after order channel sync) — not on every cron heal. Rewriting
    // Stock Sources for every linked member each minute burned Salesforce TotalRequests
    // and their triggers also clobbered Available back to stale values.
    try {
      const pushResult = await pushLinkedGroupAvailabilityToSalesforce(
        admin,
        groupId,
        config,
        pushSellables,
        poolStock,
        snapshots,
      )
      if (pushResult.skipped.length > 0) {
        console.warn(
          "[linked-inventory] Salesforce availability push skipped:",
          pushResult.skipped.slice(0, 5).join("; "),
        )
      }
    } catch (e) {
      console.warn(
        "[linked-inventory] Salesforce availability push failed:",
        e instanceof Error ? e.message : e,
      )
    }

    // Portal again after SF I/O in case a concurrent cron applied stale SF Available.
    try {
      await reconcileLinkedGroupFromPortalSales(admin, groupId)
    } catch (e) {
      console.warn(
        "[linked-inventory] portal reassert after SF push failed:",
        e instanceof Error ? e.message : e,
      )
    }
  }

  // SF Available already pushed above. Do NOT enqueue product.upsert for the whole
  // linked group — that re-runs full Product2 syncs (parent + days + shells) and burns
  // Salesforce TotalRequests. Only push Wix inventory for packages that changed.
  const changedIds = [...new Set(targets.map((t) => t.package_id))]
  if (threeDay?.id && !changedIds.includes(threeDay.id) && targets.length > 0) {
    changedIds.push(threeDay.id)
  }
  if (targets.length > 0) {
    const { syncPackageCatalogToWix } = await import("@/lib/integrations/wix/catalog-sync")
    for (const packageId of changedIds) {
      try {
        await syncPackageCatalogToWix(packageId)
      } catch (e) {
        console.warn(
          `[linked-inventory] Wix inventory sync after heal failed for ${packageId}:`,
          e instanceof Error ? e.message : e,
        )
      }
    }
  }

  return { updated, threeDaySellable }
}

function portalSellable(qtyAvailable: number | null | undefined, qtyHeld: number | null | undefined): number {
  const avail = Math.max(0, Math.floor(Number(qtyAvailable) || 0))
  const held = Math.max(0, Math.floor(Number(qtyHeld) || 0))
  return Math.max(0, avail - held)
}

/** True when portal stock for a linked group does not match Salesforce (or all sellable rows are 0). */
async function linkedGroupNeedsSfSync(
  admin: SupabaseClient,
  groupId: string,
  config: SalesforceConfig,
): Promise<boolean> {
  const { data: rows, error } = await admin
    .from("packages")
    .select(
      "id, duration, salesforce_product_id, shell_parent_package_id, package_inventory ( qty_available, qty_held )",
    )
    .eq("inventory_group_id", groupId)
  if (error) throw new Error(error.message)

  const members = (rows ?? []).filter((r) => !(r as GroupMember).shell_parent_package_id) as GroupMember[]
  const dayMembers = members.filter((m) => DAY_DURATIONS.has(m.duration ?? ""))

  if (dayMembers.length === 0) {
    const threeDay = members.find((m) => m.duration === "3_day")
    const product2Id = threeDay?.salesforce_product_id?.trim() ?? ""
    if (!threeDay || !product2Id) return false

    const snapshots = await readSfInventorySnapshotsBulk([product2Id], config)
    const snapshot = snapshots.get(product2Id)
    if (!snapshot) return false

    const inv = inventoryRow(threeDay.package_inventory)
    const currentSellable = portalSellable(inv?.qty_available, inv?.qty_held)
    if (isUninitializedSfInventorySnapshot(snapshot) && currentSellable > 0) return false

    const [wonByProduct, committedByProduct] = await Promise.all([
      readWonQuantityByProductBulk([product2Id], config.opportunityStageWon),
      readCommittedQuantityByProductBulk([product2Id], config.opportunityStageLost),
    ])
    const committed =
      committedByProduct.get(product2Id) ?? wonByProduct.get(product2Id) ?? 0
    const stock =
      snapshot.stock != null && snapshot.stock > 0
        ? Math.max(0, Math.floor(snapshot.stock))
        : null
    const sfSellable =
      stock != null
        ? Math.max(0, stock - committed)
        : salesforceTargetSellable(snapshot)
    if (sfSellable == null) return false
    return currentSellable !== sfSellable
  }

  const productIds = dayMembers
    .map((m) => m.salesforce_product_id?.trim() ?? "")
    .filter((id) => id.length > 0)
  if (productIds.length === 0) return false

  const threeDayMember = members.find((m) => m.duration === "3_day")
  const threeDayProduct2Id = threeDayMember?.salesforce_product_id?.trim() ?? ""
  const allProductIds = [
    ...new Set(
      [
        ...productIds,
        threeDayProduct2Id,
      ].filter((id) => id.length > 0),
    ),
  ]
  const snapshots = await readSfInventorySnapshotsBulk(allProductIds, config)
  const [wonByProduct, committedByProduct] = await Promise.all([
    readWonQuantityByProductBulk(allProductIds, config.opportunityStageWon),
    readCommittedQuantityByProductBulk(allProductIds, config.opportunityStageLost),
  ])
  const parentSnapshot = threeDayProduct2Id ? snapshots.get(threeDayProduct2Id) : null
  const sfPoolStock = linkedPoolStockQuantity(parentSnapshot)
  const costLayerPool = threeDayMember?.id
    ? await readCostLayerPoolQuantity(admin, threeDayMember.id)
    : null
  const portalSoldByPackage = await loadPortalSoldByPackageIds(
    admin,
    members.map((m) => m.id),
  )
  const threeDayWonForPool = threeDayProduct2Id ? wonByProduct.get(threeDayProduct2Id) ?? 0 : 0
  const threeDayPortalSold = threeDayMember?.id ? portalSoldByPackage.get(threeDayMember.id) ?? 0 : 0
  const poolStock = resolveLinkedPoolStock({
    sfPoolStock,
    costLayerPool,
    closedWonSold: Math.max(threeDayWonForPool, threeDayPortalSold),
  })
  const threeDaySfCommitted = threeDayProduct2Id
    ? committedByProduct.get(threeDayProduct2Id) ?? wonByProduct.get(threeDayProduct2Id) ?? 0
    : 0
  const threeDayCommitted = Math.max(threeDaySfCommitted, threeDayPortalSold)

  let mappedDays = 0
  let allSellableZero = true
  const daySellables: number[] = []

  for (const member of dayMembers) {
    const product2Id = member.salesforce_product_id?.trim() ?? ""
    const snapshot = product2Id ? snapshots.get(product2Id) : undefined
    mappedDays++

    const inv = inventoryRow(member.package_inventory)
    const currentSellable = portalSellable(inv?.qty_available, inv?.qty_held)
    daySellables.push(currentSellable)
    if (currentSellable > 0) allSellableZero = false

    const dayWon = product2Id ? wonByProduct.get(product2Id) ?? 0 : 0
    const daySfCommitted = product2Id
      ? committedByProduct.get(product2Id) ?? dayWon
      : 0
    const dayOpen = Math.max(0, daySfCommitted - dayWon)
    const dayPortalSold = portalSoldByPackage.get(member.id) ?? 0
    const dayCommitted = dayPortalSold + dayOpen

    // Portal cost-layer pool is enough to detect drift — don't require an SF snapshot.
    if (poolStock != null && poolStock > 0) {
      const expected = Math.max(0, poolStock - threeDayCommitted - dayCommitted)
      if (currentSellable !== expected) return true
      // Portal already correct but Salesforce Available still shows stale pool−3day only (9).
      if (
        snapshot?.available != null &&
        Number.isFinite(snapshot.available) &&
        Math.floor(snapshot.available) !== expected
      ) {
        return true
      }
      continue
    }

    if (!product2Id || !snapshot) continue
    if (isUninitializedSfInventorySnapshot(snapshot) && currentSellable > 0) continue

    const sfSellable = resolveLinkedDaySellable({
      poolStock,
      threeDayCommitted,
      dayCommitted,
      snapshot,
    })
    if (sfSellable == null) continue
    if (currentSellable !== sfSellable) return true
  }

  if (mappedDays === 0) return false
  if (allSellableZero) return true

  const threeDay = members.find((m) => m.duration === "3_day")
  if (threeDay && daySellables.length > 0) {
    const inv = inventoryRow(threeDay.package_inventory)
    const threeSellable = portalSellable(inv?.qty_available, inv?.qty_held)
    const expectedMin = Math.min(...daySellables)
    if (threeSellable !== expectedMin) return true
  }

  const twoDay = members.find((m) => m.duration === "2_day")
  if (twoDay) {
    const sat = dayMembers.find((m) => m.duration === "saturday_only")
    const sun = dayMembers.find((m) => m.duration === "sunday_only")
    if (sat && sun) {
      const inv = inventoryRow(twoDay.package_inventory)
      const twoSellable = portalSellable(inv?.qty_available, inv?.qty_held)
      const expectedMin = Math.min(
        portalSellable(inventoryRow(sat.package_inventory)?.qty_available, inventoryRow(sat.package_inventory)?.qty_held),
        portalSellable(inventoryRow(sun.package_inventory)?.qty_available, inventoryRow(sun.package_inventory)?.qty_held),
      )
      if (twoSellable !== expectedMin) return true
    }
  }

  return false
}

/** True when 3-day / 2-day rows drifted from min(day siblings) — usually a trigger race. */
async function linkedGroupHasReconcileDrift(
  admin: SupabaseClient,
  groupId: string,
): Promise<boolean> {
  const { data: rows, error } = await admin
    .from("packages")
    .select(
      "id, duration, shell_parent_package_id, package_inventory ( qty_available, qty_held )",
    )
    .eq("inventory_group_id", groupId)
  if (error) throw new Error(error.message)

  const members = (rows ?? []).filter((r) => !(r as GroupMember).shell_parent_package_id) as GroupMember[]
  const daySellables: number[] = []
  for (const member of members) {
    if (!DAY_DURATIONS.has(member.duration ?? "")) continue
    const inv = inventoryRow(member.package_inventory)
    daySellables.push(portalSellable(inv?.qty_available, inv?.qty_held))
  }
  if (daySellables.length === 0) return false

  const expectedMin = Math.min(...daySellables)
  const threeDay = members.find((m) => m.duration === "3_day")
  if (threeDay) {
    const inv = inventoryRow(threeDay.package_inventory)
    if (portalSellable(inv?.qty_available, inv?.qty_held) !== expectedMin) return true
  }

  const twoDay = members.find((m) => m.duration === "2_day")
  if (twoDay) {
    const sat = members.find((m) => m.duration === "saturday_only")
    const sun = members.find((m) => m.duration === "sunday_only")
    if (sat && sun) {
      const inv = inventoryRow(twoDay.package_inventory)
      const twoSellable = portalSellable(inv?.qty_available, inv?.qty_held)
      const expectedTwo = Math.min(
        portalSellable(inventoryRow(sat.package_inventory)?.qty_available, inventoryRow(sat.package_inventory)?.qty_held),
        portalSellable(inventoryRow(sun.package_inventory)?.qty_available, inventoryRow(sun.package_inventory)?.qty_held),
      )
      if (twoSellable !== expectedTwo) return true
    }
  }

  return false
}

/** Re-sync one linked group when portal stock drifted from Salesforce or min(day) reconcile. */
export async function healLinkedGroupIfStale(
  admin: SupabaseClient,
  groupId: string,
  config: SalesforceConfig,
): Promise<boolean> {
  const gid = groupId.trim()
  if (!gid) return false
  const needsSf = await linkedGroupNeedsSfSync(admin, gid, config)
  const needsDrift = await linkedGroupHasReconcileDrift(admin, gid)
  if (!needsSf && !needsDrift) return false
  await syncLinkedGroupInventoryFromSalesforce(admin, gid, config)
  return true
}

async function repairDriftedLinkedGroups(
  admin: SupabaseClient,
  config: SalesforceConfig,
  groupIds: string[],
  options?: { includeSfProbe?: boolean },
): Promise<number> {
  const includeSfProbe = options?.includeSfProbe !== false
  let total = 0
  for (let pass = 0; pass < 4; pass++) {
    let repaired = 0
    for (const groupId of groupIds) {
      const needsDriftRepair = await linkedGroupHasReconcileDrift(admin, groupId)
      const needsSfRepair = includeSfProbe
        ? await linkedGroupNeedsSfSync(admin, groupId, config)
        : false
      if (!needsDriftRepair && !needsSfRepair) continue
      await syncLinkedGroupInventoryFromSalesforce(admin, groupId, config)
      repaired++
    }
    total += repaired
    if (repaired === 0) break
  }
  return total
}

/** Re-sync groups whose portal stock drifted from Salesforce or min(day) reconcile. */
export async function repairAllDriftedLinkedGroupsFromSalesforce(
  admin: SupabaseClient,
  config: SalesforceConfig,
): Promise<number> {
  const { data: rows, error } = await admin
    .from("packages")
    .select("inventory_group_id")
    .not("inventory_group_id", "is", null)
    .not("salesforce_product_id", "is", null)
    .is("shell_parent_package_id", null)
  if (error) throw new Error(error.message)

  const groupIds = [
    ...new Set(
      (rows ?? [])
        .map((r) => (typeof r.inventory_group_id === "string" ? r.inventory_group_id.trim() : ""))
        .filter(Boolean),
    ),
  ]
  return repairDriftedLinkedGroups(admin, config, groupIds)
}

/**
 * Background heal for a single linked group (package detail page). No-op when SF is
 * disconnected or the group is already in sync.
 */
export async function healLinkedGroupInBackground(groupId: string): Promise<boolean> {
  const gid = groupId.trim()
  if (!gid) return false

  const admin = createAdminClient()
  if (!admin) return false

  // Always correct portal qty from local orders first — does not need Salesforce.
  // Fixes catalog stuck at pool−3daySold while SF Available already looks right from
  // Stock Source formulas.
  let portalFixed = false
  try {
    portalFixed = await reconcileLinkedGroupFromPortalSales(admin, gid)
  } catch (e) {
    console.warn(
      "[admin] portal linked-group reconcile failed:",
      e instanceof Error ? e.message : e,
    )
  }

  if (!isSalesforceConfigured()) return portalFixed
  const connection = await getSalesforceConnectionStatus()
  if (!connection.connected) return portalFixed

  const instanceUrl =
    (await getStoredInstanceUrl()) ?? process.env.SALESFORCE_INSTANCE_URL?.trim() ?? ""
  const config = getSalesforceConfig(instanceUrl || undefined)
  if (!config) return portalFixed

  try {
    // Push SF when portal changed, or when SF Available drifted from portal math.
    const sfHealed = await healLinkedGroupIfStale(admin, gid, config)
    if (portalFixed && !sfHealed) {
      // Portal qty already matched expected but Salesforce Available still stale (e.g. all 9).
      await syncLinkedGroupInventoryFromSalesforce(admin, gid, config)
      return true
    }
    return portalFixed || sfHealed
  } catch (e) {
    console.warn(
      "[admin] background linked group heal failed:",
      e instanceof Error ? e.message : e,
    )
    return portalFixed
  }
}

/**
 * Set linked-group sellables from cost-layer pool − portal/offline sold only.
 * Ignores Salesforce (open pipeline is applied later by the SF heal).
 * Returns true when any package_inventory row changed.
 */
export async function reconcileLinkedGroupFromPortalSales(
  admin: SupabaseClient,
  inventoryGroupId: string,
): Promise<boolean> {
  const groupId = inventoryGroupId.trim()
  if (!groupId) return false

  const { data: rows, error } = await admin
    .from("packages")
    .select(
      "id, name, duration, shell_parent_package_id, package_inventory ( qty_available, qty_held )",
    )
    .eq("inventory_group_id", groupId)
  if (error) throw new Error(error.message)

  const members = (rows ?? []).filter(
    (r) => !(r as GroupMember).shell_parent_package_id,
  ) as GroupMember[]
  if (members.length === 0) return false

  const threeDay = members.find((m) => m.duration === "3_day")
  const dayMembers = members.filter((m) => DAY_DURATIONS.has(m.duration ?? ""))
  if (!threeDay?.id || dayMembers.length === 0) return false

  const costLayerPool = await readCostLayerPoolQuantity(admin, threeDay.id)
  if (costLayerPool == null || costLayerPool <= 0) return false

  const portalSold = await loadPortalSoldByPackageIds(
    admin,
    members.map((m) => m.id),
  )
  const threeSold = portalSold.get(threeDay.id) ?? 0

  const targets: InventoryTarget[] = []
  const daySellables = new Map<string, number>()
  let changed = false

  for (const member of dayMembers) {
    const daySold = portalSold.get(member.id) ?? 0
    const sellable = Math.max(0, costLayerPool - threeSold - daySold)
    const held = Math.max(0, Math.floor(Number(inventoryRow(member.package_inventory)?.qty_held) || 0))
    const current = portalSellable(
      inventoryRow(member.package_inventory)?.qty_available,
      inventoryRow(member.package_inventory)?.qty_held,
    )
    daySellables.set(member.id, sellable)
    if (current !== sellable) changed = true
    targets.push({
      package_id: member.id,
      qty_available: sellable + held,
      sellable,
      name: member.name,
      duration: member.duration,
    })
  }

  const threeSellable = Math.min(...[...daySellables.values()])
  const threeHeld = Math.max(
    0,
    Math.floor(Number(inventoryRow(threeDay.package_inventory)?.qty_held) || 0),
  )
  const threeCurrent = portalSellable(
    inventoryRow(threeDay.package_inventory)?.qty_available,
    inventoryRow(threeDay.package_inventory)?.qty_held,
  )
  if (threeCurrent !== threeSellable) changed = true
  targets.push({
    package_id: threeDay.id,
    qty_available: threeSellable + threeHeld,
    sellable: threeSellable,
    name: threeDay.name,
    duration: threeDay.duration,
  })
  daySellables.set(threeDay.id, threeSellable)

  if (!changed) return false

  await applyLinkedGroupInventoryTargets(admin, groupId, targets)
  await mirrorShellPortalInventory(admin, threeDay.id, daySellables)
  return true
}

/**
 * Admin catalog load: re-pull linked groups whose portal stock drifted from Salesforce.
 * Skips groups already in sync (unlike the old zero-only heal).
 */
export async function healStaleLinkedGroupsOnAdminLoad(): Promise<number> {
  if (!isSalesforceConfigured()) return 0
  const connection = await getSalesforceConnectionStatus()
  if (!connection.connected) return 0

  const admin = createAdminClient()
  if (!admin) return 0
  const instanceUrl =
    (await getStoredInstanceUrl()) ?? process.env.SALESFORCE_INSTANCE_URL?.trim() ?? ""
  const config = getSalesforceConfig(instanceUrl || undefined)
  if (!config) return 0

  const result = await syncStaleLinkedGroupsFromSalesforce(admin, config)
  return result.packagesFixed
}

/**
 * Admin catalog load: restore linked groups wrongly showing 0 (cron trigger races).
 * @deprecated Prefer healStaleLinkedGroupsOnAdminLoad — also heals partial drift (e.g. 2/6/6/2).
 */
export async function healLinkedGroupsWithZeroPortalStock(): Promise<number> {
  return healStaleLinkedGroupsOnAdminLoad()
}

/**
 * Re-sync linked groups whose portal stock does not match Salesforce. Skips groups already
 * in sync so cron does not re-touch in-sync groups while syncing others.
 */
export async function syncStaleLinkedGroupsFromSalesforce(
  admin: SupabaseClient,
  config: SalesforceConfig,
): Promise<{ groups: number; packagesFixed: number; groupsSynced: number }> {
  const { data: rows, error } = await admin
    .from("packages")
    .select("inventory_group_id")
    .not("inventory_group_id", "is", null)
    .not("salesforce_product_id", "is", null)
    .is("shell_parent_package_id", null)

  if (error) throw new Error(error.message)

  const groupIds = [
    ...new Set(
      (rows ?? [])
        .map((r) => (typeof r.inventory_group_id === "string" ? r.inventory_group_id.trim() : ""))
        .filter(Boolean),
    ),
  ]

  let packagesFixed = 0
  let groupsSynced = 0

  // Probe which groups need a Salesforce sync in parallel (each probe is 1–2 SF reads).
  const STALE_PROBE_CONCURRENCY = 6
  const staleGroupIds: string[] = []
  for (let i = 0; i < groupIds.length; i += STALE_PROBE_CONCURRENCY) {
    const batch = groupIds.slice(i, i + STALE_PROBE_CONCURRENCY)
    const flags = await Promise.all(
      batch.map(async (groupId) => ({
        groupId,
        needs: await linkedGroupNeedsSfSync(admin, groupId, config),
      })),
    )
    for (const f of flags) {
      if (f.needs) staleGroupIds.push(f.groupId)
    }
  }

  for (const groupId of staleGroupIds) {
    const before = await admin
      .from("packages")
      .select("id, package_inventory ( qty_available, qty_held )")
      .eq("inventory_group_id", groupId)
      .is("shell_parent_package_id", null)

    const sellableBefore = new Map<string, number>()
    for (const row of before.data ?? []) {
      const inv = Array.isArray(row.package_inventory)
        ? row.package_inventory[0]
        : row.package_inventory
      sellableBefore.set(String(row.id), portalSellable(inv?.qty_available, inv?.qty_held))
    }

    const synced = await syncLinkedGroupInventoryFromSalesforce(admin, groupId, config)
    groupsSynced++
    for (const row of synced.updated) {
      const prev = sellableBefore.get(row.id) ?? 0
      if (row.sellable !== prev) packagesFixed++
    }
  }

  const driftRepaired = await repairDriftedLinkedGroups(admin, config, groupIds, {
    // SF stale groups were already probed + synced above — only fix portal min(day) drift.
    includeSfProbe: false,
  })
  if (driftRepaired > 0) groupsSynced += driftRepaired

  return { groups: groupIds.length, packagesFixed, groupsSynced }
}

/**
 * Re-sync every linked inventory group from Salesforce (admin repair / explicit full heal).
 */
export async function healAllLinkedGroupsFromSalesforce(
  admin: SupabaseClient,
  config: SalesforceConfig,
): Promise<{ groups: number; packagesFixed: number }> {
  const { data: rows, error } = await admin
    .from("packages")
    .select("inventory_group_id")
    .not("inventory_group_id", "is", null)
    .not("salesforce_product_id", "is", null)
    .is("shell_parent_package_id", null)

  if (error) throw new Error(error.message)

  const groupIds = [
    ...new Set(
      (rows ?? [])
        .map((r) => (typeof r.inventory_group_id === "string" ? r.inventory_group_id.trim() : ""))
        .filter(Boolean),
    ),
  ]

  let packagesFixed = 0
  for (const groupId of groupIds) {
    const before = await admin
      .from("packages")
      .select("id, package_inventory ( qty_available, qty_held )")
      .eq("inventory_group_id", groupId)
      .is("shell_parent_package_id", null)

    const sellableBefore = new Map<string, number>()
    for (const row of before.data ?? []) {
      const inv = Array.isArray(row.package_inventory)
        ? row.package_inventory[0]
        : row.package_inventory
      const avail = Math.max(0, Math.floor(Number(inv?.qty_available) || 0))
      const held = Math.max(0, Math.floor(Number(inv?.qty_held) || 0))
      sellableBefore.set(String(row.id), Math.max(0, avail - held))
    }

    const synced = await syncLinkedGroupInventoryFromSalesforce(admin, groupId, config)
    for (const row of synced.updated) {
      const prev = sellableBefore.get(row.id) ?? 0
      if (row.sellable !== prev) packagesFixed++
    }
  }

  await repairDriftedLinkedGroups(admin, config, groupIds)

  return { groups: groupIds.length, packagesFixed }
}
