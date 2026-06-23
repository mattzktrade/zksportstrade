import { createAdminClient } from "@/lib/supabase/admin"

export type RecentSyncFailure = {
  source: "outbox" | "package" | "order"
  event_type?: string
  package_id?: string
  error: string
  created_at: string
}

export async function getRecentSyncFailures(limit = 5): Promise<RecentSyncFailure[]> {
  const admin = createAdminClient()
  if (!admin) return []

  const out: RecentSyncFailure[] = []

  const { data: outbox } = await admin
    .from("integration_outbox")
    .select("event_type, payload, last_error, created_at, processed_at")
    .eq("status", "failed")
    .not("last_error", "is", null)
    .order("processed_at", { ascending: false })
    .limit(limit)

  for (const row of outbox ?? []) {
    const payload = row.payload as Record<string, unknown> | null
    out.push({
      source: "outbox",
      event_type: row.event_type ?? undefined,
      package_id: typeof payload?.package_id === "string" ? payload.package_id : undefined,
      error: String(row.last_error ?? ""),
      created_at: String(row.processed_at ?? row.created_at),
    })
  }

  const { data: packages } = await admin
    .from("packages")
    .select("id, name, integration_sync_error, integration_synced_at")
    .eq("integration_sync_status", "failed")
    .not("integration_sync_error", "is", null)
    .order("integration_synced_at", { ascending: false })
    .limit(limit)

  for (const p of packages ?? []) {
    out.push({
      source: "package",
      package_id: p.id,
      error: String(p.integration_sync_error ?? ""),
      created_at: String(p.integration_synced_at ?? ""),
    })
  }

  // Orders that failed Salesforce sync (Opportunity create or line item).
  const { data: orders } = await admin
    .from("orders")
    .select("id, reference, salesforce_sync_error, salesforce_synced_at, salesforce_sync_status")
    .or("salesforce_sync_status.eq.failed,salesforce_line_item_status.eq.failed")
    .not("salesforce_sync_error", "is", null)
    .order("salesforce_synced_at", { ascending: false })
    .limit(limit)

  for (const o of orders ?? []) {
    out.push({
      source: "order",
      error: `Order ${o.reference}: ${String(o.salesforce_sync_error ?? "")}`,
      created_at: String(o.salesforce_synced_at ?? ""),
    })
  }

  return out
    .sort((a, b) => (b.created_at > a.created_at ? 1 : -1))
    .slice(0, limit)
}
