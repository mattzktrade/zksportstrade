import { revalidatePath } from "next/cache"

/** Invalidate admin pages that show COGS / gross profit after cost-layer edits. */
export function revalidateAdminProfitPaths(packageId?: string) {
  revalidatePath("/admin", "layout")
  revalidatePath("/admin/orders", "layout")
  revalidatePath("/admin/catalog", "layout")
  if (packageId?.trim()) {
    revalidatePath(`/admin/catalog/${encodeURIComponent(packageId.trim())}`, "page")
  }
}
