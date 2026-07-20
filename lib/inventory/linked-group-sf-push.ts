import type { SupabaseClient } from "@supabase/supabase-js"
import type { SalesforceConfig } from "@/lib/integrations/salesforce/config"
import { salesforceQuery, salesforceRequest } from "@/lib/integrations/salesforce/client"
import { getProduct2UpdateableFields } from "@/lib/integrations/salesforce/describe"
import { PROTECTED_SALESFORCE_PRODUCT_FIELDS } from "@/lib/integrations/salesforce/inventory-snapshot"
import { resolvePackageItemConfig } from "@/lib/integrations/salesforce/package-items"
import { resolveShellInventorySource } from "@/lib/catalog/ensure-shell-single-tickets"

type DayMember = {
  id: string
  duration: string | null
  salesforce_product_id: string | null
  shell_parent_package_id: string | null
  sellable: number
}

function isPackageInventoryTriggerError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes("packageinventorymanager") ||
    m.includes("producttrigger") ||
    m.includes("argument cannot be null") ||
    m.includes("missing_argument")
  )
}

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

/**
 * Salesforce PackageInventoryManager NPEs when Available_Quantity__c is updated on a
 * Single Ticket that still has Package_Ticket_Junction__c rows. Detach → PATCH → restore.
 */
async function patchShellInventoryWithJunctionBypass(args: {
  shellProduct2Id: string
  parentProduct2Id: string | null
  body: Record<string, number>
  config: SalesforceConfig
}): Promise<void> {
  const itemConfig = resolvePackageItemConfig(args.config)
  let saved: Array<Record<string, unknown>> = []

  if (itemConfig) {
    const select = ["Id", itemConfig.parent, itemConfig.child, itemConfig.quantity]
    if (itemConfig.sort) select.push(itemConfig.sort)
    saved = await salesforceQuery<Record<string, unknown>>(
      `SELECT ${select.join(", ")} FROM ${itemConfig.object} WHERE ${itemConfig.child} = '${escapeSoqlString(args.shellProduct2Id)}'`,
    )
    for (const row of saved) {
      const id = String(row.Id ?? "").trim()
      if (id) await salesforceRequest("DELETE", `/sobjects/${itemConfig.object}/${id}`)
    }
  }

  try {
    await salesforceRequest("PATCH", `/sobjects/Product2/${args.shellProduct2Id}`, {
      body: args.body,
    })
  } finally {
    if (itemConfig && saved.length > 0) {
      for (const row of saved) {
        const parentId = String(row[itemConfig.parent] ?? "").trim() || args.parentProduct2Id
        const childId = String(row[itemConfig.child] ?? "").trim() || args.shellProduct2Id
        if (!parentId || !childId) continue
        const body: Record<string, unknown> = {
          [itemConfig.parent]: parentId,
          [itemConfig.child]: childId,
          [itemConfig.quantity]: Number(row[itemConfig.quantity]) || 1,
        }
        if (itemConfig.sort && row[itemConfig.sort] != null) {
          body[itemConfig.sort] = row[itemConfig.sort]
        }
        try {
          await salesforceRequest("POST", `/sobjects/${itemConfig.object}`, { body })
        } catch (e) {
          console.warn(
            "[linked-sf-push] recreate package item after shell inventory patch:",
            e instanceof Error ? e.message : e,
          )
        }
      }
    }
  }
}

/**
 * Push Stock + Available Quantity to Salesforce day products, 3-day parent, and shells.
 *
 * Stock = portal cost-layer pool.
 * Available = portal sellable.
 *
 * Quantity_Sold__c is a Salesforce formula (Stock − Available) — never PATCH it. Writing
 * Available updates Quantity Sold automatically.
 *
 * When `sfSnapshots` is provided (from the linked heal that already queried Product2),
 * skip PATCHes where Stock + Available already match — saves TotalRequests on cron.
 */
