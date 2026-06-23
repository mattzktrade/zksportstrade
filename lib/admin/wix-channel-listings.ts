import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

export type WixChannelListingRow = {
  id: string
  package_id: string
  external_id: string
  external_variant_id: string | null
  page_url: string | null
  metadata: Record<string, unknown>
  last_synced_at: string | null
  last_sync_error: string | null
}

const WIX_LISTING_COLUMNS =
  "id, package_id, external_id, external_variant_id, page_url, metadata, last_synced_at, last_sync_error" as const

function wixListingsClient() {
  return createAdminClient()
}

export async function getWixChannelListingsForPackage(packageId: string): Promise<WixChannelListingRow[]> {
  const supabase = wixListingsClient() ?? (await createClient())
  const { data, error } = await supabase
    .from("channel_listings")
    .select(WIX_LISTING_COLUMNS)
    .eq("package_id", packageId)
    .eq("channel", "wix")
    .order("created_at", { ascending: true })

  if (error) {
    console.error("[wix listings] load failed:", error.message)
    return []
  }
  return (data ?? []) as WixChannelListingRow[]
}

/** All Wix mappings keyed by portal package id (admin catalog expand rows). */
export async function getWixChannelListingsByPackage(): Promise<Record<string, WixChannelListingRow[]>> {
  const supabase = wixListingsClient()
  if (!supabase) return {}

  const { data, error } = await supabase
    .from("channel_listings")
    .select(WIX_LISTING_COLUMNS)
    .eq("channel", "wix")
    .order("created_at", { ascending: true })

  if (error) {
    console.error("[wix listings] bulk load failed:", error.message)
    return {}
  }

  const map: Record<string, WixChannelListingRow[]> = {}
  for (const row of (data ?? []) as WixChannelListingRow[]) {
    ;(map[row.package_id] ??= []).push(row)
  }
  return map
}
