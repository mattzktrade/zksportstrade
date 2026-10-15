import type { createAdminClient } from "@/lib/supabase/admin"

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>

export function enquiryHasClientReply(deal: { enquiry_replied_at?: string | null }): boolean {
  return Boolean(deal.enquiry_replied_at)
}

/** First reply only. Does not change enquiry_stage, next action, or updated_at. */
export async function markEnquiryClientReplied(
  admin: AdminClient,
  dealId: string | null | undefined,
  now = new Date(),
): Promise<void> {
  const id = dealId?.trim()
  if (!id) return
  const { error } = await admin
    .from("deals")
    .update({ enquiry_replied_at: now.toISOString() })
    .eq("id", id)
    .is("enquiry_replied_at", null)
  if (error && !/enquiry_replied_at|schema cache/i.test(error.message)) {
    console.error("[enquiry-replied]", error.message)
  }
}
