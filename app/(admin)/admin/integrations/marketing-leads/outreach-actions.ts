"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getPortalProfile } from "@/lib/supabase/profile"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { MARKETING_OUTREACH_SEQUENCE } from "@/lib/integrations/marketing-leads/outreach-types"
import { stopMarketingOutreach } from "@/lib/integrations/marketing-leads/outreach-stop"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type OutreachStepInput = {
  id: string
  delayHours: number
  emailEnabled: boolean
  emailSubject: string
  emailBody: string
  whatsappEnabled: boolean
  whatsappBody: string
  whatsappTemplateName: string
  whatsappTemplateLanguage: string
}

async function requireAction() {
  const profile = await getPortalProfile()
  if (!profile) return { ok: false as const, message: "Not signed in." }
  if (!hasCmsPermission(profile, "deals.manage")) {
    return { ok: false as const, message: "You do not have permission for this action." }
  }
  const supabase = await createClient()
  return { ok: true as const, supabase, profile }
}

export async function saveMarketingOutreachSequence(input: {
  enabled: boolean
  steps: OutreachStepInput[]
}): Promise<{ ok: boolean; message: string }> {
  const gate = await requireAction()
  if (!gate.ok) return gate
  if (input.steps.length !== 3) {
    return { ok: false, message: "There must be exactly three stages." }
  }

  const now = new Date().toISOString()
  const { error: settingsError } = await gate.supabase
    .from("marketing_outreach_settings")
    .update({ enabled: input.enabled, updated_at: now })
    .eq("sequence_key", MARKETING_OUTREACH_SEQUENCE)
  if (settingsError) return { ok: false, message: settingsError.message }

  for (const step of input.steps) {
    if (!UUID_RE.test(step.id)) return { ok: false, message: "A stage id is not valid." }
    const delayHours = Math.max(0, Math.min(24 * 30, Math.floor(Number(step.delayHours) || 0)))
    const { error } = await gate.supabase
      .from("marketing_outreach_steps")
      .update({
        delay_hours: delayHours,
        email_enabled: Boolean(step.emailEnabled),
        email_subject: step.emailSubject.trim(),
        email_body: step.emailBody.trim(),
        whatsapp_enabled: Boolean(step.whatsappEnabled),
        whatsapp_body: step.whatsappBody.trim(),
        whatsapp_template_name: step.whatsappTemplateName.trim(),
        whatsapp_template_language: (step.whatsappTemplateLanguage.trim() || "en").toLowerCase(),
        updated_at: now,
      })
      .eq("id", step.id)
      .eq("sequence_key", MARKETING_OUTREACH_SEQUENCE)
    if (error) return { ok: false, message: error.message }
  }

  revalidatePath("/admin/templates")
  revalidatePath("/admin/enquiries")
  return { ok: true, message: "Follow-up templates saved." }
}

export async function stopMarketingOutreachForDeal(dealId: string): Promise<{ ok: boolean; message: string }> {
  const gate = await requireAction()
  if (!gate.ok) return gate
  const id = dealId.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Enquiry id is not valid." }
  const result = await stopMarketingOutreach(id, "staff")
  if (!result.ok) return { ok: false, message: "Could not stop the follow-up." }
  revalidatePath("/admin/enquiries")
  revalidatePath("/admin/deals", "layout")
  return {
    ok: true,
    message: result.stopped ? "Automated follow-up stopped." : "This enquiry was not in an active follow-up.",
  }
}
