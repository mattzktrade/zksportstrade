import { createAdminClient } from "@/lib/supabase/admin"
import { toMarketingOutreachSummary, missingOutreachRelation } from "@/lib/integrations/marketing-leads/outreach-labels"
import {
  MARKETING_OUTREACH_SEQUENCE,
  type MarketingOutreachEnrollment,
  type MarketingOutreachSend,
  type MarketingOutreachSettings,
  type MarketingOutreachStep,
  type MarketingOutreachSummary,
} from "@/lib/integrations/marketing-leads/outreach-types"

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>

export async function loadMarketingOutreachAdmin(): Promise<{
  settings: MarketingOutreachSettings | null
  steps: MarketingOutreachStep[]
  missingTables: boolean
}> {
  const admin = createAdminClient()
  if (!admin) return { settings: null, steps: [], missingTables: false }
  const [settingsRes, stepsRes] = await Promise.all([
    admin.from("marketing_outreach_settings").select("sequence_key, enabled, updated_at").eq("sequence_key", MARKETING_OUTREACH_SEQUENCE).maybeSingle(),
    admin
      .from("marketing_outreach_steps")
      .select(
        "id, sequence_key, stage, delay_hours, email_enabled, email_subject, email_body, whatsapp_enabled, whatsapp_body, whatsapp_template_name, whatsapp_template_language, updated_at",
      )
      .eq("sequence_key", MARKETING_OUTREACH_SEQUENCE)
      .order("stage"),
  ])
  if (missingOutreachRelation(settingsRes.error) || missingOutreachRelation(stepsRes.error)) {
    return { settings: null, steps: [], missingTables: true }
  }
  return {
    settings: (settingsRes.data as MarketingOutreachSettings | null) ?? null,
    steps: (stepsRes.data ?? []) as MarketingOutreachStep[],
    missingTables: false,
  }
}

export async function listMarketingOutreachForDeals(dealIds: string[]): Promise<Record<string, MarketingOutreachSummary>> {
  const ids = [...new Set(dealIds.filter(Boolean))]
  const empty: Record<string, MarketingOutreachSummary> = {}
  if (ids.length === 0) return empty
  const admin = createAdminClient()
  if (!admin) return empty

  const enrollmentRows: Array<
    Pick<MarketingOutreachEnrollment, "id" | "deal_id" | "status" | "stop_reason" | "current_stage" | "next_stage_due_at">
  > = []
  const chunkSize = 80
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize)
    const { data: enrollments, error } = await admin
      .from("marketing_outreach_enrollments")
      .select("id, deal_id, status, stop_reason, current_stage, next_stage_due_at")
      .in("deal_id", slice)
    if (error) {
      if (missingOutreachRelation(error)) return empty
      return empty
    }
    enrollmentRows.push(
      ...((enrollments ?? []) as Array<
        Pick<MarketingOutreachEnrollment, "id" | "deal_id" | "status" | "stop_reason" | "current_stage" | "next_stage_due_at">
      >),
    )
  }
  if (enrollmentRows.length === 0) return empty

  const dealIdsWithOutreach = enrollmentRows.map((row) => row.deal_id)
  const sendsByDeal = new Map<string, MarketingOutreachSend[]>()
  for (let i = 0; i < dealIdsWithOutreach.length; i += chunkSize) {
    const slice = dealIdsWithOutreach.slice(i, i + chunkSize)
    const { data: sends } = await admin
      .from("marketing_outreach_sends")
      .select(
        "id, enrollment_id, deal_id, stage, channel, status, skip_reason, provider_message_id, subject, body_rendered, error, created_at, sent_at",
      )
      .in("deal_id", slice)
      .order("created_at", { ascending: true })
    for (const send of (sends ?? []) as MarketingOutreachSend[]) {
      const list = sendsByDeal.get(send.deal_id) ?? []
      list.push(send)
      sendsByDeal.set(send.deal_id, list)
    }
  }

  const out: Record<string, MarketingOutreachSummary> = {}
  for (const row of enrollmentRows) {
    out[row.deal_id] = toMarketingOutreachSummary(row.deal_id, row, sendsByDeal.get(row.deal_id) ?? [])
  }
  return out
}

export async function findActiveOutreachByPhone(
  admin: AdminClient,
  phoneDigits: string,
): Promise<MarketingOutreachEnrollment | null> {
  const digits = phoneDigits.replace(/\D/g, "")
  if (digits.length < 8) return null
  const { data, error } = await admin
    .from("marketing_outreach_enrollments")
    .select(
      "id, deal_id, account_id, contact_id, sequence_key, status, stop_reason, current_stage, next_stage_due_at, first_name, full_name, email, phone, phone_digits, interest_event, interest_package, interest_quantity, created_at, updated_at, stopped_at, completed_at",
    )
    .eq("status", "active")
    .not("phone_digits", "is", null)
    .limit(200)
  if (error || !data) return null
  const rows = data as MarketingOutreachEnrollment[]
  return (
    rows.find((row) => {
      const stored = (row.phone_digits || "").replace(/\D/g, "")
      if (!stored) return false
      if (stored === digits) return true
      const short = stored.length < digits.length ? stored : digits
      const long = stored.length < digits.length ? digits : stored
      return short.length >= 8 && long.endsWith(short)
    }) ?? null
  )
}

export async function findActiveOutreachByEmail(
  admin: AdminClient,
  email: string,
): Promise<MarketingOutreachEnrollment | null> {
  const needle = email.trim().toLowerCase()
  if (!needle) return null
  const { data } = await admin
    .from("marketing_outreach_enrollments")
    .select(
      "id, deal_id, account_id, contact_id, sequence_key, status, stop_reason, current_stage, next_stage_due_at, first_name, full_name, email, phone, phone_digits, interest_event, interest_package, interest_quantity, created_at, updated_at, stopped_at, completed_at",
    )
    .eq("status", "active")
    .ilike("email", needle)
    .limit(1)
    .maybeSingle()
  return (data as MarketingOutreachEnrollment | null) ?? null
}
