import type { createAdminClient } from "@/lib/supabase/admin"
import { stopMarketingOutreach } from "@/lib/integrations/marketing-leads/outreach-stop"
import { findActiveOutreachByEmail, findActiveOutreachByPhone } from "@/lib/integrations/marketing-leads/outreach-store"
import { normalizeMarketingPhone } from "@/lib/integrations/marketing-leads/parse"

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>

/** A website buyer who is still in the marketing sequence on another enquiry stops getting chased. */
export async function stopOutreachForWebsiteBuyer(
  admin: AdminClient,
  input: {
    email: string | null | undefined
    phone: string | null | undefined
    orderDealId: string
    orderReference: string
  },
): Promise<{ stoppedDealId: string | null }> {
  const email = input.email?.trim().toLowerCase() || ""
  const phoneDigits = normalizeMarketingPhone(input.phone)
  const enrollment =
    (email ? await findActiveOutreachByEmail(admin, email) : null) ??
    (phoneDigits.length >= 8 ? await findActiveOutreachByPhone(admin, phoneDigits) : null)
  if (!enrollment || enrollment.deal_id === input.orderDealId) return { stoppedDealId: null }

  await stopMarketingOutreach(enrollment.deal_id, "purchased")
  await admin
    .from("deals")
    .update({
      next_action: `Booked on the website (${input.orderReference || "order"}) — close this enquiry`,
      next_action_due_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", enrollment.deal_id)
  await admin.from("deal_activities").insert({
    deal_id: enrollment.deal_id,
    actor_profile_id: null,
    action: "website_order_from_lead",
    summary: `Lead booked on the Abu Dhabi GP website${input.orderReference ? ` (order ${input.orderReference})` : ""}`,
    metadata: { orderDealId: input.orderDealId, orderReference: input.orderReference },
  })
  return { stoppedDealId: enrollment.deal_id }
}
