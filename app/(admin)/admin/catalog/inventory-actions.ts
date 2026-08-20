"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/admin/require-admin"
import { enqueueProductUpsert } from "@/lib/integrations/enqueue"
import { createClient } from "@/lib/supabase/server"

type Result = { ok: true; message: string } | { ok: false; message: string }

async function adminClient() {
  const profile = await requireAdmin()
  if (profile.role !== "admin") return null
  return createClient()
}

function revalidateInventory() {
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/inventory/sales-list")
  revalidatePath("/admin/deals")
  revalidatePath("/packages")
  revalidatePath("/")
}

export async function removeInventoryProduct(packageId: string): Promise<Result> {
  const supabase = await adminClient()
  if (!supabase) return { ok: false, message: "Administrator permission is required." }
  const { data, error } = await supabase.rpc("admin_remove_inventory_product", {
    p_package_id: packageId,
  })
  if (error) return { ok: false, message: error.message }
  const result = (data ?? {}) as { result?: string; message?: string }
  if (result.result === "archived") {
    await enqueueProductUpsert(supabase, packageId)
  }
  revalidateInventory()
  return {
    ok: true,
    message:
      result.message ??
      (result.result === "deleted" ? "Product deleted." : "Product archived for history."),
  }
}

export async function cleanupLegacyShellProducts(): Promise<Result> {
  const supabase = await adminClient()
  if (!supabase) return { ok: false, message: "Administrator permission is required." }
  const { data, error } = await supabase.rpc("admin_cleanup_legacy_shell_packages")
  if (error) return { ok: false, message: error.message }
  const result = (data ?? {}) as { deleted?: number; preserved_for_history?: number }
  revalidateInventory()
  return {
    ok: true,
    message: `${Number(result.deleted ?? 0)} generated shell product(s) deleted. ${Number(result.preserved_for_history ?? 0)} retained hidden because historical records reference them.`,
  }
}

export async function updateInventoryProductPublishing(input: {
  packageId: string
  isHidden: boolean
  sellOnPortal: boolean
  sellOnWebsite: boolean
  websitePrice: number | null
}): Promise<Result> {
  const supabase = await adminClient()
  if (!supabase) return { ok: false, message: "Administrator permission is required." }
  const id = input.packageId.trim()
  if (!id) return { ok: false, message: "Product is missing." }
  if (
    input.websitePrice != null &&
    (!Number.isFinite(input.websitePrice) || input.websitePrice < 0)
  ) {
    return { ok: false, message: "Website price must be zero or a positive number." }
  }
  if (input.sellOnWebsite && input.websitePrice == null) {
    return { ok: false, message: "Enter a website price before making the product live on the website." }
  }

  const { error } = await supabase
    .from("packages")
    .update({
      is_hidden: input.isHidden,
      sell_on_trade_portal: input.sellOnPortal,
      sell_on_wix: input.sellOnWebsite,
      wix_retail_price: input.websitePrice,
    })
    .eq("id", id)
  if (error) return { ok: false, message: error.message }
  const queued = await enqueueProductUpsert(supabase, id)
  if (!queued.ok) {
    revalidateInventory()
    return {
      ok: true,
      message: `Visibility was saved. Website sync still needs attention: ${queued.message}`,
    }
  }
  revalidateInventory()
  return { ok: true, message: "Product visibility and website price updated." }
}

