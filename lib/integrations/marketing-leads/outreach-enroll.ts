import { createAdminClient } from "@/lib/supabase/admin"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import { missingOutreachRelation } from "@/lib/integrations/marketing-leads/outreach-labels"
import { firstNameFromFullName } from "@/lib/integrations/marketing-leads/outreach-render"
import { MARKETING_OUTREACH_SEQUENCE } from "@/lib/integrations/marketing-leads/outreach-types"
import { normalizeMarketingPhone } from "@/lib/integrations/marketing-leads/parse"
import { processMarketingOutreach } from "@/lib/integrations/marketing-leads/outreach-process"

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
      id, source, account_id, primary_contact_id, race_id, enquiry_stage,
      crm_contacts ( id, full_name, email, phone ),
      races ( name, season ),
      deal_line_items ( quantity, packages ( name, races ( name, season ) ) )
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

  const line = one(
    deal.deal_line_items as
      | {
          quantity: number
          packages:
            | { name: string; races: { name: string; season: number } | Array<{ name: string; season: number }> | null }
            | Array<{ name: string; races: { name: string; season: number } | Array<{ name: string; season: number }> | null }>
            | null
        }
      | Array<{
          quantity: number
          packages:
            | { name: string; races: { name: string; season: number } | Array<{ name: string; season: number }> | null }
            | Array<{ name: string; races: { name: string; season: number } | Array<{ name: string; season: number }> | null }>
            | null
        }>
      | null,
  )
  const pkg = one(line?.packages ?? null)
  const lineRace = one(pkg?.races ?? null)
  const dealRace = one(deal.races as { name: string; season: number } | Array<{ name: string; season: number }> | null)
  const race = lineRace ?? dealRace
  const eventName = race ? eventSeasonLabel(race.name, race.season) : null
  const fullName = contact?.full_name?.trim() || "there"

  const now = new Date().toISOString()
  const insert = await admin
    .from("marketing_outreach_enrollments")
    .insert({
      deal_id: dealId,
      account_id: deal.account_id,
      contact_id: contact?.id ?? deal.primary_contact_id,
      sequence_key: MARKETING_OUTREACH_SEQUENCE,
      status: "active",
      current_stage: 0,
      next_stage_due_at: now,
      first_name: firstNameFromFullName(fullName),
      full_name: fullName,
      email,
      phone,
      phone_digits: phoneDigits || null,
      interest_event: eventName,
      interest_package: pkg?.name ?? null,
      interest_quantity: line?.quantity != null ? Math.floor(Number(line.quantity)) : null,
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

  try {
    await processMarketingOutreach({ dealId, limit: 1 })
  } catch (error) {
    console.error("[marketing-outreach] stage 1 send failed", error)
  }
  return { ok: true, enrolled: Boolean(insert.data?.id) }
}
