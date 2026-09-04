export type DealStage =
  | "draft"
  | "sourcing"
  | "proposal"
  | "awaiting_booking_form_send"
  | "booking_form_sent"
  | "awaiting_client_signature"
  | "awaiting_zk_signature"
  | "signed"
  | "awaiting_invoice"
  | "awaiting_payment"
  | "paid_confirmed"
  | "in_fulfilment"
  | "fulfilled"
  | "closed_lost"
  | "cancelled"

export const DEAL_STAGES: readonly DealStage[] = [
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
  "closed_lost",
  "cancelled",
]

/** Sending a booking form is the same workflow state as waiting for the client to sign. */
export function canonicalDealStage(stage: string): DealStage {
  if (stage === "booking_form_sent") return "awaiting_client_signature"
  return stage as DealStage
}

/** Paid stages that are ready to fulfil. Payment status is independent of stock hold. */
export const DEAL_CONFIRMED_STAGES: readonly DealStage[] = [
  "paid_confirmed",
  "in_fulfilment",
  "fulfilled",
]

export function dealStageIsConfirmed(stage: DealStage | string): boolean {
  return (DEAL_CONFIRMED_STAGES as readonly string[]).includes(stage)
}

/**
 * Native signed contracts now consume purchased stock (see DEAL_SOLD_STAGES).
 * This list is kept for Salesforce overlay / leftover pipeline demand only.
 */
export const DEAL_STOCK_RESERVE_STAGES: readonly DealStage[] = []

export function dealStageReservesSellable(stage: DealStage | string): boolean {
  return (DEAL_STOCK_RESERVE_STAGES as readonly string[]).includes(stage)
}

/** Open deals before both parties have signed the booking form. Shown as pipeline, not reserved. */
export const DEAL_UNSIGNED_PIPELINE_STAGES: readonly DealStage[] = [
  "draft",
  "sourcing",
  "proposal",
  "awaiting_booking_form_send",
  "booking_form_sent",
  "awaiting_client_signature",
  "awaiting_zk_signature",
]

export function dealStageIsUnsignedPipeline(stage: DealStage | string): boolean {
  return (DEAL_UNSIGNED_PIPELINE_STAGES as readonly string[]).includes(stage)
}

/**
 * After both parties have signed. These deals hold purchased stock and can be
 * assigned a fulfilment supplier. Payment status can still be Awaiting payment.
 */
export const DEAL_SOLD_STAGES: readonly DealStage[] = [
  "signed",
  "awaiting_invoice",
  "awaiting_payment",
  "paid_confirmed",
  "in_fulfilment",
  "fulfilled",
]

export function dealStageCountsAsSold(stage: DealStage | string): boolean {
  return (DEAL_SOLD_STAGES as readonly string[]).includes(stage)
}

export function dealStageHoldsPurchasedStock(stage: DealStage | string): boolean {
  return dealStageCountsAsSold(stage)
}

/** Live pipeline that is not paid yet — must not be treated as ready to fulfil. */
export function dealStageIsOpenPipeline(stage: DealStage | string): boolean {
  return (
    !dealStageIsConfirmed(stage) &&
    stage !== "closed_lost" &&
    stage !== "cancelled"
  )
}

/** Paid/fulfilled sales that never got a portal order — typical of Salesforce/historical imports. */
export function dealConfirmedOffPlatform(deal: {
  order_id: string | null
  stage: DealStage
}): boolean {
  return !deal.order_id && dealStageIsConfirmed(deal.stage)
}

export const DEAL_SOURCES = ["offline", "website", "portal", "referral", "other"] as const
export type DealSource = (typeof DEAL_SOURCES)[number]

export const DEAL_SOURCE_LABELS: Record<DealSource, string> = {
  offline: "Offline",
  website: "Website",
  portal: "Portal",
  referral: "Referral",
  other: "Other",
}

