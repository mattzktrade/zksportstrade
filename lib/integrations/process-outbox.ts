import { createAdminClient } from "@/lib/supabase/admin"
import { syncOpportunityOutcomeForOrder } from "@/lib/integrations/salesforce/opportunity-lifecycle"
import { syncOrderToSalesforce } from "@/lib/integrations/salesforce/orders"
import { syncPackageToSalesforce } from "@/lib/integrations/salesforce/products"
import { isSalesforceConfigured } from "@/lib/integrations/salesforce/config"
import { getSalesforceConnectionStatus } from "@/lib/integrations/salesforce/settings-store"
import { createXeroInvoiceForOrder } from "@/lib/integrations/xero/invoices"
import { isXeroConfigured } from "@/lib/integrations/xero/config"
import { getXeroConnectionStatus } from "@/lib/integrations/xero/settings-store"

const MAX_ATTEMPTS = 8
const BATCH_SIZE = 20

type OutboxRow = {
  id: string
  event_type: string
  payload: Record<string, unknown>
  attempts: number
}

export type OutboxFailure = {
  event_type: string
  package_id?: string
  order_id?: string
  error: string
}

export type ProcessOutboxResult = {
  processed: number
  completed: number
  failed: number
  /** Jobs auto-completed because the target row was deleted (e.g. manual Supabase cleanup). */
  orphaned: number
  skipped: boolean
  message?: string
  failures?: OutboxFailure[]
}

/** Thrown when the outbox target no longer exists — job is completed, not retried. */
export class OutboxOrphanedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OutboxOrphanedError"
  }
}

async function assertOrderExistsForOutbox(orderId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Service role not configured.")
  const { data, error } = await admin.from("orders").select("id").eq("id", orderId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) {
    throw new OutboxOrphanedError(`Order ${orderId} no longer exists — skipping sync job.`)
  }
}

async function assertPackageExistsForOutbox(packageId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Service role not configured.")
  const { data, error } = await admin.from("packages").select("id").eq("id", packageId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) {
    throw new OutboxOrphanedError(`Package ${packageId} no longer exists — skipping sync job.`)
  }
}

export async function processIntegrationOutbox(): Promise<ProcessOutboxResult> {
  const admin = createAdminClient()
  if (!admin) {
    return { processed: 0, completed: 0, failed: 0, orphaned: 0, skipped: true, message: "Service role not configured." }
  }

  const { data: rows, error } = await admin
    .from("integration_outbox")
    .select("id, event_type, payload, attempts")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE)

  if (error) {
    return { processed: 0, completed: 0, failed: 0, orphaned: 0, skipped: true, message: error.message }
  }

  const pending = (rows ?? []) as OutboxRow[]
  if (pending.length === 0) {
    return { processed: 0, completed: 0, failed: 0, orphaned: 0, skipped: false }
  }

  let completed = 0
  let failed = 0
  let orphaned = 0
  const failures: OutboxFailure[] = []

  for (const row of pending) {
    const { data: claimed } = await admin
      .from("integration_outbox")
      .update({ status: "processing", attempts: row.attempts + 1 })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle()

    if (!claimed) continue

    try {
      await handleOutboxEvent(row)
      await admin
        .from("integration_outbox")
        .update({ status: "completed", processed_at: new Date().toISOString(), last_error: null })
        .eq("id", row.id)
      completed++
    } catch (e) {
      if (e instanceof OutboxOrphanedError) {
        await admin
          .from("integration_outbox")
          .update({
            status: "completed",
            processed_at: new Date().toISOString(),
            last_error: e.message.slice(0, 2000),
          })
          .eq("id", row.id)
        orphaned++
        continue
      }

      const msg = e instanceof Error ? e.message : String(e)
      failed++
      failures.push({
        event_type: row.event_type,
        package_id:
          typeof row.payload.package_id === "string" ? row.payload.package_id : undefined,
        order_id: typeof row.payload.order_id === "string" ? row.payload.order_id : undefined,
        error: msg.slice(0, 1500),
      })
      const attempts = row.attempts + 1
      const terminal = attempts >= MAX_ATTEMPTS

      await admin
        .from("integration_outbox")
        .update({
          status: terminal ? "failed" : "pending",
          last_error: msg.slice(0, 2000),
          processed_at: terminal ? new Date().toISOString() : null,
        })
        .eq("id", row.id)

      const packageId = typeof row.payload.package_id === "string" ? row.payload.package_id : null
      if (packageId && row.event_type === "product.upsert") {
        await admin
          .from("packages")
          .update({
            integration_sync_status: "failed",
            integration_sync_error: msg.slice(0, 500),
          })
          .eq("id", packageId)
      }

      const orderId = typeof row.payload.order_id === "string" ? row.payload.order_id : null
      if (orderId && row.event_type === "order.placed") {
        await admin
          .from("orders")
          .update({
            salesforce_sync_status: "failed",
            salesforce_sync_error: msg.slice(0, 1000),
          })
          .eq("id", orderId)
      }
      if (orderId && row.event_type === "order.outcome") {
        await admin
          .from("orders")
          .update({ salesforce_sync_error: msg.slice(0, 1000) })
          .eq("id", orderId)
      }
      if (orderId && row.event_type === "invoice.create") {
        await admin
          .from("invoices")
          .update({
            xero_sync_status: "failed",
            xero_sync_error: msg.slice(0, 500),
          })
          .eq("order_id", orderId)
      }
    }
  }

  return { processed: pending.length, completed, failed, orphaned, skipped: false, failures }
}

