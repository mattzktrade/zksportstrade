import { DEAL_STAGES, type DealStage } from "@/lib/crm/deal-types"

export const HAPPY_PATH_STAGES: readonly DealStage[] = [
  "draft",
  "sourcing",
  "proposal",
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
