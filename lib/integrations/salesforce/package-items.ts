import type { SalesforceConfig } from "@/lib/integrations/salesforce/config"
import { salesforceQuery, salesforceRequest } from "@/lib/integrations/salesforce/client"
import { createAdminClient } from "@/lib/supabase/admin"

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
  friday_only: 10,
  "2_day": 20,
  saturday_only: 30,
  sunday_only: 40,
}

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

function packageItemConfig(config: SalesforceConfig) {
  const object = config.packageItemObject?.trim()
  const parent = config.packageItemParentProductField?.trim()
  const child = config.packageItemChildProductField?.trim()
  const quantity = config.packageItemQuantityField?.trim()
  if (!object || !parent || !child || !quantity) return null
  return { object, parent, child, quantity, sort: config.packageItemSortOrderField?.trim() || null }
}

async function ensurePortalPackageItemsForParent(parentPackageId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")

  const { data: parent, error: parentErr } = await admin
    .from("packages")
    .select("id, duration, inventory_group_id")
    .eq("id", parentPackageId)
    .maybeSingle()
  if (parentErr) throw new Error(parentErr.message)
  if (!parent?.inventory_group_id) return

  const { data: siblings, error: childErr } = await admin
    .from("packages")
    .select("id, duration")
    .eq("inventory_group_id", parent.inventory_group_id)
  if (childErr) throw new Error(childErr.message)

  const duration = String(parent.duration ?? "")
  const siblingDurations = new Set((siblings ?? []).map((child) => String(child.duration ?? "")))
  const requiredDurations =
    duration === "3_day"
      ? siblingDurations.has("2_day")
        ? ["friday_only", "saturday_only", "sunday_only", "2_day"]
        : ["friday_only", "saturday_only", "sunday_only"]
      : duration === "2_day"
        ? ["saturday_only", "sunday_only"]
        : []

  await admin.from("package_items").delete().eq("parent_package_id", parentPackageId)
  if (requiredDurations.length === 0) return

  const rows = (siblings ?? [])
    .filter((child) => child.id !== parentPackageId)
    .filter((child) => requiredDurations.includes(String(child.duration ?? "")))
    .map((child) => ({
      parent_package_id: parentPackageId,
      child_package_id: String(child.id),
      quantity_per_parent: 1,
      sort_order: CHILD_SORT[String(child.duration)] ?? 0,
      updated_at: new Date().toISOString(),
    }))

  if (rows.length === 0) return

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
    `SELECT Id, ${itemConfig.child} FROM ${itemConfig.object} WHERE ${itemConfig.parent} = '${escapeSoqlString(parentProduct2Id)}'`,
  )
  const existingByChild = new Map<string, string>()
  for (const record of existing) {
    const childId = String(record[itemConfig.child] ?? "")
    const id = String(record.Id ?? "")
    if (childId && id) existingByChild.set(childId, id)
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
    .select("id, duration, inventory_group_id, salesforce_product_id")
    .eq("id", packageId)
    .maybeSingle()
  if (currentErr) throw new Error(currentErr.message)
  if (!current?.inventory_group_id) {
    await syncSalesforcePackageItems({
      parentPackageId: packageId,
      parentProduct2Id: product2Id,
      config,
      fieldsUpdated,
      fieldsSkipped,
    })
    return
  }

  const { data: parents, error: parentsErr } = await admin
    .from("packages")
    .select("id, duration, salesforce_product_id")
    .eq("inventory_group_id", current.inventory_group_id)
    .in("duration", ["3_day", "2_day"])
  if (parentsErr) throw new Error(parentsErr.message)

  for (const parent of parents ?? []) {
    const parentPackageId = String(parent.id)
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
