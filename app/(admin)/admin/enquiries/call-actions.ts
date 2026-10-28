"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getPortalProfile } from "@/lib/supabase/profile"
import { hasCmsPermission } from "@/lib/auth/permissions"
import {
  CALL_LOST_REASON_LABELS,
  CALL_OUTCOME_LABELS,
  callOutcomeNeedsCallback,
  callOutcomeNeedsLostReason,
  isCallLostReason,
  isCallOutcome,
  planCallOutcome,
} from "@/lib/crm/call-outcomes"
import { isEnquiryPipelineStage } from "@/lib/crm/deal-pipeline"
import { timezoneForPhone } from "@/lib/crm/lead-timezone"
import { stopMarketingOutreach } from "@/lib/integrations/marketing-leads/outreach-stop"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

type RaceRef = { event_date: string | null } | Array<{ event_date: string | null }> | null

function earliestEventDate(deal: {
  races?: RaceRef
  deal_line_items?: Array<{ packages?: { races?: RaceRef } | Array<{ races?: RaceRef }> | null }> | null
}): string | null {
  const dates = [one(deal.races)?.event_date ?? null]
  for (const line of deal.deal_line_items ?? []) {
    dates.push(one(one(line.packages)?.races)?.event_date ?? null)
  }
  const valid = dates.filter((value): value is string => Boolean(value)).sort()
  return valid[0] ?? null
}

export async function logEnquiryCall(input: {
  dealId: string
  outcome: string
  notes?: string | null
  lostReason?: string | null
  callbackAt?: string | null
}): Promise<{ ok: boolean; message: string }> {
  const profile = await getPortalProfile()
  if (!profile) return { ok: false, message: "Not signed in." }
  if (!hasCmsPermission(profile, "deals.manage")) {
    return { ok: false, message: "You do not have permission for this action." }
  }
  const dealId = input.dealId.trim()
  if (!UUID_RE.test(dealId)) return { ok: false, message: "Enquiry id is not valid." }
  if (!isCallOutcome(input.outcome)) return { ok: false, message: "Choose a call outcome." }
  const outcome = input.outcome
  const notes = input.notes?.trim().slice(0, 2000) || null

  let lostReason = input.lostReason?.trim() || null
  if (outcome === "connected_booked") lostReason = "booked_direct"
  if (lostReason && !isCallLostReason(lostReason)) return { ok: false, message: "Lost reason is not valid." }
  if (callOutcomeNeedsLostReason(outcome) && !lostReason) {
    return { ok: false, message: "Pick why they are not interested." }
  }

  let callbackAt: Date | null = null
  if (input.callbackAt?.trim()) {
    callbackAt = new Date(input.callbackAt)
    if (Number.isNaN(callbackAt.getTime())) return { ok: false, message: "Callback time is not valid." }
  }
  if (callOutcomeNeedsCallback(outcome) && !callbackAt) {
    return { ok: false, message: "Pick when to call them back." }
  }

  const supabase = await createClient()
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role not configured." }

  const { data: deal, error: dealError } = await admin
    .from("deals")
    .select(
      `
      id, stage, enquiry_stage, enquiry_temperature, owner_profile_id,
      crm_contacts!primary_contact_id ( phone ),
      races ( event_date ),
      deal_line_items ( packages ( races ( event_date ) ) )
    `,
    )
    .eq("id", dealId)
    .maybeSingle()
  if (dealError || !deal) return { ok: false, message: dealError?.message || "Enquiry not found." }

  const { count, error: countError } = await admin
    .from("enquiry_call_attempts")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
  if (countError) return { ok: false, message: countError.message }
  const attemptNo = (count ?? 0) + 1

  const contact = one(deal.crm_contacts as { phone: string | null } | Array<{ phone: string | null }> | null)
  const now = new Date()
  const plan = planCallOutcome({
    outcome,
    attemptNo,
    now,
    timeZone: timezoneForPhone(contact?.phone),
    callbackAt,
    eventDate: earliestEventDate(deal as Parameters<typeof earliestEventDate>[0]),
  })

  const { error: insertError } = await supabase.from("enquiry_call_attempts").insert({
    deal_id: dealId,
    attempt_no: attemptNo,
    outcome,
    lost_reason: lostReason,
    notes,
    callback_at: callbackAt?.toISOString() ?? null,
    actor_profile_id: profile.id,
  })
  if (insertError) return { ok: false, message: insertError.message }

  const ownerProfileId = (deal.owner_profile_id as string | null) ?? profile.id
  const nextActionDueAt = plan.nextActionDueAt?.toISOString() ?? null
  const inEnquiryPipeline = isEnquiryPipelineStage(String(deal.stage))

  if (plan.enquiryStage && inEnquiryPipeline) {
    const { error } = await supabase.rpc("admin_update_enquiry_pipeline", {
      p_deal_id: dealId,
      p_enquiry_stage: plan.enquiryStage,
      p_enquiry_temperature: plan.temperature ?? deal.enquiry_temperature ?? null,
      p_owner_profile_id: ownerProfileId,
      p_next_action: plan.nextAction || null,
      p_next_action_due_at: nextActionDueAt,
    })
    if (error) return { ok: false, message: `Call saved, but the stage did not update: ${error.message}` }
  } else if (inEnquiryPipeline) {
    const { error } = await admin
      .from("deals")
      .update({
        owner_profile_id: ownerProfileId,
        next_action: plan.nextAction || null,
        next_action_due_at: nextActionDueAt,
        ...(plan.temperature ? { enquiry_temperature: plan.temperature } : {}),
        updated_at: now.toISOString(),
      })
      .eq("id", dealId)
    if (error) return { ok: false, message: `Call saved, but the next step did not update: ${error.message}` }
  }

  if (plan.stopReason) {
    await stopMarketingOutreach(dealId, plan.stopReason).catch(() => undefined)
  }
  if (plan.blockWhatsApp) {
    await admin
      .from("marketing_outreach_enrollments")
      .update({ whatsapp_blocked: true, updated_at: now.toISOString() })
      .eq("deal_id", dealId)
  }

  const summaryParts = [`Call ${attemptNo}: ${CALL_OUTCOME_LABELS[outcome]}`]
  if (lostReason && isCallLostReason(lostReason)) summaryParts.push(CALL_LOST_REASON_LABELS[lostReason])
  if (plan.noResponse) summaryParts.push("no response after all attempts")
  if (notes) summaryParts.push(notes)
  await supabase.from("deal_activities").insert({
    deal_id: dealId,
    actor_profile_id: profile.id,
    action: "call_logged",
    summary: summaryParts.join(" — "),
    metadata: {
      attemptNo,
      outcome,
      lostReason,
      callbackAt: callbackAt?.toISOString() ?? null,
      nextAction: plan.nextAction,
      nextActionDueAt,
    },
  })

  revalidatePath("/admin/enquiries", "layout")
  revalidatePath("/admin/deals", "layout")
  revalidatePath("/admin")
  return {
    ok: true,
    message: plan.noResponse
      ? "Call logged. No response after 5 attempts — marked Cold."
      : plan.stopReason
        ? "Call logged. Automated follow-up stopped."
        : "Call logged.",
  }
}
