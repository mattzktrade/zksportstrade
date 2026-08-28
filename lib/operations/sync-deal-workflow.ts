import { createAdminClient } from "@/lib/supabase/admin"
import { DEAL_STAGE_LABELS, type DealStage } from "@/lib/crm/deal-types"
import { dealStageFromOperations, nextActionForDealStage } from "@/lib/crm/deal-workflow"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type WorkflowDb = NonNullable<ReturnType<typeof createAdminClient>>

export async function syncDealWorkflowFromOperations(
  db: WorkflowDb,
  input: {
    actorProfileId: string
    dealId?: string | null
    orderId?: string | null
    guestDetailsStatus: string
    deliveryStatus: string
    fulfilmentStatus?: string
  },
): Promise<void> {
  const dealId = await resolveDealId(db, input.dealId, input.orderId)
  if (!dealId) return

  const { data: deal, error: readError } = await db
    .from("deals")
    .select("id, stage")
    .eq("id", dealId)
    .maybeSingle()
  if (readError) throw new Error(readError.message)
  if (!deal?.stage) return

  const next = dealStageFromOperations({
    currentStage: String(deal.stage),
    guestDetailsStatus: input.guestDetailsStatus,
    deliveryStatus: input.deliveryStatus,
    fulfilmentStatus: input.fulfilmentStatus,
  })
  if (!next || next === deal.stage) return

  const now = new Date().toISOString()
  const patch: {
    stage: DealStage
    next_action: string
    updated_at: string
    closed_at?: string
  } = {
    stage: next,
    next_action: nextActionForDealStage(next),
    updated_at: now,
  }
  if (next === "fulfilled") patch.closed_at = now

  const { error: updateError } = await db.from("deals").update(patch).eq("id", dealId)
  if (updateError) throw new Error(updateError.message)

  const previous = String(deal.stage) as DealStage
  const { error: activityError } = await db.from("deal_activities").insert({
    deal_id: dealId,
    actor_profile_id: input.actorProfileId,
    action: "stage_changed",
    summary: `Deal stage changed from ${DEAL_STAGE_LABELS[previous] ?? previous} to ${DEAL_STAGE_LABELS[next]}`,
    metadata: {
      previous_stage: previous,
      stage: next,
      source: "operations",
    },
  })
  if (activityError) throw new Error(activityError.message)
}

async function resolveDealId(
  db: WorkflowDb,
  dealId: string | null | undefined,
  orderId: string | null | undefined,
): Promise<string | null> {
  const direct = dealId?.trim() ?? ""
  if (UUID_RE.test(direct)) return direct
  const order = orderId?.trim() ?? ""
  if (!UUID_RE.test(order)) return null

  const { data: byOrder, error: dealError } = await db
    .from("deals")
    .select("id")
    .eq("order_id", order)
    .maybeSingle()
  if (dealError) throw new Error(dealError.message)
  if (byOrder?.id) return String(byOrder.id)

  const { data: orderRow, error: orderError } = await db
    .from("orders")
    .select("deal_id")
    .eq("id", order)
    .maybeSingle()
  if (orderError) throw new Error(orderError.message)
  const linked = orderRow?.deal_id ? String(orderRow.deal_id) : ""
  return UUID_RE.test(linked) ? linked : null
}
