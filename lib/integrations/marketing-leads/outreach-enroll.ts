import { createAdminClient } from "@/lib/supabase/admin"
import { outreachDelayMs, outreachDueAt } from "@/lib/integrations/marketing-leads/outreach-delay"
import { missingOutreachRelation } from "@/lib/integrations/marketing-leads/outreach-labels"
import { resolveOutreachInterestForDeal } from "@/lib/integrations/marketing-leads/outreach-interest"
import { firstNameFromFullName } from "@/lib/integrations/marketing-leads/outreach-render"
import { MARKETING_OUTREACH_SEQUENCE } from "@/lib/integrations/marketing-leads/outreach-types"
import { normalizeMarketingPhone } from "@/lib/integrations/marketing-leads/parse"
import { processMarketingOutreach } from "@/lib/integrations/marketing-leads/outreach-process"
import { findActiveOutreachByEmail, findActiveOutreachByPhone } from "@/lib/integrations/marketing-leads/outreach-store"

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export async function enrollMarketingOutreach(dealId: string): Promise<{ ok: boolean; enrolled: boolean; message?: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, enrolled: false, message: "Service role not configured." }

  const { data: deal, error: dealError } = await admin
    .from("deals")
    .select(
      `
      id, source, account_id, primary_contact_id, race_id, enquiry_stage, notes,
      crm_contacts!primary_contact_id ( id, full_name, email, phone )
    `,
    )
    .eq("id", dealId)
    .maybeSingle()
  if (dealError || !deal) {
    return { ok: false, enrolled: false, message: dealError?.message || "Deal not found." }
  }
  if (deal.source !== "marketing") {
    return { ok: true, enrolled: false, message: "Not a marketing enquiry." }
  }

  const { data: settings, error: settingsError } = await admin
    .from("marketing_outreach_settings")
    .select("enabled")
    .eq("sequence_key", MARKETING_OUTREACH_SEQUENCE)
    .maybeSingle()
  if (settingsError && missingOutreachRelation(settingsError)) {
    return { ok: true, enrolled: false, message: "Outreach tables are not applied yet." }
  }
  if (settings?.enabled !== true) {
    return { ok: true, enrolled: false, message: "Marketing follow-up is paused." }
  }

  const contact = one(
    deal.crm_contacts as
      | { id: string; full_name: string; email: string | null; phone: string | null }
      | Array<{ id: string; full_name: string; email: string | null; phone: string | null }>
      | null,
  )
  const email = contact?.email?.trim().toLowerCase() || null
  const phone = contact?.phone?.trim() || null
  const phoneDigits = phone ? normalizeMarketingPhone(phone) : ""
  if (!email && phoneDigits.length < 8) {
    return { ok: true, enrolled: false, message: "No email or phone." }
  }

  const existing =
    (email ? await findActiveOutreachByEmail(admin, email) : null) ??
    (phoneDigits.length >= 8 ? await findActiveOutreachByPhone(admin, phoneDigits) : null)
  if (existing && existing.deal_id !== dealId) {
    await admin.from("deal_activities").insert([
      {
        deal_id: dealId,
        actor_profile_id: null,
        action: "marketing_outreach_duplicate",
        summary: "Already in marketing follow-up on another enquiry — not enrolled again",
        metadata: { otherDealId: existing.deal_id },
      },
      {
        deal_id: existing.deal_id,
        actor_profile_id: null,
        action: "marketing_outreach_duplicate",
        summary: "Same person sent another enquiry — follow-up continues here only",
        metadata: { otherDealId: dealId },
      },
    ])
    return { ok: true, enrolled: false, message: "Already in follow-up on another enquiry." }
  }

  const interest = await resolveOutreachInterestForDeal(admin, dealId)
  const fullName = contact?.full_name?.trim() || "there"
  const { data: stage1, error: stage1Error } = await admin
    .from("marketing_outreach_steps")
    .select("delay_hours, delay_minutes")
    .eq("sequence_key", MARKETING_OUTREACH_SEQUENCE)
    .eq("stage", 1)
    .maybeSingle()
  const stage1Delay =
    stage1Error || !stage1
      ? { delay_hours: 0, delay_minutes: 5 }
      : {
          delay_hours: Number(stage1.delay_hours) || 0,
          delay_minutes: Number(stage1.delay_minutes) || 0,
        }

  const now = new Date()
  const insert = await admin
    .from("marketing_outreach_enrollments")
    .insert({
      deal_id: dealId,
      account_id: deal.account_id,
      contact_id: contact?.id ?? deal.primary_contact_id,
      sequence_key: MARKETING_OUTREACH_SEQUENCE,
      status: "active",
      current_stage: 0,
      next_stage_due_at: outreachDueAt(stage1Delay, now),
      first_name: firstNameFromFullName(fullName),
      full_name: fullName,
      email,
      phone,
      phone_digits: phoneDigits || null,
      interest_event: interest.event,
      interest_package: interest.packageName,
      interest_quantity: interest.quantity,
    })
    .select("id")
    .maybeSingle()

  if (insert.error) {
    if (missingOutreachRelation(insert.error)) {
      return { ok: true, enrolled: false, message: "Outreach tables are not applied yet." }
    }
    if (insert.error.code === "23505" || /duplicate key/i.test(insert.error.message)) {
      return { ok: true, enrolled: false, message: "Already enrolled." }
    }
    return { ok: false, enrolled: false, message: insert.error.message }
  }

  if (outreachDelayMs(stage1Delay) === 0) {
    try {
      await processMarketingOutreach({ dealId, limit: 1, now })
    } catch (error) {
      console.error("[marketing-outreach] stage 1 send failed", error)
    }
  }
  return { ok: true, enrolled: Boolean(insert.data?.id) }
}
