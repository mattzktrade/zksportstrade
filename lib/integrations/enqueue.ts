import { packageIdsForInventoryChannelSync } from "@/lib/integrations/inventory-sync-packages"
import { scheduleOutboxDrain } from "@/lib/integrations/schedule-drain"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { ProductUpsertPayload } from "@/lib/integrations/types"

/** Coalesce rapid saves: one pending product.upsert per package. */
export function productUpsertIdempotencyKey(packageId: string): string {
  return `product.upsert:${packageId}`
}

/** Force a new outbox row (retry button). */
export function productUpsertRetryIdempotencyKey(packageId: string): string {
  return `product.upsert:${packageId}:${Date.now()}`
}

export async function enqueueProductUpsert(
  supabase: SupabaseClient,
  packageId: string,
  options?: { retry?: boolean },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const id = packageId.trim()
  if (!id) return { ok: false, message: "Package id is missing." }

  const payload: ProductUpsertPayload = {
    package_id: id,
    triggered_at: new Date().toISOString(),
  }

  const key = options?.retry ? productUpsertRetryIdempotencyKey(id) : productUpsertIdempotencyKey(id)

  const { error } = await supabase.rpc("enqueue_integration_event", {
    p_event_type: "product.upsert",
    p_idempotency_key: key,
    p_payload: payload,
  })

  if (error) return { ok: false, message: error.message }

  scheduleOutboxDrain({ packageId: id })
  return { ok: true }
}

/** Queue Salesforce + Wix inventory sync for a package (and linked inventory siblings). */
export async function enqueuePackageInventoryChannelSync(
  supabase: SupabaseClient,
  packageId: string,
): Promise<void> {
  const packageIds = await packageIdsForInventoryChannelSync(supabase, packageId)
  for (const pkgId of packageIds) {
    const enq = await enqueueProductUpsert(supabase, pkgId)
    if (!enq.ok) console.warn(`[inventory] product sync not queued for ${pkgId}:`, enq.message)
  }
}
