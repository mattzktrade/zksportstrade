import type { SalesforceConfig } from "@/lib/integrations/salesforce/config"
import { salesforceQuery, salesforceRequest } from "@/lib/integrations/salesforce/client"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  childDayDurationsForPackage,
  SHELL_SINGLE_TICKET_FAMILY,
} from "@/lib/catalog/shell-single-tickets"

type SyncPackageItemsArgs = {
  parentPackageId: string
  parentProduct2Id: string
  config: SalesforceConfig
  fieldsUpdated: string[]
  fieldsSkipped: string[]
}

type SyncLinkedGroupArgs = {
  packageId: string
  product2Id: string
  config: SalesforceConfig
  fieldsUpdated: string[]
  fieldsSkipped: string[]
}

const CHILD_SORT: Record<string, number> = {
  thursday_only: 5,
  friday_only: 10,
  saturday_only: 30,
  sunday_only: 40,
}

const DAY_DURATIONS: ReadonlySet<string> = new Set([
  "thursday_only",
  "friday_only",
  "saturday_only",
  "sunday_only",
])

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

async function existingProduct2Ids(productIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))]
  const out = new Set<string>()
  if (unique.length === 0) return out

  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100)
    const inList = batch.map((id) => `'${escapeSoqlString(id)}'`).join(", ")
    const rows = await salesforceQuery<{ Id: string }>(`SELECT Id FROM Product2 WHERE Id IN (${inList})`)
    for (const row of rows) {
      if (row.Id) out.add(row.Id)
    }
  }
  return out
}

export function resolvePackageItemConfig(config: SalesforceConfig) {
  const object = config.packageItemObject?.trim()
  const parent = config.packageItemParentProductField?.trim()
  const child = config.packageItemChildProductField?.trim()
  const quantity = config.packageItemQuantityField?.trim()
  if (!object || !parent || !child || !quantity) return null
  return { object, parent, child, quantity, sort: config.packageItemSortOrderField?.trim() || null }
}

function packageItemConfig(config: SalesforceConfig) {
  return resolvePackageItemConfig(config)
}

/**
 * Populates `package_items` so this parent links to the correct Single Ticket day children.
 *
 *   - 3-day parents → own shells (Fri/Sat/Sun, or Thu/Fri/Sat for LV-style races).
 *   - 2-day parents → the two matching shells owned by a 3-day sibling in the same
 *     inventory group.
 *   - Sellable single-day Packages (e.g. "Sunday Paddock Club") → the one matching shell
 *     from a 3-day sibling in the same inventory group. This is the Phase 2 flow that
 *     keeps a real day product reporting under the same Single Ticket line as the 3-day.
 *   - Shells and standalone Single Tickets → no children.
 *
 * Children are ALWAYS Single Ticket shells (never real sellable siblings); the shells are
 * the canonical, zero-value line-item template used by Salesforce reporting.
 */
async function ensurePortalPackageItemsForParent(parentPackageId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")

  const { data: parent, error: parentErr } = await admin
    .from("packages")
    .select("id, duration, inventory_group_id, shell_parent_package_id, salesforce_product_family, event_date")
    .eq("id", parentPackageId)
    .maybeSingle()
  if (parentErr) throw new Error(parentErr.message)
  if (!parent) return

  const parentRow = parent as {
    id: string
    duration: string | null
    inventory_group_id: string | null
    shell_parent_package_id: string | null
    salesforce_product_family: string | null
    event_date: string | null
  }

  const family = (parentRow.salesforce_product_family ?? "").trim()

  // Shells and standalone Single Tickets never own children.
  if (parentRow.shell_parent_package_id || family === SHELL_SINGLE_TICKET_FAMILY) {
    await admin.from("package_items").delete().eq("parent_package_id", parentPackageId)
    return
  }

  const duration = String(parentRow.duration ?? "")
  const childDurations = childDayDurationsForPackage(duration, parentRow.event_date)
  if (childDurations.length === 0) {
    await admin.from("package_items").delete().eq("parent_package_id", parentPackageId)
    return
  }

  // Where do the canonical shells live? A 3-day owns its own shells. Anything else has to
  // borrow the shells owned by a 3-day sibling in the same inventory group.
  let ownerIds: string[] = []
  if (duration === "3_day") {
    ownerIds = [parentPackageId]
  } else if (parentRow.inventory_group_id) {
    const { data: threeDays, error: tdErr } = await admin
      .from("packages")
      .select("id")
      .eq("inventory_group_id", parentRow.inventory_group_id)
      .eq("duration", "3_day")
    if (tdErr) throw new Error(tdErr.message)
    ownerIds = (threeDays ?? []).map((row) => String((row as { id: string }).id))
  }

  if (ownerIds.length === 0) {
    // No 3-day in the group → no shells exist yet to link. Sync will retry once one exists.
    await admin.from("package_items").delete().eq("parent_package_id", parentPackageId)
    return
  }

  const { data: shells, error: shellsErr } = await admin
    .from("packages")
    .select("id, duration")
    .in("shell_parent_package_id", ownerIds)
  if (shellsErr) throw new Error(shellsErr.message)

  const wantedDurations = new Set<string>(childDurations)
  const chosenByDuration = new Map<string, string>()
  for (const row of shells ?? []) {
    const s = row as { id: string; duration: string | null }
    const d = s.duration?.trim() ?? ""
    if (!wantedDurations.has(d)) continue
    if (!chosenByDuration.has(d)) chosenByDuration.set(d, s.id)
  }

  const desired: Array<{ id: string; duration: string }> = []
  for (const d of childDurations) {
    const shellId = chosenByDuration.get(d)
    if (shellId) desired.push({ id: shellId, duration: d })
  }

  await admin.from("package_items").delete().eq("parent_package_id", parentPackageId)
  if (desired.length === 0) return

  const rows = desired.map((child) => ({
    parent_package_id: parentPackageId,
    child_package_id: child.id,
    quantity_per_parent: 1,
    sort_order: CHILD_SORT[child.duration] ?? 0,
    updated_at: new Date().toISOString(),
  }))

  const { error } = await admin.from("package_items").upsert(rows, {
    onConflict: "parent_package_id,child_package_id",
  })
  if (error) throw new Error(error.message)
}

