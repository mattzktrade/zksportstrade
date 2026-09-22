import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  GUEST_GUIDE_PACKAGE_SELECT,
  brochureContentFromPackage,
  raceDisplayName,
  type BrochurePackageRow,
} from "@/lib/brochures/content"
import {
  assessGuestGuideReadiness,
  parseGuestGuide,
  resolveGuestGuideContent,
} from "@/lib/brochures/guest-guide/content"
import { generatePackageGuestGuidePdf } from "@/lib/brochures/guest-guide/pdf"
import type { GuestGuideContent, GuestGuideCreateResult } from "@/lib/brochures/guest-guide/types"
import { enrichBrochureContent } from "@/lib/brochures/enrich"
import { MIN_BROCHURE_PHOTOS } from "@/lib/brochures/readiness"
import { uploadPackageGuestGuidePdf } from "@/lib/brochures/storage"
import { guestGuideFilename } from "@/lib/brochures/text"
import { BrochureInsufficientImagesError } from "@/lib/brochures/types"
import { createAdminClient } from "@/lib/supabase/admin"

function revalidateGuestGuidePaths(packageId: string, raceId: string | null) {
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/inventory/sales-list")
  revalidatePath(`/admin/catalog/${packageId}`)
  revalidatePath("/packages")
  if (raceId) revalidatePath(`/packages/race/${raceId}`)
}

async function loadPackageRow(
  supabase: SupabaseClient,
  packageId: string,
): Promise<
  | { row: BrochurePackageRow; raceName: string; category: string | null }
  | { error: string; code?: "missing" }
> {
  const { data, error } = await supabase
    .from("packages")
    .select(GUEST_GUIDE_PACKAGE_SELECT)
    .eq("id", packageId)
    .maybeSingle()
  if (error) {
    if (/guest_guide/i.test(error.message)) {
      return {
        error:
          "Guest guide storage is not on this database yet. Run the latest Supabase migration, then try again.",
      }
    }
    return { error: error.message }
  }
  if (!data) return { error: "Package not found.", code: "missing" }

  const row = data as BrochurePackageRow
  let raceName = ""
  let category: string | null = null
  if (row.race_id) {
    const { data: race } = await supabase
      .from("races")
      .select("name, season, category")
      .eq("id", row.race_id)
      .maybeSingle()
    const name = typeof race?.name === "string" ? race.name.trim() : ""
    const season = typeof race?.season === "number" ? race.season : null
    raceName = raceDisplayName(name, season)
    category = typeof race?.category === "string" ? race.category : null
  }

  return { row, raceName, category }
}

export async function savePackageGuestGuideContentForId(input: {
  supabase: SupabaseClient
  packageId: string
  content: GuestGuideContent
}): Promise<{ ok: true } | { ok: false; message: string; code?: "missing" | "forbidden" }> {
  const id = input.packageId.trim()
  if (!id) return { ok: false, message: "Package id is missing.", code: "missing" }

  const loaded = await loadPackageRow(input.supabase, id)
  if ("error" in loaded) return { ok: false, message: loaded.error, code: loaded.code }

  const guide = parseGuestGuide(input.content) ?? input.content
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is required to save the guest guide." }

  const { error } = await admin.from("packages").update({ guest_guide: guide }).eq("id", id)
  if (error) return { ok: false, message: error.message }

  revalidateGuestGuidePaths(id, loaded.row.race_id)
  return { ok: true }
}

export async function createPackageGuestGuideForId(input: {
  supabase: SupabaseClient
  packageId: string
  replace: boolean
  content?: GuestGuideContent
}): Promise<GuestGuideCreateResult> {
  const id = input.packageId.trim()
  if (!id) return { ok: false, message: "Package id is missing.", code: "missing" }

  const loaded = await loadPackageRow(input.supabase, id)
  if ("error" in loaded) return { ok: false, message: loaded.error, code: loaded.code }

  const row = loaded.row
  const existing = typeof row.guest_guide_url === "string" ? row.guest_guide_url.trim() : ""
  if (existing && !input.replace) {
    return {
      ok: false,
      message: "A guest guide is already attached. Confirm to replace it with a newly generated one.",
      code: "exists",
      guestGuideUrl: existing,
    }
  }

  const brochure = enrichBrochureContent(brochureContentFromPackage(row, loaded.raceName, loaded.category))
  const guide = resolveGuestGuideContent({
    stored: row.guest_guide,
    incoming: input.content,
    productName: row.name,
    raceName: loaded.raceName,
    location: row.location,
  })
  const ready = assessGuestGuideReadiness(brochure, guide)
  if (!ready.ok) return { ok: false, message: ready.message, code: ready.code }

  let pdf: Uint8Array
  try {
    pdf = await generatePackageGuestGuidePdf(brochure, guide, { minPhotos: MIN_BROCHURE_PHOTOS })
  } catch (error) {
    if (error instanceof BrochureInsufficientImagesError) {
      return { ok: false, message: error.message, code: error.code }
    }
    throw error
  }

  const filename = guestGuideFilename(brochure.productName, brochure.raceName)
  const uploaded = await uploadPackageGuestGuidePdf(id, pdf, filename)
  if ("error" in uploaded) return { ok: false, message: uploaded.error }

  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is required to attach the guest guide." }

  const { error: updateError } = await admin
    .from("packages")
    .update({ guest_guide_url: uploaded.url, guest_guide: guide })
    .eq("id", id)
  if (updateError) return { ok: false, message: updateError.message }

  revalidateGuestGuidePaths(id, row.race_id)

  return {
    ok: true,
    guestGuideUrl: uploaded.url,
    filename,
    replaced: Boolean(existing),
  }
}