export function dealSourceLabel(source: string | null | undefined): string {
  if (!source) return DEAL_SOURCE_LABELS.offline
  if (source in DEAL_SOURCE_LABELS) return DEAL_SOURCE_LABELS[source as DealSource]
  return source.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export type DealSourceTone = "green" | "amber" | "red" | "blue" | "purple" | "gray"

export function dealSourceTone(source: string | null | undefined): DealSourceTone {
  switch (source) {
    case "website":
      return "green"
    case "portal":
      return "amber"
    case "referral":
      return "purple"
    case "other":
      return "blue"
    case "offline":
    default:
      return "gray"
  }
}

export type DealListRow = {
  id: string
  account_id: string | null
  primary_contact_id: string | null
  race_id: string | null
  reference: string
  stage: DealStage
  source: string
  enquiry_stage: string | null
  enquiry_temperature: "warm" | "cold" | null
  currency: string
  total_amount: number
  expected_close_date: string | null
  next_action: string | null
  next_action_due_at: string | null
  loss_reason: string | null
  hold_expires_at: string | null
  do_not_expire: boolean
  notes: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  created_by_name: string | null
  recent_activities: DealActivityPreview[]
  account_name: string | null
  contact_name: string | null
  owner_profile_id: string | null
  owner_name: string | null
  race_name: string | null
  events: DealEventOption[]
  line_summary: string | null
  lines: DealLineEditorRow[]
  reserved_qty: number
  gross_profit: number | null
  margin: number | null
  order_id: string | null
  order_reference: string | null
  invoice_id: string | null
  invoice_status: string | null
  xero_invoice_id: string | null
  xero_invoice_number: string | null
  ledger_invoice_number: string | null
  xero_sync_status: string | null
  xero_sync_error: string | null
  invoice_due_date: string | null
  invoice_emailed_at: string | null
  invoice_email_error: string | null
  payment_reminder_count: number
  last_payment_reminder_at: string | null
  payment_reminder_error: string | null
  cancellation_eligible_at: string | null
}

export type PackageDealSaleLine = {
  id: string
  packageId: string
  packageName: string | null
  quantity: number
  unitSalePrice: number
  expectedUnitCost: number | null
  sourcingMode: "owned" | "brokered"
  supplierId: string | null
  supplierName: string | null
  supplierKey: string
  supplierAllocations: Array<{ key: string; name: string; quantity: number }>
  costLayerId: string | null
}

export type PackageDealSaleRow = {
  id: string
  reference: string
  accountId: string | null
  contactId: string | null
  accountName: string | null
  contactName: string | null
  quantity: number
  totalAmount: number
  currency: string
  stage: DealStage
  source: string
  createdAt: string
  updatedAt: string
  notes: string | null
  ownerName: string | null
  raceName: string | null
  lineSummary: string | null
  expectedCloseDate: string | null
  nextAction: string | null
  nextActionDueAt: string | null
  reservedQty: number
  holdExpiresAt: string | null
  doNotExpire: boolean
  orderId: string | null
  orderReference: string | null
  lines: PackageDealSaleLine[]
  cogs: number | null
  grossProfit: number | null
  margin: number | null
  supplierLabel: string | null
}

export type DealEventOption = {
  id: string
  label: string
  eventDate: string | null
}

export type DealLineEditorRow = {
  id: string
  package_id: string
  quantity: number
  unit_sale_price: number
  expected_unit_cost: number | null
  sourcing_mode: "owned" | "brokered"
  supplier_id: string | null
  supplier_quote_at: string | null
}

export type CrmContactOption = {
  id: string
  full_name: string
  email: string | null
  phone: string | null
}

export type CrmAccountOption = {
  id: string
  name: string
  contacts: CrmContactOption[]
}

export type DealPackageOption = {
  id: string
  label: string
  eventId: string
  eventName: string
  packageName: string
  price: number | null
  currency: string
  stockLeft: number
}

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  draft: "Draft",
  sourcing: "Sourcing",
  proposal: "Price sent",
  awaiting_booking_form_send: "Ready to send",
  booking_form_sent: "Awaiting client signature",
  awaiting_client_signature: "Awaiting client signature",
  awaiting_zk_signature: "Awaiting ZK signature",
  signed: "Signed",
  awaiting_invoice: "Awaiting invoice",
  awaiting_payment: "Awaiting payment",
  paid_confirmed: "Won / Paid confirmed",
  in_fulfilment: "In fulfilment",
  fulfilled: "Fulfilled",
  closed_lost: "Closed lost",
  cancelled: "Cancelled",
}

export type DealActivityPreview = {
  id: string
  actor_name: string | null
  summary: string
  created_at: string
}

export const DEAL_NEXT_ACTION_OPTIONS = [
  "Review enquiry and make contact",
  "Chase for a response",
  "Confirm interest and source or price",
  "Review enquiry and send price",
  "Confirm sourcing and price",
  "Send price",
  "Follow up price",
  "Send booking form",
  "Sent for approval to Ollie and Michel",
  "Approved admin to send booking form",
  "Chase client signature",
  "ZK admin to approve and sign",
  "Create and send invoice",
  "Follow up payment",
  "Await Xero payment",
  "Hand over to fulfilment",
  "Complete fulfilment",
  "Call client",
  "No action — closed",
] as const

export function friendlyDealActivitySummary(summary: string): string {
  return summary.replace(
    /\b(draft|sourcing|proposal|awaiting_booking_form_send|booking_form_sent|awaiting_client_signature|awaiting_zk_signature|signed|awaiting_invoice|awaiting_payment|paid_confirmed|in_fulfilment|fulfilled|closed_lost|cancelled)\b/g,
    (stage) => DEAL_STAGE_LABELS[stage as DealStage] ?? stage,
  )
}
