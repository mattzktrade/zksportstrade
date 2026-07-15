import type { SupabaseClient } from "@supabase/supabase-js"

/** Package ids that share inventory and need Salesforce/Wix sync together. */
export async function packageIdsForInventoryChannelSync(
  supabase: SupabaseClient,
  packageId: string,
): Promise<string[]> {
  const id = packageId.trim()
  if (!id) return []

  const packageIds = new Set<string>([id])
  const { data: pkg } = await supabase
    .from("packages")
    .select("inventory_group_id, shell_parent_package_id")
    .eq("id", id)
    .maybeSingle()

  const pkgRow = pkg as { inventory_group_id: string | null; shell_parent_package_id: string | null } | null

  // If the changed package is itself a Single Ticket shell, walk up to its 3-day parent so
  // the group's inventory gets picked up in the loop below. Shells have no inventory group
  // of their own by design.
  let groupOwnerId = id
  if (pkgRow?.shell_parent_package_id) {
    const parentId = pkgRow.shell_parent_package_id.trim()
    if (parentId) {
      packageIds.add(parentId)
      groupOwnerId = parentId
    }
  }

  let groupId = typeof pkgRow?.inventory_group_id === "string" ? pkgRow.inventory_group_id.trim() : ""
  if (!groupId && groupOwnerId !== id) {
    const { data: parentPkg } = await supabase
      .from("packages")
      .select("inventory_group_id")
      .eq("id", groupOwnerId)
      .maybeSingle()
    groupId = typeof parentPkg?.inventory_group_id === "string" ? parentPkg.inventory_group_id.trim() : ""
  }

  if (groupId) {
    const { data: siblings } = await supabase
      .from("packages")
      .select("id, duration")
      .eq("inventory_group_id", groupId)
    const threeDayIds: string[] = []
    for (const row of siblings ?? []) {
      const sib = row as { id: string; duration: string | null }
      const siblingId = typeof sib.id === "string" ? sib.id.trim() : ""
      if (siblingId) packageIds.add(siblingId)
      if ((sib.duration ?? "").trim() === "3_day" && siblingId) threeDayIds.push(siblingId)
    }

    // Shells (Single Tickets) live outside the group; they mirror the group's inventory at
    // sync time, so include them whenever any sibling changes.
    if (threeDayIds.length > 0) {
      const { data: shells } = await supabase
        .from("packages")
        .select("id")
        .in("shell_parent_package_id", threeDayIds)
      for (const row of shells ?? []) {
        const shellId = typeof (row as { id: string }).id === "string" ? (row as { id: string }).id.trim() : ""
        if (shellId) packageIds.add(shellId)
      }
    }
  }

  return [...packageIds]
}
