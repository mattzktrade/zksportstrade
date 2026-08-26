"use server"

import { revalidatePath } from "next/cache"
import { requireAdminAction } from "@/app/(admin)/actions"
import { createClient } from "@/lib/supabase/server"

export type HistoricalInventoryReconciliationResult =
  | {
      ok: true
      applied: boolean
      dealCount: number
      allocatedQuantity: number
      shortageQuantity: number
      message: string
    }
  | { ok: false; message: string }

export async function reconcileHistoricalInventory(
  apply: boolean,
): Promise<HistoricalInventoryReconciliationResult> {
  const gate = await requireAdminAction("inventory.manage")
  if (!gate.ok) return gate

  const supabase = await createClient()
  const requestKey = apply ? `historical-inventory-${crypto.randomUUID()}` : null
  let dealCount = 0
  let allocatedQuantity = 0
  let shortageQuantity = 0
  let remainingDeals = apply ? 1 : 0

  for (let batch = 0; batch < 100 && (!apply || remainingDeals > 0); batch += 1) {
    const { data, error } = await supabase.rpc("inventory_reconcile_historical_inventory", {
      p_apply: apply,
      p_idempotency_key: requestKey,
      p_limit: apply ? 25 : 2000,
    })
    if (error) {
      if (/does not exist|could not find the function/i.test(error.message)) {
        return { ok: false, message: "Apply the latest Inventory Allocation migrations first." }
      }
      return {
        ok: false,
        message:
          dealCount > 0
            ? `${error.message} (${dealCount} deals were safely completed before this batch failed.)`
            : error.message,
      }
    }

    const result = (data ?? {}) as Record<string, unknown>
    dealCount += Number(result.deal_count ?? 0)
    allocatedQuantity += Number(result.allocated_quantity ?? 0)
    shortageQuantity += Number(result.shortage_quantity ?? 0)
    remainingDeals = Number(result.remaining_deal_count ?? 0)
    if (!apply) break
  }

  if (apply) {
    revalidatePath("/admin/inventory/negative-stock")
    revalidatePath("/admin/catalog", "layout")
    revalidatePath("/admin/operations")
  }
  return {
    ok: true,
    applied: apply && remainingDeals === 0,
    dealCount,
    allocatedQuantity,
    shortageQuantity,
    message: apply
      ? remainingDeals === 0
        ? `Reconciled ${dealCount} historical deal${dealCount === 1 ? "" : "s"}: ${allocatedQuantity} allocated, ${shortageQuantity} flagged as missing purchase stock.`
        : `Reconciled ${dealCount} deals; ${remainingDeals} remain. Click Apply reconciliation again to continue.`
      : `Previewed ${dealCount} historical deal${dealCount === 1 ? "" : "s"}: ${allocatedQuantity} can be allocated and ${shortageQuantity} require purchase records.`,
  }
}
