import { createAdminClient } from "@/lib/supabase/admin"
import {
  isCallOutcome,
  summarizeCallAttempts,
  type EnquiryCallAttempt,
  type EnquiryCallSummary,
} from "@/lib/crm/call-outcomes"

function missingCallTable(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === "42P01" || /enquiry_call_attempts|schema cache/i.test(error.message ?? "")
}

export async function listCallAttemptsForDeals(dealIds: string[]): Promise<Record<string, EnquiryCallSummary>> {
  const ids = [...new Set(dealIds.filter(Boolean))]
  const out: Record<string, EnquiryCallSummary> = {}
  if (ids.length === 0) return out
  const admin = createAdminClient()
  if (!admin) return out

  const rowsByDeal = new Map<string, EnquiryCallAttempt[]>()
  const chunkSize = 80
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize)
    const { data, error } = await admin
      .from("enquiry_call_attempts")
      .select(
        "id, deal_id, attempt_no, outcome, lost_reason, notes, callback_at, actor_profile_id, created_at",
      )
      .in("deal_id", slice)
      .order("created_at", { ascending: false })
    if (error) {
      if (!missingCallTable(error)) console.error("[call-attempts]", error.message)
      return out
    }
    for (const row of data ?? []) {
      if (!isCallOutcome(row.outcome)) continue
      const list = rowsByDeal.get(String(row.deal_id)) ?? []
      list.push({
        id: String(row.id),
        deal_id: String(row.deal_id),
        attempt_no: Number(row.attempt_no),
        outcome: row.outcome,
        lost_reason: row.lost_reason ?? null,
        notes: row.notes ?? null,
        callback_at: row.callback_at ?? null,
        actor_profile_id: row.actor_profile_id ?? null,
        actor_name: null,
        created_at: String(row.created_at),
      })
      rowsByDeal.set(String(row.deal_id), list)
    }
  }
  const actorIds = [
    ...new Set([...rowsByDeal.values()].flat().map((row) => row.actor_profile_id).filter(Boolean)),
  ] as string[]
  if (actorIds.length > 0) {
    const { data: actors } = await admin.from("profiles").select("id, full_name").in("id", actorIds)
    const names = new Map((actors ?? []).map((row) => [String(row.id), row.full_name ?? null]))
    for (const rows of rowsByDeal.values()) {
      for (const row of rows) row.actor_name = row.actor_profile_id ? names.get(row.actor_profile_id) ?? null : null
    }
  }
  for (const [dealId, rows] of rowsByDeal) out[dealId] = summarizeCallAttempts(rows)
  return out
}
