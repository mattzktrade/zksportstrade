import type { OperationsBookingRow } from "@/lib/admin/operations-bookings"
import type { OperationsEmailHistoryRow } from "@/lib/operations/emails"
import type { OperationsStepInput } from "@/lib/operations/fulfilment"

export function lastEmailAt(
  emails: OperationsEmailHistoryRow[],
  dealId: string | null,
  kind: OperationsEmailHistoryRow["kind"],
): string | null {
  if (!dealId) return null
  return emails.find((row) => row.dealId === dealId && row.kind === kind)?.sentAt ?? null
}

export function bookingStepInput(
  row: OperationsBookingRow,
  emails: OperationsEmailHistoryRow[],
): OperationsStepInput {
  return {
    invoiceStatus: row.invoiceStatus,
    dealStage: row.dealStage,
    guestDetailsStatus: row.guestDetailsStatus,
    completeGuestCount: row.completeGuestCount,
    quantity: row.quantity,
    supplierFulfilmentMethod: row.supplierFulfilmentMethod,
    clientDeliveryMethod: row.clientDeliveryMethod,
    supplierDetailsSentAt: row.supplierDetailsSentAt,
    ticketsReceivedAt: row.ticketsReceivedAt,
    supplierStatus: row.supplierStatus,
    deliveryStatus: row.deliveryStatus,
    fulfilmentStatus: row.fulfilmentStatus,
    eventDate: row.eventDate,
    isDirectClient: row.isDirectClient,
    thankYouSentAt: lastEmailAt(emails, row.dealId, "after_event"),
    thankYouSkippedAt: row.thankYouSkippedAt,
    hasDeliveryProof: row.hasDeliveryProof,
    hasOpsContact: Boolean(row.operationsContactId || row.contactName || row.operationsContactEmail),
    guestDetailsDeadline: row.guestDetailsDeadline,
    deliveryDueAt: row.deliveryDueAt,
  }
}
