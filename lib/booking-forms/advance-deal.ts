import { dealStageIsUnsignedPipeline } from "@/lib/crm/deal-types"

/** Pipeline stages a countersigned deal may still be sitting in if completion died. */
export const UNSIGNED_STAGES_AFTER_ZK_SIGNATURE = [
  "draft",
  "sourcing",
  "proposal",
  "awaiting_booking_form_send",
  "booking_form_sent",
  "awaiting_client_signature",
  "awaiting_zk_signature",
  "form_expired",
] as const

type DealAdvanceClient = {
  from: (table: string) => {
    update: (values: Record<string, unknown>) => any
  }
}

export async function markDealSignedAfterZkCountersign(
  admin: DealAdvanceClient,
  dealId: string,
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await admin
    .from("deals")
    .update({
      stage: "signed",
      next_action: "Create and send invoice",
      next_action_due_at: now,
      do_not_expire: true,
      hold_expires_at: null,
      updated_at: now,
    })
    .eq("id", dealId)
    .is("order_id", null)
    .in("stage", UNSIGNED_STAGES_AFTER_ZK_SIGNATURE)
  if (error) throw new Error(error.message)
}

export function bookingFormHasZkCountersign(status: string | null | undefined): boolean {
  const value = String(status ?? "").trim()
  return value === "zk_signed" || value === "completed"
}

/** Both parties signed; don't keep showing Awaiting ZK signature if the deal row lagged. */
export function effectiveDealStageAfterCountersign(
  stage: string,
  bookingFormStatus?: string | null,
): string {
  if (bookingFormHasZkCountersign(bookingFormStatus) && dealStageIsUnsignedPipeline(stage)) {
    return "signed"
  }
  return stage
}

export function dealCanCreateOrderFromBookingForm(input: {
  stage: string
  orderId?: string | null
  bookingFormStatus?: string | null
}): boolean {
  if (input.orderId) return false
  if (["signed", "awaiting_invoice"].includes(input.stage)) return true
  return input.bookingFormStatus === "completed"
}
