import { canonicalDealStage, DEAL_STAGES, type DealStage } from "@/lib/crm/deal-types"

export const HAPPY_PATH_STAGES: readonly DealStage[] = [
  "draft",
  "sourcing",
  "proposal",
  "awaiting_booking_form_send",
  "awaiting_client_signature",
  "awaiting_zk_signature",
  "signed",
  "awaiting_invoice",
  "awaiting_payment",
  "paid_confirmed",
  "in_fulfilment",
  "fulfilled",
]

/** Staff can jump to any valid stage (historical deals, manual won, reopen). */
export function allowedDealTransitions(stage: DealStage): DealStage[] {
  return DEAL_STAGES.filter((item) => item !== stage)
}

export function canTransitionDeal(from: DealStage, to: DealStage): boolean {
  return from === to || DEAL_STAGES.includes(to)
}

const GUEST_FULFILMENT_STARTED = new Set(["requested", "partial", "complete"])

function operationsDelivered(deliveryStatus: string, fulfilmentStatus?: string): boolean {
  return (
    fulfilmentStatus === "delivered" || ["sent", "confirmed", "delivered"].includes(deliveryStatus)
  )
}

export function nextActionForDealStage(stage: DealStage | string): string {
  switch (canonicalDealStage(String(stage))) {
    case "draft":
      return "Review enquiry and send price"
    case "sourcing":
      return "Confirm sourcing and price"
    case "proposal":
      return "Follow up price"
    case "awaiting_booking_form_send":
      return "Send booking form"
    case "booking_form_sent":
    case "awaiting_client_signature":
      return "Chase client signature"
    case "awaiting_zk_signature":
      return "ZK admin to approve and sign"
    case "form_expired":
      return "Booking form expired; send a new form or follow up"
    case "signed":
    case "awaiting_invoice":
      return "Create and send invoice"
    case "awaiting_payment":
      return "Follow up payment"
    case "paid_confirmed":
      return "Hand over to fulfilment"
    case "in_fulfilment":
      return "Complete fulfilment"
    case "fulfilled":
    case "closed_lost":
    case "cancelled":
      return "No action — closed"
  }
}

/**
 * Operations guest/delivery status drives the deal pipeline after the sale is won.
 * Requested/partial/complete guests → In fulfilment. Delivered tickets → Fulfilled.
 * Does not move unpaid, cancelled, or already-fulfilled deals.
 */
export function dealStageFromOperations(input: {
  currentStage: string
  guestDetailsStatus: string
  deliveryStatus: string
  fulfilmentStatus?: string
}): DealStage | null {
  const current = input.currentStage as DealStage
  if (current === "cancelled" || current === "closed_lost" || current === "fulfilled") return null

  const delivered = operationsDelivered(input.deliveryStatus, input.fulfilmentStatus)

  if (delivered && (current === "paid_confirmed" || current === "in_fulfilment")) {
    return "fulfilled"
  }

  if (GUEST_FULFILMENT_STARTED.has(input.guestDetailsStatus) && current === "paid_confirmed") {
    return "in_fulfilment"
  }

  return null
}
