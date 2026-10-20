import { createAdminClient } from "@/lib/supabase/admin"
import { sendMarketingOutreachEmail } from "@/lib/email/send-marketing-outreach"
import { suggestedEnquiryAction } from "@/lib/crm/deal-pipeline"
import {
  missingOutreachRelation,
  RETRYABLE_OUTREACH_SKIP_REASONS,
  shouldAdvanceOutreachStage,
  type OutreachChannelOutcome,
} from "@/lib/integrations/marketing-leads/outreach-labels"
import { stopMarketingOutreach } from "@/lib/integrations/marketing-leads/outreach-stop"
import { resolveOutreachInterestForDeal } from "@/lib/integrations/marketing-leads/outreach-interest"
import {
  listOutreachPlaceholders,
  outreachVarsFromSnapshot,
  outreachWhatsAppParameters,
  renderOutreachTemplate,
} from "@/lib/integrations/marketing-leads/outreach-render"
import {
  MARKETING_OUTREACH_SEQUENCE,
  type MarketingOutreachChannel,
  type MarketingOutreachEnrollment,
  type MarketingOutreachStage,
  type MarketingOutreachStep,
} from "@/lib/integrations/marketing-leads/outreach-types"
import { sendWhatsAppTemplate } from "@/lib/integrations/whatsapp/send-template"
import { recordOutreachOutbound } from "@/lib/assistant/record-outreach"

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>

export type MarketingOutreachProcessResult = {
  processed: number
  sent: number
  skipped: number
  failed: number
  message?: string
}

const DEFAULT_LIMIT = 15
const HOLD_RETRY_MS = 10 * 60 * 1000
const SENDING_LOCK = "sending"

function asStage(value: number): MarketingOutreachStage | null {
  if (value === 1 || value === 2 || value === 3) return value
  return null
}

async function loadSettings(admin: AdminClient, sequenceKey: string): Promise<boolean | null> {
  const { data, error } = await admin
    .from("marketing_outreach_settings")
    .select("enabled")
    .eq("sequence_key", sequenceKey)
    .maybeSingle()
  if (error) {
    if (missingOutreachRelation(error)) return null
    throw new Error(error.message)
  }
  return data?.enabled === true
}

async function loadSteps(admin: AdminClient, sequenceKey: string): Promise<MarketingOutreachStep[]> {
  const { data, error } = await admin
    .from("marketing_outreach_steps")
    .select(
      "id, sequence_key, stage, delay_hours, email_enabled, email_subject, email_body, whatsapp_enabled, whatsapp_body, whatsapp_template_name, whatsapp_template_language, updated_at",
    )
    .eq("sequence_key", sequenceKey)
    .order("stage")
  if (error) throw new Error(error.message)
  return (data ?? []) as MarketingOutreachStep[]
}

async function alreadySent(
  admin: AdminClient,
  enrollmentId: string,
  stage: MarketingOutreachStage,
  channel: MarketingOutreachChannel,
): Promise<boolean> {
  const { data, error } = await admin
    .from("marketing_outreach_sends")
    .select("id, status, skip_reason")
    .eq("enrollment_id", enrollmentId)
    .eq("stage", stage)
    .eq("channel", channel)
    .in("status", ["sent", "skipped"])
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return false
  if (data.status === "sent") return true
  const reason = typeof data.skip_reason === "string" ? data.skip_reason : ""
  return Boolean(reason) && !(RETRYABLE_OUTREACH_SKIP_REASONS as readonly string[]).includes(reason)
}