export async function pushLinkedGroupAvailabilityToSalesforce(
  admin: SupabaseClient,
  inventoryGroupId: string,
  config: SalesforceConfig,
  daySellables: Map<string, number>,
  poolStock: number | null,
  sfSnapshots?: Map<string, { stock: number | null; available: number | null }>,
): Promise<{ updated: number; skipped: string[] }> {
  const groupId = inventoryGroupId.trim()
  if (!groupId || !config.fieldAvailableQty) {
    return { updated: 0, skipped: ["Salesforce Available field not configured."] }
  }

  const { data: rows, error } = await admin
    .from("packages")
    .select("id, duration, salesforce_product_id, shell_parent_package_id")
    .eq("inventory_group_id", groupId)
  if (error) throw new Error(error.message)

  const members = (rows ?? []) as DayMember[]
  const updateable = await getProduct2UpdateableFields()
  const skipped: string[] = []
  let updated = 0

  if (!updateable.has(config.fieldAvailableQty)) {
    return { updated: 0, skipped: [`${config.fieldAvailableQty} is read-only in Salesforce.`] }
  }

  const stockToPush =
    poolStock != null && Number.isFinite(poolStock) && poolStock > 0
      ? Math.max(0, Math.floor(poolStock))
      : null
  const canPushStock =
    stockToPush != null &&
    !!config.fieldStockQty &&
    updateable.has(config.fieldStockQty) &&
    !PROTECTED_SALESFORCE_PRODUCT_FIELDS.has(config.fieldStockQty)

  function alreadyMatches(product2Id: string, sellable: number): boolean {
    if (!sfSnapshots) return false
    const snap = sfSnapshots.get(product2Id)
    if (!snap) return false
    const availOk =
      snap.available != null && Math.floor(snap.available) === Math.max(0, Math.floor(sellable))
    if (!availOk) return false
    if (canPushStock && stockToPush != null) {
      return snap.stock != null && Math.floor(snap.stock) === stockToPush
    }
    return true
  }

  async function patchProduct(product2Id: string, sellable: number, label: string): Promise<void> {
    if (alreadyMatches(product2Id, sellable)) return

    const body: Record<string, number> = {
      [config.fieldAvailableQty!]: Math.max(0, Math.floor(sellable)),
    }
    if (canPushStock && config.fieldStockQty && stockToPush != null) {
      body[config.fieldStockQty] = stockToPush
    }

    try {
      await salesforceRequest("PATCH", `/sobjects/Product2/${product2Id}`, { body })
      updated++
    } catch (e) {
      skipped.push(`${label}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  for (const member of members) {
    if (member.shell_parent_package_id) continue
    const product2Id = member.salesforce_product_id?.trim() ?? ""
    if (!product2Id) continue

    const duration = member.duration ?? ""
    if (
      duration !== "friday_only" &&
      duration !== "saturday_only" &&
      duration !== "sunday_only" &&
      duration !== "thursday_only" &&
      duration !== "3_day" &&
      duration !== "2_day"
    ) {
      continue
    }

    const sellable = daySellables.get(member.id)
    if (sellable == null) continue

    await patchProduct(product2Id, sellable, member.id)
  }

  const threeDay = members.find((m) => m.duration === "3_day" && !m.shell_parent_package_id)
  if (threeDay?.id) {
    const parentProduct2Id = threeDay.salesforce_product_id?.trim() || null
    const { data: shells } = await admin
      .from("packages")
      .select("id, salesforce_product_id")
      .eq("shell_parent_package_id", threeDay.id)

    for (const shell of shells ?? []) {
      const shellId = (shell as { id: string }).id
      const shellProduct2Id =
        (shell as { salesforce_product_id: string | null }).salesforce_product_id?.trim() ?? ""
      if (!shellProduct2Id) continue

      const source = await resolveShellInventorySource(admin, shellId).catch(() => null)
      const qtyPackageId = source?.qtyAvailablePackageId ?? shellId
      const sellable = daySellables.get(qtyPackageId)
      if (sellable == null) continue

      const body: Record<string, number> = {
        [config.fieldAvailableQty]: Math.max(0, Math.floor(sellable)),
      }
      if (canPushStock && config.fieldStockQty && stockToPush != null) {
        body[config.fieldStockQty] = stockToPush
      }

      try {
        await salesforceRequest("PATCH", `/sobjects/Product2/${shellProduct2Id}`, { body })
        updated++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (isPackageInventoryTriggerError(msg)) {
          try {
            await patchShellInventoryWithJunctionBypass({
              shellProduct2Id,
              parentProduct2Id,
              body,
              config,
            })
            updated++
          } catch (e2) {
            skipped.push(`${shellId}: ${e2 instanceof Error ? e2.message : String(e2)}`)
          }
        } else {
          skipped.push(`${shellId}: ${msg}`)
        }
      }
    }
  }

  return { updated, skipped }
}
