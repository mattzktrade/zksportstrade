import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import { enqueueProductUpsert, productUpsertIdempotencyKey } from "@/lib/integrations/enqueue"
import { scheduleOutboxDrain } from "@/lib/integrations/schedule-drain"
import {
  BROCHURE_PACKAGE_SELECT,
  brochureContentFromPackage,
  raceDisplayName,
  type BrochurePackageRow,
} from "@/lib/brochures/content"
import { generatePackageBrochurePdf } from "@/lib/brochures/pdf"
import { uploadPackageBrochurePdf } from "@/lib/brochures/storage"
import { brochureFilename } from "@/lib/brochures/text"
import type { BrochureCreateResult } from "@/lib/brochures/types"
import { createAdminClient } from "@/lib/supabase/admin"

async function queueBrochureListingSync(
  userSupabase: SupabaseClient,
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  packageId: string,
) {
  const queued = await enqueueProductUpsert(userSupabase, packageId)
  if (queued.ok) return

  const now = new Date().toISOString()
  const { error } = await admin.from("integration_outbox").upsert(
    {
      event_type: "product.upsert",
      idempotency_key: productUpsertIdempotencyKey(packageId),
      payload: { package_id: packageId, triggered_at: now },
      status: "pending",
      attempts: 0,
      last_error: null,
      processed_at: null,
    },
    { onConflict: "idempotency_key" },
  )
  if (error) {
    console.warn("[brochure] listing sync not queued:", error.message)
    return
  }
  await admin
    .from("packages")
    .update({ integration_sync_status: "pending", integration_sync_error: null })
    .eq("id", packageId)
  scheduleOutboxDrain({ packageId })
}

export async function createPackageBrochureForId(input: {
  supabase: SupabaseClient
  packageId: string
  replace: boolean
}): Promise<BrochureCreateResult> {
  const id = input.packageId.trim()
  if (!id) return { ok: false, message: "Package id is missing.", code: "missing" }

  const { data, error } = await input.supabase
    .from("packages")
    .select(BROCHURE_PACKAGE_SELECT)
    .eq("id", id)
    .maybeSingle()
  if (error) return { ok: false, message: error.message }
  if (!data) return { ok: false, message: "Package not found.", code: "missing" }

  const row = data as BrochurePackageRow
  const existing = typeof row.brochure_url === "string" ? row.brochure_url.trim() : ""
  if (existing && !input.replace) {
    return {
      ok: false,
      message: "A brochure is already attached. Confirm to replace it with a newly generated one.",
      code: "exists",
      brochureUrl: existing,
    }
  }

  let raceName = ""
  let category: string | null = null
  if (row.race_id) {
    const { data: race } = await input.supabase
      .from("races")
      .select("name, season, category")
      .eq("id", row.race_id)
      .maybeSingle()
    const name = typeof race?.name === "string" ? race.name.trim() : ""
    const season = typeof race?.season === "number" ? race.season : null
    raceName = raceDisplayName(name, season)
    category = typeof race?.category === "string" ? race.category : null
  }

  const content = brochureContentFromPackage(row, raceName, category)
  const pdf = await generatePackageBrochurePdf(content)
  const uploaded = await uploadPackageBrochurePdf(id, pdf)
  if ("error" in uploaded) return { ok: false, message: uploaded.error }

  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is required to attach the brochure." }

  const { error: updateError } = await admin
    .from("packages")
    .update({ brochure_url: uploaded.url })
    .eq("id", id)
  if (updateError) return { ok: false, message: updateError.message }

  await queueBrochureListingSync(input.supabase, admin, id)

  revalidatePath("/admin/catalog")
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/inventory/sales-list")
  revalidatePath(`/admin/catalog/${id}`)
  revalidatePath("/packages")
  if (row.race_id) revalidatePath(`/packages/race/${row.race_id}`)

  return {
    ok: true,
    brochureUrl: uploaded.url,
    filename: brochureFilename(content.productName, content.productCode),
    replaced: Boolean(existing),
  }
}
