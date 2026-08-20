import { getSalesforceConfig, isSalesforceConfigured } from "@/lib/integrations/salesforce/config"
import {
  getSalesforceConnectionStatus,
  getStoredInstanceUrl,
} from "@/lib/integrations/salesforce/settings-store"
import { syncLinkedGroupInventoryFromSalesforce } from "@/lib/inventory/linked-group-inventory"
import { createAdminClient } from "@/lib/supabase/admin"

export type RepairedPackage = {
  id: string
  name: string
  duration: string | null
  sellable: number
}

export type RepairLinkedGroupResult =
  | {
      ok: true
      repaired: RepairedPackage[]
      threeDaySellable: number | null
      warnings: string[]
      message: string
    }
  | { ok: false; message: string }

/** Copy each linked package's sellable qty from its Salesforce Product2, then min() the 3-day. */
export async function repairLinkedGroupInventory(parentPackageId: string): Promise<RepairLinkedGroupResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Supabase service role is not configured." }

  const parentId = parentPackageId.trim()
  if (!parentId) return { ok: false, message: "Parent package id is required." }

  const { data: parentRow, error: parentErr } = await admin
    .from("packages")
    .select("id, duration, inventory_group_id, shell_parent_package_id")
    .eq("id", parentId)
    .maybeSingle()
  if (parentErr) return { ok: false, message: parentErr.message }
  if (!parentRow) return { ok: false, message: "Package not found." }

  const parent = parentRow as {
    duration: string | null
    inventory_group_id: string | null
    shell_parent_package_id: string | null
  }
  if (parent.shell_parent_package_id) {
    return { ok: false, message: "Open the 3-day parent package, not a shell." }
  }
  if (parent.duration !== "3_day") {
    return { ok: false, message: "Open the 3-day parent package." }
  }
  if (!parent.inventory_group_id) {
    return { ok: false, message: "No linked inventory group on this package." }
  }

  if (!isSalesforceConfigured()) {
    try {
      const { reconcileLinkedGroupFromPortalSales } = await import(
        "@/lib/inventory/linked-group-inventory"
      )
      const changed = await reconcileLinkedGroupFromPortalSales(admin, parent.inventory_group_id)
      return {
        ok: true,
        repaired: [],
        threeDaySellable: null,
        warnings: [],
        message: changed
          ? "Linked inventory reconciled from portal sales."
          : "Linked inventory already matches portal sales.",
      }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
  const connection = await getSalesforceConnectionStatus()
  if (!connection.connected) {
    return { ok: false, message: "Salesforce is not connected. Connect under Admin → Integrations." }
  }
  const instanceUrl = (await getStoredInstanceUrl()) ?? process.env.SALESFORCE_INSTANCE_URL?.trim() ?? ""
  const config = getSalesforceConfig(instanceUrl || undefined)
  if (!config) return { ok: false, message: "Salesforce config missing." }

  try {
    const result = await syncLinkedGroupInventoryFromSalesforce(admin, parent.inventory_group_id, config)
    const lines = result.updated
      .sort((a, b) => {
        if (a.duration === "3_day") return -1
        if (b.duration === "3_day") return 1
        return a.name.localeCompare(b.name)
      })
      .map((r) => `${r.name}: ${r.sellable}`)

    return {
      ok: true,
      repaired: result.updated,
      threeDaySellable: result.threeDaySellable,
      warnings: [],
      message:
        lines.length > 0
          ? `Synced from Salesforce — ${lines.join(" · ")}`
          : "No packages with a Salesforce Product Id were updated.",
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