/** One worker at a time: park the due time so the minute cron cannot start the same stage. */
async function claimEnrollment(
  admin: AdminClient,
  enrollment: MarketingOutreachEnrollment,
  now: Date,
): Promise<boolean> {
  const { data, error } = await admin
    .from("marketing_outreach_enrollments")
    .update({
      next_stage_due_at: new Date(now.getTime() + HOLD_RETRY_MS).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", enrollment.id)
    .eq("status", "active")
    .eq("current_stage", enrollment.current_stage)
    .lte("next_stage_due_at", now.toISOString())
    .select("id")
    .maybeSingle()
  if (error) throw new Error(error.message)
  return Boolean(data?.id)
}

/** Take the unique send row before calling Meta / email, so a second worker cannot send the same message. */
async function acquireChannelSlot(
  admin: AdminClient,
  input: {
    enrollmentId: string
    dealId: string
    stage: MarketingOutreachStage
    channel: MarketingOutreachChannel
  },
): Promise<boolean> {
  const { data: existing, error: readError } = await admin
    .from("marketing_outreach_sends")
    .select("id, status, skip_reason")
    .eq("enrollment_id", input.enrollmentId)
    .eq("stage", input.stage)
    .eq("channel", input.channel)
    .limit(1)
    .maybeSingle()
  if (readError) throw new Error(readError.message)
  if (!existing) {
    const { error } = await admin.from("marketing_outreach_sends").insert({
      enrollment_id: input.enrollmentId,
      deal_id: input.dealId,
      stage: input.stage,
      channel: input.channel,
      status: "failed",
      error: SENDING_LOCK,
    })
    if (error?.code === "23505") return false
    if (error) throw new Error(error.message)
    return true
  }
  if (existing.status === "sent") return false
  if (existing.status === "skipped") {
    const reason = typeof existing.skip_reason === "string" ? existing.skip_reason : ""
    return (RETRYABLE_OUTREACH_SKIP_REASONS as readonly string[]).includes(reason)
  }
  return true
}

async function recordSend(
  admin: AdminClient,
  input: {
    enrollmentId: string
    dealId: string
    stage: MarketingOutreachStage
    channel: MarketingOutreachChannel
    status: "sent" | "skipped" | "failed"
    skipReason?: string
    providerMessageId?: string | null
    subject?: string
    body?: string
    error?: string
  },
) {
  const now = new Date().toISOString()
  const row = {
    enrollment_id: input.enrollmentId,
    deal_id: input.dealId,
    stage: input.stage,
    channel: input.channel,
    status: input.status,
    skip_reason: input.skipReason ?? null,
    provider_message_id: input.providerMessageId ?? null,
    subject: input.subject ?? null,
    body_rendered: input.body ?? null,
    error: input.error ?? null,
    sent_at: input.status === "sent" ? now : null,
  }
  const { error } = await admin.from("marketing_outreach_sends").upsert(row, {
    onConflict: "enrollment_id,stage,channel",
  })
  if (error && error.code !== "23505") throw new Error(error.message)
}

function outreachVarsForEnrollment(
  enrollment: MarketingOutreachEnrollment,
  interest: { event: string | null; packageName: string | null; quantity: number | null },
) {
  return outreachVarsFromSnapshot({
    firstName: enrollment.first_name,
    fullName: enrollment.full_name,
    event: interest.event,
    packageName: interest.packageName,
    quantity: interest.quantity ?? enrollment.interest_quantity,
  })
}

async function sendEmailChannel(
  admin: AdminClient,
  enrollment: MarketingOutreachEnrollment,
  step: MarketingOutreachStep,
  stage: MarketingOutreachStage,
  interest: { event: string | null; packageName: string | null; quantity: number | null },
): Promise<OutreachChannelOutcome> {
  if (await alreadySent(admin, enrollment.id, stage, "email")) return { status: "sent", unchanged: true }
  if (!(await acquireChannelSlot(admin, {
    enrollmentId: enrollment.id,
    dealId: enrollment.deal_id,
    stage,
    channel: "email",
  }))) {
    return { status: "sent", unchanged: true }
  }
  if (!step.email_enabled) {
    await recordSend(admin, {
      enrollmentId: enrollment.id,
      dealId: enrollment.deal_id,
      stage,
      channel: "email",
      status: "skipped",
      skipReason: "email_disabled",
    })
    return { status: "skipped", skipReason: "email_disabled" }
  }
  const vars = outreachVarsForEnrollment(enrollment, interest)
  const subject = renderOutreachTemplate(step.email_subject, vars)
  const body = renderOutreachTemplate(step.email_body, vars)
  const result = await sendMarketingOutreachEmail({
    to: enrollment.email || "",
    subject,
    text: body,
  })
  if (result.ok) {
    await recordSend(admin, {
      enrollmentId: enrollment.id,
      dealId: enrollment.deal_id,
      stage,
      channel: "email",
      status: "sent",
      providerMessageId: result.id,
      subject,
      body,
    })
    try {
      await recordOutreachOutbound(admin, {
        enrollment,
        channel: "email",
        body,
        subject,
        providerMessageId: result.id,
        stage,
      })
    } catch (error) {
      console.error("[marketing-outreach] inbox email record failed", error)
    }
    return { status: "sent" }
  }
  if (result.skipped) {
    await recordSend(admin, {
      enrollmentId: enrollment.id,
      dealId: enrollment.deal_id,
      stage,
      channel: "email",
      status: "skipped",
      skipReason: result.skipped,
      subject,
      body,
    })
    return { status: "skipped", skipReason: result.skipped }
  }
  await recordSend(admin, {
    enrollmentId: enrollment.id,
    dealId: enrollment.deal_id,
    stage,
    channel: "email",
    status: "failed",
    error: result.error,
    subject,
    body,
  })
  return { status: "failed" }
}

async function sendWhatsAppChannel(
  admin: AdminClient,
  enrollment: MarketingOutreachEnrollment,
  step: MarketingOutreachStep,
  stage: MarketingOutreachStage,
  interest: { event: string | null; packageName: string | null; quantity: number | null },
): Promise<OutreachChannelOutcome> {
  if (await alreadySent(admin, enrollment.id, stage, "whatsapp")) return { status: "sent", unchanged: true }
  if (!(await acquireChannelSlot(admin, {
    enrollmentId: enrollment.id,
    dealId: enrollment.deal_id,
    stage,
    channel: "whatsapp",
  }))) {
    return { status: "sent", unchanged: true }
  }
  if (!step.whatsapp_enabled) {
    await recordSend(admin, {
      enrollmentId: enrollment.id,
      dealId: enrollment.deal_id,
      stage,
      channel: "whatsapp",
      status: "skipped",
      skipReason: "whatsapp_disabled",
    })
    return { status: "skipped", skipReason: "whatsapp_disabled" }
  }
  const vars = outreachVarsForEnrollment(enrollment, interest)
  const body = renderOutreachTemplate(step.whatsapp_body, vars)
  const result = await sendWhatsAppTemplate({
    toPhoneDigits: enrollment.phone_digits || enrollment.phone || "",
    templateName: step.whatsapp_template_name,
    language: step.whatsapp_template_language || "en",
    bodyParameters: outreachWhatsAppParameters(step.whatsapp_body, vars).map((text, index) => ({
      name: listOutreachPlaceholders(step.whatsapp_body)[index] ?? "",
      text,
    })),
  })
  if (result.ok) {
    await recordSend(admin, {
      enrollmentId: enrollment.id,
      dealId: enrollment.deal_id,
      stage,
      channel: "whatsapp",
      status: "sent",
      providerMessageId: result.id,
      body,
    })
    try {
      await recordOutreachOutbound(admin, {
        enrollment,
        channel: "whatsapp",
        body,
        providerMessageId: result.id,
        stage,
      })
    } catch (error) {
      console.error("[marketing-outreach] inbox WhatsApp record failed", error)
    }
    return { status: "sent" }
  }
  if (result.skipped) {
    await recordSend(admin, {
      enrollmentId: enrollment.id,
      dealId: enrollment.deal_id,
      stage,
      channel: "whatsapp",
      status: "skipped",
      skipReason: result.skipped,
      body,
    })
    return { status: "skipped", skipReason: result.skipped }
  }
  await recordSend(admin, {
    enrollmentId: enrollment.id,
    dealId: enrollment.deal_id,
    stage,
    channel: "whatsapp",
    status: "failed",
    error: result.error,
    body,
  })
  return { status: "failed" }
}

async function markEnquiryContacted(admin: AdminClient, dealId: string) {
  await admin
    .from("deals")
    .update({
      enquiry_stage: "contacted",
      next_action: suggestedEnquiryAction("contacted"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", dealId)
    .eq("enquiry_stage", "new")
}

function delayForNextStep(steps: MarketingOutreachStep[], nextStage: MarketingOutreachStage, now: Date): string {
  const step = steps.find((row) => row.stage === nextStage)
  const hours = step?.delay_hours && step.delay_hours > 0 ? step.delay_hours : 0
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString()
}

async function processEnrollment(
  admin: AdminClient,
  enrollment: MarketingOutreachEnrollment,
  steps: MarketingOutreachStep[],
  now: Date,
): Promise<{ sent: number; skipped: number; failed: number }> {
  if (!(await claimEnrollment(admin, enrollment, now))) {
    return { sent: 0, skipped: 0, failed: 0 }
  }

  const nextStage = asStage(enrollment.current_stage + 1)
  if (!nextStage) {
    await admin
      .from("marketing_outreach_enrollments")
      .update({
        status: "completed",
        stop_reason: "completed",
        completed_at: now.toISOString(),
        next_stage_due_at: null,
        updated_at: now.toISOString(),
      })
      .eq("id", enrollment.id)
      .eq("status", "active")
    return { sent: 0, skipped: 0, failed: 0 }
  }
  const step = steps.find((row) => row.stage === nextStage)
  if (!step) return { sent: 0, skipped: 0, failed: 1 }

  const interest = await resolveOutreachInterestForDeal(admin, enrollment.deal_id)
  if (interest.event !== enrollment.interest_event || interest.packageName !== enrollment.interest_package) {
    await admin
      .from("marketing_outreach_enrollments")
      .update({
        interest_event: interest.event,
        interest_package: interest.packageName,
        interest_quantity: interest.quantity,
        updated_at: now.toISOString(),
      })
      .eq("id", enrollment.id)
  }

  const emailStatus = await sendEmailChannel(admin, enrollment, step, nextStage, interest)
  const whatsappStatus = await sendWhatsAppChannel(admin, enrollment, step, nextStage, interest)
  const counts = { sent: 0, skipped: 0, failed: 0 }
  for (const outcome of [emailStatus, whatsappStatus]) {
    if (outcome.unchanged) continue
    if (outcome.status === "sent") counts.sent += 1
    else if (outcome.status === "skipped") counts.skipped += 1
    else counts.failed += 1
  }

  const sentNew =
    (emailStatus.status === "sent" && !emailStatus.unchanged) ||
    (whatsappStatus.status === "sent" && !whatsappStatus.unchanged)
  if (sentNew) {
    if (nextStage === 1) {
      await markEnquiryContacted(admin, enrollment.deal_id)
    }
    const summaryParts = [
      emailStatus.status === "sent" ? "email" : emailStatus.status === "skipped" ? "email skipped" : "email failed",
      whatsappStatus.status === "sent" ? "WhatsApp" : whatsappStatus.status === "skipped" ? "WhatsApp skipped" : "WhatsApp failed",
    ]
    await admin.from("deal_activities").insert({
      deal_id: enrollment.deal_id,
      actor_profile_id: null,
      action: "marketing_outreach_sent",
      summary: `Marketing follow-up stage ${nextStage}: ${summaryParts.join(", ")}`,
      metadata: {
        stage: nextStage,
        email: emailStatus.status,
        whatsapp: whatsappStatus.status,
      },
    })
  }

  const decision = shouldAdvanceOutreachStage(emailStatus, whatsappStatus)
  if (decision === "hold") {
    await admin
      .from("marketing_outreach_enrollments")
      .update({
        next_stage_due_at: new Date(now.getTime() + HOLD_RETRY_MS).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", enrollment.id)
      .eq("status", "active")
    return counts
  }
  if (decision === "no_channel") {
    await stopMarketingOutreach(enrollment.deal_id, "no_channel")
    return counts
  }

  if (nextStage >= 3) {
    await admin
      .from("marketing_outreach_enrollments")
      .update({
        status: "completed",
        stop_reason: "completed",
        current_stage: 3,
        completed_at: now.toISOString(),
        next_stage_due_at: null,
        updated_at: now.toISOString(),
      })
      .eq("id", enrollment.id)
      .eq("status", "active")
    return counts
  }

  const following = asStage(nextStage + 1)
  await admin
    .from("marketing_outreach_enrollments")
    .update({
      current_stage: nextStage,
      next_stage_due_at: following ? delayForNextStep(steps, following, now) : null,
      updated_at: now.toISOString(),
    })
    .eq("id", enrollment.id)
    .eq("status", "active")
  return counts
}

export async function processMarketingOutreach(options?: {
  dealId?: string
  now?: Date
  limit?: number
}): Promise<MarketingOutreachProcessResult> {
  const admin = createAdminClient()
  if (!admin) return { processed: 0, sent: 0, skipped: 0, failed: 0, message: "Service role not configured." }

  try {
    const enabled = await loadSettings(admin, MARKETING_OUTREACH_SEQUENCE)
    if (enabled == null) {
      return { processed: 0, sent: 0, skipped: 0, failed: 0, message: "Outreach tables are not applied yet." }
    }
    if (!enabled) {
      return { processed: 0, sent: 0, skipped: 0, failed: 0, message: "Marketing follow-up is paused." }
    }

    const steps = await loadSteps(admin, MARKETING_OUTREACH_SEQUENCE)
    if (steps.length === 0) {
      return { processed: 0, sent: 0, skipped: 0, failed: 0, message: "No follow-up stages are set up." }
    }

    const now = options?.now ?? new Date()
    const limit = options?.limit && options.limit > 0 ? Math.min(options.limit, 40) : DEFAULT_LIMIT
    let query = admin
      .from("marketing_outreach_enrollments")
      .select(
        "id, deal_id, account_id, contact_id, sequence_key, status, stop_reason, current_stage, next_stage_due_at, first_name, full_name, email, phone, phone_digits, interest_event, interest_package, interest_quantity, created_at, updated_at, stopped_at, completed_at",
      )
      .eq("status", "active")
      .eq("sequence_key", MARKETING_OUTREACH_SEQUENCE)
      .lte("next_stage_due_at", now.toISOString())
      .order("next_stage_due_at", { ascending: true })
      .limit(limit)
    if (options?.dealId) query = query.eq("deal_id", options.dealId)

    const { data, error } = await query
    if (error) {
      if (missingOutreachRelation(error)) {
        return { processed: 0, sent: 0, skipped: 0, failed: 0, message: "Outreach tables are not applied yet." }
      }
      throw new Error(error.message)
    }

    const result: MarketingOutreachProcessResult = { processed: 0, sent: 0, skipped: 0, failed: 0 }
    for (const row of (data ?? []) as MarketingOutreachEnrollment[]) {
      result.processed += 1
      const counts = await processEnrollment(admin, row, steps, now)
      result.sent += counts.sent
      result.skipped += counts.skipped
      result.failed += counts.failed
    }
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : "Marketing outreach failed."
    if (missingOutreachRelation({ message })) {
      return { processed: 0, sent: 0, skipped: 0, failed: 0, message: "Outreach tables are not applied yet." }
    }
    throw error
  }
}
