import { productUpsertIdempotencyKey } from "@/lib/integrations/enqueue"
import { packageIdsForInventoryChannelSync } from "@/lib/integrations/inventory-sync-packages"
import { drainOutboxNow, scheduleOutboxDrain } from "@/lib/integrations/schedule-drain"
import { createAdminClient } from "@/lib/supabase/admin"
import type { OrderChannel } from "@/lib/integrations/types"

type OutboxRowInput = {
  event_type: string
  idempotency_key: string
  payload: Record<string, unknown>
}

/**
 * Insert or re-queue an outbox row without clobbering a job that is already processing/completed.
 * Prevents duplicate Salesforce Opportunities when checkout and cron overlap.
 */
async function enqueueOutboxOnce(
  row: OutboxRowInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role not configured." }

  const { data: existing, error: readErr } = await admin
    .from("integration_outbox")
    .select("id, status")
    .eq("idempotency_key", row.idempotency_key)
    .maybeSingle()

  if (readErr) return { ok: false, message: readErr.message }

  if (!existing) {
    const { error } = await admin.from("integration_outbox").insert({
      ...row,
      status: "pending",
      attempts: 0,
      last_error: null,
      processed_at: null,
      created_at: new Date().toISOString(),
    })
    if (error) return { ok: false, message: error.message }
    return { ok: true }
  }

  if (existing.status === "processing" || existing.status === "completed" || existing.status === "pending") {
    return { ok: true }
  }

  if (existing.status === "failed") {
    const { error } = await admin
      .from("integration_outbox")
      .update({
        event_type: row.event_type,
        payload: row.payload,
        status: "pending",
        attempts: 0,
        last_error: null,
        processed_at: null,
      })
      .eq("id", existing.id)
    if (error) return { ok: false, message: error.message }
  }

  return { ok: true }
}

/**
 * Push portal sellable qty → Salesforce Available after inventory changes.
 * Uses service-role outbox insert (checkout has no admin session — the RPC path would fail).
 */
export async function enqueuePackageInventorySyncServer(
  packageId: string,
  options?: { trigger?: string; scheduleDrain?: boolean },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const id = packageId.trim()
  if (!id) return { ok: false, message: "Package id is missing." }

  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role not configured." }

  const { error } = await admin.from("integration_outbox").upsert(
    {
      event_type: "product.upsert",
      idempotency_key: productUpsertIdempotencyKey(id),
      payload: {
        package_id: id,
        triggered_at: new Date().toISOString(),
        trigger: options?.trigger ?? "server",
      },
      status: "pending",
      attempts: 0,
      last_error: null,
      processed_at: null,
      created_at: new Date().toISOString(),
    },
    { onConflict: "idempotency_key" },
  )

  if (error) return { ok: false, message: error.message }

  await admin
    .from("packages")
    .update({ integration_sync_status: "pending", integration_sync_error: null })
    .eq("id", id)

  if (options?.scheduleDrain !== false) {
    scheduleOutboxDrain({ packageId: id })
  }
  return { ok: true }
}

/** Service-role path for cron / background jobs (linked inventory siblings included). */
export async function enqueuePackageInventoryChannelSyncServer(
  packageId: string,
  options?: { trigger?: string; scheduleDrain?: boolean },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role not configured." }

  const packageIds = await packageIdsForInventoryChannelSync(admin, packageId)
  if (packageIds.length === 0) {
    return { ok: false, message: "Package id is missing." }
  }

  for (const id of packageIds) {
    const enq = await enqueuePackageInventorySyncServer(id, {
      trigger: options?.trigger,
      scheduleDrain: false,
    })
    if (!enq.ok) return enq
  }

  if (options?.scheduleDrain !== false) {
    scheduleOutboxDrain({ packageId: packageId.trim(), maxRounds: 10 })
  }
  return { ok: true }
}

async function enqueuePackageInventorySyncForOrder(
  orderId: string,
): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null

  const { data: order } = await admin
    .from("orders")
    .select("package_id")
    .eq("id", orderId.trim())
    .maybeSingle()
  const packageId = order?.package_id?.trim()
  if (!packageId) return null

  const enq = await enqueuePackageInventoryChannelSyncServer(packageId, {
    trigger: `order:${orderId.trim()}`,
    scheduleDrain: false,
  })
  if (!enq.ok) console.warn("[integrations] Package inventory sync not queued:", enq.message)
  return packageId
}

