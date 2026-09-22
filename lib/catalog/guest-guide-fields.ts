import type { SupabaseClient } from "@supabase/supabase-js"

export type GuestGuideFields = {
  guest_guide_url: string | null
  guest_guide: unknown
}

function emptyFields(): GuestGuideFields {
  return { guest_guide_url: null, guest_guide: null }
}

export async function loadGuestGuideFields(
  supabase: SupabaseClient,
  packageIds: string[],
  options?: { includeContent?: boolean },
): Promise<Map<string, GuestGuideFields>> {
  const ids = [...new Set(packageIds.map((id) => id.trim()).filter(Boolean))]
  const out = new Map<string, GuestGuideFields>()
  if (ids.length === 0) return out

  const columns = options?.includeContent === false ? "id, guest_guide_url" : "id, guest_guide_url, guest_guide"
  const { data, error } = await supabase.from("packages").select(columns).in("id", ids)
  if (error) return out

  for (const row of data ?? []) {
    const record = row as { id?: string; guest_guide_url?: string | null; guest_guide?: unknown }
    if (!record.id) continue
    out.set(record.id, {
      guest_guide_url: typeof record.guest_guide_url === "string" ? record.guest_guide_url : null,
      guest_guide: record.guest_guide ?? null,
    })
  }
  return out
}

export function guestGuideFieldsFor(
  map: Map<string, GuestGuideFields>,
  packageId: string,
): GuestGuideFields {
  return map.get(packageId) ?? emptyFields()
}
