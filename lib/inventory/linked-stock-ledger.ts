import type { SupabaseClient } from "@supabase/supabase-js"

const LINKED_SPLIT_DURATIONS = new Set([
  "thursday_only",
  "friday_only",
  "saturday_only",
  "sunday_only",
  "2_day",
])

export function isLinkedSplitDuration(duration: string | null | undefined): boolean {
  return LINKED_SPLIT_DURATIONS.has((duration ?? "").trim())
}

export async function resolveLinkedStockLedger(
  supabase: SupabaseClient,
  packageId: string,
): Promise<{
  ledgerPackageId: string
  usedParentLedger: boolean
  duration: string
  groupId: string | null
  isShell: boolean
}> {
  const id = packageId.trim()
  const { data: pkg } = await supabase
    .from("packages")
    .select("inventory_group_id, duration, shell_parent_package_id")
    .eq("id", id)
    .maybeSingle()

  const groupId = (pkg as { inventory_group_id?: string | null } | null)?.inventory_group_id?.trim() || null
  const duration = (pkg as { duration?: string | null } | null)?.duration?.trim() ?? ""
  const isShell = !!(pkg as { shell_parent_package_id?: string | null } | null)?.shell_parent_package_id?.trim()

  if (!groupId || isShell) {
    return { ledgerPackageId: id, usedParentLedger: false, duration, groupId, isShell }
  }

  if (!isLinkedSplitDuration(duration) && duration !== "3_day") {
    return { ledgerPackageId: id, usedParentLedger: false, duration, groupId, isShell }
  }

  const { data: siblings } = await supabase
    .from("packages")
    .select("id, duration")
    .eq("inventory_group_id", groupId)
    .is("shell_parent_package_id", null)
    .order("id")

  const threeDay = (siblings ?? []).find((row) => String(row.duration ?? "").trim() === "3_day")
  const twoDay = (siblings ?? []).find((row) => String(row.duration ?? "").trim() === "2_day")
  const parentId =
    (threeDay && duration !== "3_day" ? String(threeDay.id).trim() : "") ||
    (twoDay && duration !== "3_day" && duration !== "2_day" ? String(twoDay.id).trim() : "")
  if (parentId && parentId !== id) {
    return { ledgerPackageId: parentId, usedParentLedger: true, duration, groupId, isShell }
  }

  return { ledgerPackageId: id, usedParentLedger: false, duration, groupId, isShell }
}

/** Split products whose 3-day sibling already owns the purchase ledger. */
export async function packageIdsOnSharedThreeDayLedger(
  supabase: SupabaseClient,
  packageIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(packageIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return new Set()

  const { data: packages } = await supabase
    .from("packages")
    .select("id, duration, inventory_group_id, shell_parent_package_id")
    .in("id", ids)

  const splits = (packages ?? []).filter((row) => {
    const duration = typeof row.duration === "string" ? row.duration.trim() : ""
    const groupId = typeof row.inventory_group_id === "string" ? row.inventory_group_id.trim() : ""
    return groupId && !row.shell_parent_package_id && isLinkedSplitDuration(duration)
  })
  if (splits.length === 0) return new Set()

  const groupIds = [
    ...new Set(
      splits
        .map((row) => (typeof row.inventory_group_id === "string" ? row.inventory_group_id.trim() : ""))
        .filter(Boolean),
    ),
  ]
  const { data: parents } = await supabase
    .from("packages")
    .select("id, duration, inventory_group_id")
    .in("inventory_group_id", groupIds)
    .in("duration", ["3_day", "2_day"])
    .is("shell_parent_package_id", null)
  const parentIds = [...new Set((parents ?? []).map((row) => String(row.id)))]
  if (parentIds.length === 0) return new Set()

  const { data: parentLayers } = await supabase
    .from("package_cost_layers")
    .select("package_id")
    .in("package_id", parentIds)
  const parentIdsWithLayers = new Set((parentLayers ?? []).map((row) => String(row.package_id)))
  const groupsWithThreeDayLedger = new Set(
    (parents ?? [])
      .filter((parent) => parent.duration === "3_day" && parentIdsWithLayers.has(String(parent.id)))
      .map((parent) => String(parent.inventory_group_id ?? "").trim())
      .filter(Boolean),
  )
  const groupsWithTwoDayLedger = new Set(
    (parents ?? [])
      .filter((parent) => parent.duration === "2_day" && parentIdsWithLayers.has(String(parent.id)))
      .map((parent) => String(parent.inventory_group_id ?? "").trim())
      .filter(Boolean),
  )

  return new Set(
    splits
      .filter((row) => {
        const groupId = String(row.inventory_group_id ?? "").trim()
        const duration = String(row.duration ?? "").trim()
        if (groupsWithThreeDayLedger.has(groupId) && duration !== "3_day") return true
        if (
          !groupsWithThreeDayLedger.has(groupId) &&
          groupsWithTwoDayLedger.has(groupId) &&
          duration !== "2_day" &&
          duration !== "3_day"
        ) {
          return true
        }
        return false
      })
      .map((row) => String(row.id)),
  )
}