export async function syncSalesforcePackageItems({
  parentPackageId,
  parentProduct2Id,
  config,
  fieldsUpdated,
  fieldsSkipped,
}: SyncPackageItemsArgs): Promise<void> {
  const itemConfig = packageItemConfig(config)
  if (!itemConfig) {
    fieldsSkipped.push("Package Items: env vars not configured; run the diagnostic to identify object/field API names.")
    return
  }

  await ensurePortalPackageItemsForParent(parentPackageId)

  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  const { data, error } = await admin
    .from("package_items")
    .select("child_package_id, quantity_per_parent, sort_order")
    .eq("parent_package_id", parentPackageId)
    .order("sort_order", { ascending: true })

  if (error) throw new Error(error.message)
  const rows = (data ?? []) as Array<{
    child_package_id: string
    quantity_per_parent: number
    sort_order: number
  }>
  if (rows.length === 0) return

  const childPackageIds = [...new Set(rows.map((row) => row.child_package_id))]
  const { data: childPackages, error: childErr } = await admin
    .from("packages")
    .select("id, salesforce_product_id")
    .in("id", childPackageIds)
  if (childErr) throw new Error(childErr.message)
  const productIdByPackage = new Map(
    (childPackages ?? []).map((pkg) => [
      String((pkg as { id: string }).id),
      String((pkg as { salesforce_product_id?: string | null }).salesforce_product_id ?? "").trim(),
    ]),
  )

  const desiredBeforeValidation = rows
    .map((row) => {
      return {
        childPackageId: row.child_package_id,
        childProduct2Id: productIdByPackage.get(row.child_package_id) ?? "",
        quantity: Math.max(1, Math.floor(Number(row.quantity_per_parent) || 1)),
        sortOrder: Math.floor(Number(row.sort_order) || 0),
      }
    })
    .filter((row) => {
      if (row.childProduct2Id) return true
      fieldsSkipped.push(`Package Items: child ${row.childPackageId} has no Salesforce Product Id yet.`)
      return false
    })

  const existingChildren = await existingProduct2Ids(desiredBeforeValidation.map((row) => row.childProduct2Id))
  const desired = desiredBeforeValidation.filter((row) => {
    if (existingChildren.has(row.childProduct2Id)) return true
    fieldsSkipped.push(
      `Package Items: child ${row.childPackageId} has stale/missing Salesforce Product Id ${row.childProduct2Id}. Clear and sync that child product first.`,
    )
    return false
  })

  if (desired.length === 0) return

  const existing = await salesforceQuery<Record<string, unknown>>(
    `SELECT Id, ${itemConfig.parent}, ${itemConfig.child} FROM ${itemConfig.object} WHERE ${itemConfig.parent} = '${escapeSoqlString(parentProduct2Id)}' OR ${itemConfig.child} IN (${desired
      .map((row) => `'${escapeSoqlString(row.childProduct2Id)}'`)
      .join(",")})`,
  )
  const existingByChild = new Map<string, string>()
  let orphansRemoved = 0
  for (const record of existing) {
    const parentId = String(record[itemConfig.parent] ?? "").trim()
    const childId = String(record[itemConfig.child] ?? "").trim()
    const id = String(record.Id ?? "").trim()
    if (!id) continue
    // Orphan junctions (null parent or child) crash Salesforce ProductTrigger /
    // PackageInventoryManager with MISSING_ARGUMENT on inventory updates.
    if (!parentId || !childId) {
      try {
        await salesforceRequest("DELETE", `/sobjects/${itemConfig.object}/${id}`)
        orphansRemoved++
      } catch (e) {
        fieldsSkipped.push(
          `Package Items: could not delete orphan junction ${id}: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
      continue
    }
    if (parentId === parentProduct2Id && childId) existingByChild.set(childId, id)
  }
  if (orphansRemoved > 0) {
    fieldsUpdated.push(`Package Items orphans removed (${orphansRemoved})`)
  }

  for (const item of desired) {
    const body: Record<string, unknown> = {
      [itemConfig.parent]: parentProduct2Id,
      [itemConfig.child]: item.childProduct2Id,
      [itemConfig.quantity]: item.quantity,
      ...(itemConfig.sort ? { [itemConfig.sort]: item.sortOrder } : {}),
    }
    const existingId = existingByChild.get(item.childProduct2Id)
    try {
      if (existingId) {
        await salesforceRequest("PATCH", `/sobjects/${itemConfig.object}/${existingId}`, { body })
      } else {
        await salesforceRequest("POST", `/sobjects/${itemConfig.object}`, { body })
      }
    } catch (e) {
      fieldsSkipped.push(
        `Package Items: ${item.childPackageId}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  const desiredChildren = new Set(desired.map((item) => item.childProduct2Id))
  for (const [childProductId, existingId] of existingByChild) {
    if (!desiredChildren.has(childProductId)) {
      await salesforceRequest("DELETE", `/sobjects/${itemConfig.object}/${existingId}`)
    }
  }
  fieldsUpdated.push(`Package Items (${desired.length})`)
}

export async function syncSalesforcePackageItemsForLinkedGroup({
  packageId,
  product2Id,
  config,
  fieldsUpdated,
  fieldsSkipped,
}: SyncLinkedGroupArgs): Promise<void> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")

  const { data: current, error: currentErr } = await admin
    .from("packages")
    .select(
      "id, duration, inventory_group_id, salesforce_product_id, shell_parent_package_id, salesforce_product_family",
    )
    .eq("id", packageId)
    .maybeSingle()
  if (currentErr) throw new Error(currentErr.message)
  if (!current) return

  const currentRow = current as {
    id: string
    duration: string | null
    inventory_group_id: string | null
    salesforce_product_id: string | null
    shell_parent_package_id: string | null
    salesforce_product_family: string | null
  }

  // Shells and standalone Single Tickets themselves never own children — nothing to sync.
  if (
    currentRow.shell_parent_package_id ||
    (currentRow.salesforce_product_family ?? "").trim() === SHELL_SINGLE_TICKET_FAMILY
  ) {
    return
  }

  if (!currentRow.inventory_group_id) {
    await syncSalesforcePackageItems({
      parentPackageId: packageId,
      parentProduct2Id: product2Id,
      config,
      fieldsUpdated,
      fieldsSkipped,
    })
    return
  }

  // Every package in the group that can own children: 3-day, 2-day, or a sellable
  // single-day Package (Phase 2 — its own Salesforce line groups under the day Single
  // Ticket the 3-day already links). Shells and Single Tickets in the group are excluded.
  const { data: siblings, error: sibErr } = await admin
    .from("packages")
    .select(
      "id, duration, salesforce_product_id, shell_parent_package_id, salesforce_product_family",
    )
    .eq("inventory_group_id", currentRow.inventory_group_id)
  if (sibErr) throw new Error(sibErr.message)

  const eligibleParents = (siblings ?? []).filter((row) => {
    const r = row as {
      duration: string | null
      shell_parent_package_id: string | null
      salesforce_product_family: string | null
    }
    if (r.shell_parent_package_id) return false
    if ((r.salesforce_product_family ?? "").trim() === SHELL_SINGLE_TICKET_FAMILY) return false
    const d = (r.duration ?? "").trim()
    return d === "3_day" || d === "2_day" || DAY_DURATIONS.has(d)
  })

  for (const parent of eligibleParents) {
    const parentPackageId = String((parent as { id: string }).id)
    const parentProduct2Id =
      parentPackageId === packageId
        ? product2Id
        : String((parent as { salesforce_product_id?: string | null }).salesforce_product_id ?? "").trim()

    if (!parentProduct2Id) {
      fieldsSkipped.push(`Package Items: parent ${parentPackageId} has no Salesforce Product Id yet.`)
      continue
    }

    await syncSalesforcePackageItems({
      parentPackageId,
      parentProduct2Id,
      config,
      fieldsUpdated,
      fieldsSkipped,
    })
  }
}