async function handleOutboxEvent(row: OutboxRow): Promise<void> {
  switch (row.event_type) {
    case "product.upsert":
    case "inventory.snapshot": {
      if (!isSalesforceConfigured()) throw new Error("Salesforce env vars not set.")
      const sf = await getSalesforceConnectionStatus()
      if (!sf.connected) throw new Error("Salesforce not connected.")
      const packageId = String(row.payload.package_id ?? "")
      if (!packageId) throw new Error("Outbox payload missing package_id.")
      await assertPackageExistsForOutbox(packageId)
      await syncPackageToSalesforce(packageId)
      return
    }
    case "order.placed": {
      if (!isSalesforceConfigured()) throw new Error("Salesforce env vars not set.")
      const sf = await getSalesforceConnectionStatus()
      if (!sf.connected) throw new Error("Salesforce not connected.")
      const orderId = String(row.payload.order_id ?? "")
      if (!orderId) throw new Error("Outbox payload missing order_id.")
      await assertOrderExistsForOutbox(orderId)
      await syncOrderToSalesforce(orderId)
      return
    }
    case "order.outcome": {
      if (!isSalesforceConfigured()) throw new Error("Salesforce env vars not set.")
      const sf = await getSalesforceConnectionStatus()
      if (!sf.connected) throw new Error("Salesforce not connected.")
      const orderId = String(row.payload.order_id ?? "")
      const outcome = row.payload.outcome === "lost" ? "lost" : "won"
      if (!orderId) throw new Error("Outbox payload missing order_id.")
      await assertOrderExistsForOutbox(orderId)
      const result = await syncOpportunityOutcomeForOrder(orderId, outcome)
      if (!result.ok) {
        if (result.message.includes("not found") || result.message.includes("no Salesforce Opportunity")) {
          throw new OutboxOrphanedError(result.message)
        }
        throw new Error(result.message)
      }
      return
    }
    case "invoice.create": {
      if (!isXeroConfigured()) throw new Error("Xero env vars not set.")
      const xero = await getXeroConnectionStatus()
      if (!xero.connected) throw new Error("Xero not connected. Open Admin → Integrations → Xero → Connect.")
      const orderId = String(row.payload.order_id ?? "")
      if (!orderId) throw new Error("Outbox payload missing order_id.")
      await assertOrderExistsForOutbox(orderId)
      await createXeroInvoiceForOrder(orderId)
      return
    }
    default:
      throw new Error(`Unknown outbox event type: ${row.event_type}`)
  }
}
