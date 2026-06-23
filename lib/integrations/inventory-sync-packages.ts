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
    .select("inventory_group_id")
    .eq("id", id)
    .maybeSingle()

  const groupId = typeof pkg?.inventory_group_id === "string" ? pkg.inventory_group_id.trim() : ""
  if (groupId) {
    const { data: siblings } = await supabase.from("packages").select("id").eq("inventory_group_id", groupId)
    for (const row of siblings ?? []) {
      const siblingId = typeof row.id === "string" ? row.id.trim() : ""
      if (siblingId) packageIds.add(siblingId)
    }
  }

  return [...packageIds]
}
