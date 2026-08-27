import { createAdminClient } from "@/lib/supabase/admin"

/** Fulfilment lock blocks supplier reassignment, not unpaid/test cancellation. */
export async function prepareOrderCancelRelease(orderId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")

  const [{ data: tickets, error: ticketError }, { data: operations, error: opsError }] =
    await Promise.all([
      admin
        .from("order_supplier_fulfilments")
        .select("id")
        .eq("order_id", orderId)
        .eq("status", "tickets_received")
        .limit(1),
      admin
        .from("order_operations")
        .select("delivery_status, fulfilment_status")
        .eq("order_id", orderId)
        .maybeSingle(),
    ])
  if (ticketError) throw new Error(ticketError.message)
  if (opsError) throw new Error(opsError.message)
  if (
    (tickets && tickets.length > 0) ||
    operations?.delivery_status === "delivered" ||
    operations?.fulfilment_status === "delivered"
  ) {
    throw new Error("tickets_or_delivery_block_cancellation")
  }

  const { error } = await admin
    .from("inventory_allocations")
    .update({
      lock_state: "mutable",
      locked_at: null,
      locked_reason: null,
    })
    .eq("order_id", orderId)
    .neq("state", "released")
    .eq("lock_state", "fulfilment_locked")
  if (error) throw new Error(error.message)
}