export async function enqueueOrderPlacedServer(
  orderId: string,
  channel: OrderChannel,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const id = orderId.trim()
  if (!id) return { ok: false, message: "Order id is missing." }

  const admin = createAdminClient()
  if (!admin) {
    return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is not configured; order sync was not queued." }
  }

  await admin
    .from("orders")
    .update({ channel, salesforce_sync_status: "pending", salesforce_sync_error: null })
    .eq("id", id)

  const enq = await enqueueOutboxOnce({
    event_type: "order.placed",
    idempotency_key: `order.placed:${id}`,
    payload: { order_id: id, channel, triggered_at: new Date().toISOString() },
  })
  if (!enq.ok) return enq
  return { ok: true }
}

export async function enqueueInvoiceCreateServer(
  orderId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const id = orderId.trim()
  if (!id) return { ok: false, message: "Order id is missing." }

  const admin = createAdminClient()
  if (!admin) {
    return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is not configured; Xero sync was not queued." }
  }

  await admin
    .from("invoices")
    .update({ xero_sync_status: "pending", xero_sync_error: null })
    .eq("order_id", id)

  const enq = await enqueueOutboxOnce({
    event_type: "invoice.create",
    idempotency_key: `invoice.create:${id}`,
    payload: { order_id: id, triggered_at: new Date().toISOString() },
  })
  if (!enq.ok) return enq
  return { ok: true }
}

export async function enqueueOpportunityOutcomeServer(
  orderId: string,
  outcome: "won" | "lost",
): Promise<{ ok: true } | { ok: false; message: string }> {
  const id = orderId.trim()
  if (!id) return { ok: false, message: "Order id is missing." }

  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role not configured." }

  const { error } = await admin.from("integration_outbox").upsert(
    {
      event_type: "order.outcome",
      idempotency_key: `order.outcome:${outcome}:${id}:${Date.now()}`,
      payload: { order_id: id, outcome, triggered_at: new Date().toISOString() },
      status: "pending",
      attempts: 0,
      last_error: null,
      processed_at: null,
      created_at: new Date().toISOString(),
    },
    { onConflict: "idempotency_key" },
  )

  if (error) return { ok: false, message: error.message }

  const packageId = await enqueuePackageInventorySyncForOrder(id)
  scheduleOutboxDrain({ orderId: id, packageId: packageId ?? undefined, maxRounds: 15 })
  return { ok: true }
}

/** Queue Salesforce opportunity sync + Xero invoice creation for a new order. */
export async function enqueueOrderIntegrationsServer(
  orderId: string,
  channel: OrderChannel,
  options?: { background?: boolean },
): Promise<{ ok: true; warnings: string[] } | { ok: false; message: string }> {
  const warnings: string[] = []
  const sf = await enqueueOrderPlacedServer(orderId, channel)
  if (!sf.ok) warnings.push(`Salesforce: ${sf.message}`)

  if (channel === "wix") {
    // Customer paid on Wix checkout — no unpaid Xero invoice or invoice email to the buyer.
    // Closed Won runs at end of syncOrderToSalesforce once the Opportunity exists.
    if (!sf.ok) {
      return { ok: false, message: warnings.join(" ") }
    }
  } else {
    const xero = await enqueueInvoiceCreateServer(orderId)
    if (!xero.ok) warnings.push(`Xero: ${xero.message}`)
    if (!sf.ok && !xero.ok) {
      return { ok: false, message: warnings.join(" ") }
    }
  }

  const packageId = await enqueuePackageInventorySyncForOrder(orderId)

  const drainOptions = { orderId, packageId: packageId ?? undefined, maxRounds: 20 as const }

  if (options?.background) {
    scheduleOutboxDrain(drainOptions)
    return { ok: true, warnings }
  }

  try {
    const drain = await drainOutboxNow(drainOptions)
    if (drain.failed > 0) {
      warnings.push(
        `Sync queue: ${drain.failed} job(s) failed — retry from Admin → Integrations if needed.`,
      )
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "drain failed"
    warnings.push(`Sync queue: ${msg}`)
    scheduleOutboxDrain(drainOptions)
  }
  return { ok: true, warnings }
}
