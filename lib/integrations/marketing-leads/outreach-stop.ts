import { createAdminClient } from "@/lib/supabase/admin"
import { missingOutreachRelation } from "@/lib/integrations/marketing-leads/outreach-labels"
import type { MarketingOutreachStopReason } from "@/lib/integrations/marketing-leads/outreach-types"

export async function stopMarketingOutreach(
  dealId: string,
  reason: MarketingOutreachStopReason,
): Promise<{ ok: boolean; stopped: boolean }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, stopped: false }
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from("marketing_outreach_enrollments")
    .update({
      status: "stopped",
      stop_reason: reason,
      stopped_at: now,
      next_stage_due_at: null,
      updated_at: now,
    })
    .eq("deal_id", dealId)
    .eq("status", "active")
    .select("id")
  if (error) {
    if (missingOutreachRelation(error)) return { ok: true, stopped: false }
    return { ok: false, stopped: false }
  }
  const stopped = (data ?? []).length > 0
  if (stopped) {
    await admin.from("deal_activities").insert({
      deal_id: dealId,
      actor_profile_id: null,
      action: "marketing_outreach_stopped",
      summary:
        reason === "replied"
          ? "Lead replied — marketing follow-up stopped"
          : reason === "staff"
            ? "Staff took over — marketing follow-up stopped"
            : reason === "not_interested"
              ? "Marked not interested — marketing follow-up stopped"
              : reason === "stop_keyword"
                ? "Lead asked to stop marketing follow-up"
                : reason === "no_channel"
                  ? "No email or phone for marketing follow-up"
                  : "Marketing follow-up stopped",
      metadata: { reason },
    })
  }
  return { ok: true, stopped }
}

export function staffStageShouldStopOutreach(enquiryStage: string): boolean {
  return enquiryStage !== "new"
}
