import { syncDealWorkflowFromOperations } from "@/lib/operations/sync-deal-workflow"
import {
  bookingDeliveryCompleteFromTickets,
  loadTicketsForBooking,
  type TicketsDb,
} from "@/lib/tickets/store"

export async function syncBookingDeliveredFromTickets(
  db: TicketsDb,
  input: { dealId?: string | null; orderId?: string | null; actorId: string },
): Promise<boolean> {
  const tickets = await loadTicketsForBooking(db, input)
  if (!bookingDeliveryCompleteFromTickets(tickets)) return false
  const now = new Date().toISOString()
  if (input.orderId) {
    await db
      .from("order_operations")
      .update({
        delivery_status: "delivered",
        fulfilment_status: "delivered",
        updated_at: now,
      })
      .eq("order_id", input.orderId)
    await db.from("invoices").update({ status: "delivered" }).eq("order_id", input.orderId).in("status", ["paid", "delivered"])
  }
  if (input.dealId) {
    await db.from("deal_operations").upsert(
      {
        deal_id: input.dealId,
        delivery_status: "delivered",
        fulfilment_status: "delivered",
        updated_at: now,
      },
      { onConflict: "deal_id" },
    )
  }
  await syncDealWorkflowFromOperations(db, {
    actorProfileId: input.actorId,
    dealId: input.dealId,
    orderId: input.orderId,
    guestDetailsStatus: "complete",
    deliveryStatus: "delivered",
    fulfilmentStatus: "delivered",
  })
  return true
}
