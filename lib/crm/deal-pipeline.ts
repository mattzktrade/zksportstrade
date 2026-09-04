import { adminDealPath } from "@/lib/admin/deal-link"
import {
  canonicalDealStage,
  type DealListRow,
  type DealStage,
} from "@/lib/crm/deal-types"

/** Pre-deal records: enquiry, sourcing, and price sent. Shown on Sales → Enquiries. */
export const ENQUIRY_PIPELINE_STAGES = ["draft", "sourcing", "proposal"] as const satisfies readonly DealStage[]

/** Booking form onwards. Shown on Sales → Deals. */
export const DEAL_BOARD_STAGES = [
  "awaiting_booking_form_send",
  "booking_form_sent",
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
] as const satisfies readonly DealStage[]

export type EnquiryPipelineStage = (typeof ENQUIRY_PIPELINE_STAGES)[number]

export const ENQUIRY_CRM_STAGES = [
  "new",
  "contacted",
  "responded",
  "sourcing_required",
  "sourcing_complete",
  "price_sent",
  "follow_up",
  "not_interested",
] as const

export type EnquiryCrmStage = (typeof ENQUIRY_CRM_STAGES)[number]

export const ENQUIRY_TEMPERATURES = ["warm", "cold"] as const
export type EnquiryTemperature = (typeof ENQUIRY_TEMPERATURES)[number]

export const ENQUIRY_CRM_STAGE_LABELS: Record<EnquiryCrmStage, string> = {
  new: "New",
  contacted: "Contacted",
  responded: "Responded",
  sourcing_required: "Sourcing required",
  sourcing_complete: "Sourcing complete",
  price_sent: "Price sent",
  follow_up: "Follow-up",
  not_interested: "Not interested",
}

export function isEnquiryCrmStage(value: string | null | undefined): value is EnquiryCrmStage {
  return typeof value === "string" && (ENQUIRY_CRM_STAGES as readonly string[]).includes(value)
}

export function isEnquiryTemperature(value: string | null | undefined): value is EnquiryTemperature {
  return value === "warm" || value === "cold"
}

export function inboundEnquirySource(source: string | null | undefined): boolean {
  return source === "website" || source === "portal" || source === "referral"
}

export function isEnquiryPipelineStage(stage: string): boolean {
  return (ENQUIRY_PIPELINE_STAGES as readonly string[]).includes(canonicalDealStage(stage))
}

export function isDealBoardStage(stage: string): boolean {
  return !isEnquiryPipelineStage(stage)
}

export function enquiryCrmStageFromDeal(deal: {
  stage: DealStage | string
  enquiry_stage?: string | null
}): EnquiryCrmStage {
  if (isEnquiryCrmStage(deal.enquiry_stage)) return deal.enquiry_stage
  switch (canonicalDealStage(deal.stage)) {
    case "sourcing":
      return "sourcing_required"
    case "proposal":
      return "price_sent"
    default:
      return "new"
  }
}

export function enquiryTemperatureFromDeal(deal: {
  source?: string | null
  enquiry_temperature?: string | null
}): EnquiryTemperature {
  if (isEnquiryTemperature(deal.enquiry_temperature)) return deal.enquiry_temperature
  return "warm"
}

export function enquiryStageWarmsLead(stage: EnquiryCrmStage): boolean {
  return stage === "responded" || stage === "sourcing_required" || stage === "sourcing_complete"
}

export function resolvedEnquiryTemperature(input: {
  source?: string | null
  enquiryStage: EnquiryCrmStage
  temperature?: string | null
}): EnquiryTemperature {
  if (inboundEnquirySource(input.source)) return "warm"
  if (enquiryStageWarmsLead(input.enquiryStage)) return "warm"
  if (isEnquiryTemperature(input.temperature)) return input.temperature
  return "warm"
}

export function enquiryDealStage(
  enquiryStage: EnquiryCrmStage,
  currentDealStage?: DealStage | string | null,
): DealStage {
  switch (enquiryStage) {
    case "sourcing_required":
    case "sourcing_complete":
      return "sourcing"
    case "price_sent":
    case "follow_up":
      return "proposal"
    case "not_interested": {
      const current = currentDealStage ? canonicalDealStage(currentDealStage) : "draft"
      return current === "draft" || current === "sourcing" || current === "proposal" ? current : "draft"
    }
    default:
      return "draft"
  }
}

export function isOpenEnquiry(deal: {
  stage: DealStage | string
  enquiry_stage?: string | null
}): boolean {
  return isEnquiryPipelineStage(deal.stage) && enquiryCrmStageFromDeal(deal) !== "not_interested"
}

export function enquiryStageLabel(
  dealOrStage: string | Pick<DealListRow, "stage"> & { enquiry_stage?: string | null },
): string {
  if (typeof dealOrStage === "string") {
    if (isEnquiryCrmStage(dealOrStage)) return ENQUIRY_CRM_STAGE_LABELS[dealOrStage]
    return ENQUIRY_CRM_STAGE_LABELS[enquiryCrmStageFromDeal({ stage: dealOrStage })]
  }
  return ENQUIRY_CRM_STAGE_LABELS[enquiryCrmStageFromDeal(dealOrStage)]
}

export function enquiryStageTone(
  dealOrStage: string | Pick<DealListRow, "stage"> & { enquiry_stage?: string | null },
): "green" | "amber" | "red" | "blue" | "purple" | "gray" {
  const stage =
    typeof dealOrStage === "string"
      ? isEnquiryCrmStage(dealOrStage)
        ? dealOrStage
        : enquiryCrmStageFromDeal({ stage: dealOrStage })
      : enquiryCrmStageFromDeal(dealOrStage)
  switch (stage) {
    case "new":
      return "gray"
    case "contacted":
      return "blue"
    case "responded":
      return "purple"
    case "sourcing_required":
      return "amber"
    case "sourcing_complete":
      return "blue"
    case "price_sent":
      return "green"
    case "follow_up":
      return "amber"
    case "not_interested":
      return "red"
    default:
      return "gray"
  }
}

export function enquiryTemperatureLabel(temperature: EnquiryTemperature | string): string {
  return temperature === "cold" ? "Cold" : "Warm"
}

export function enquiryTemperatureTone(temperature: EnquiryTemperature | string): "red" | "blue" {
  return temperature === "cold" ? "blue" : "red"
}

export type EnquiryStageTabId = "all" | EnquiryCrmStage

export const ENQUIRY_STAGE_TABS: ReadonlyArray<{
  id: EnquiryStageTabId
  label: string
}> = [
  { id: "all", label: "All" },
  ...ENQUIRY_CRM_STAGES.map((id) => ({ id, label: ENQUIRY_CRM_STAGE_LABELS[id] })),
]

export type DealBoardPipelineId =
  | "ready_to_send"
  | "booking_form"
  | "awaiting_payment"
  | "won"
  | "lost"

export const DEAL_BOARD_COLUMNS: ReadonlyArray<{
  id: DealBoardPipelineId
  label: string
  stages: readonly DealStage[]
  colour: string
}> = [
  {
    id: "ready_to_send",
    label: "Ready to send",
    stages: ["awaiting_booking_form_send"],
    colour: "border-fuchsia-500",
  },
  {
    id: "booking_form",
    label: "Booking form",
    stages: ["booking_form_sent", "awaiting_client_signature", "awaiting_zk_signature"],
    colour: "border-amber-500",
  },
  {
    id: "awaiting_payment",
    label: "Awaiting payment",
    stages: ["signed", "awaiting_invoice", "awaiting_payment"],
    colour: "border-red-500",
  },
  {
    id: "won",
    label: "Won",
    stages: ["paid_confirmed", "in_fulfilment", "fulfilled"],
    colour: "border-emerald-500",
  },
  { id: "lost", label: "Lost", stages: ["closed_lost", "cancelled"], colour: "border-slate-400" },
]

export function dealBoardColumnFor(stage: DealStage) {
  const canonical = canonicalDealStage(stage)
  return DEAL_BOARD_COLUMNS.find((column) => column.stages.includes(canonical)) ?? DEAL_BOARD_COLUMNS[0]
}

export function adminEnquiryListPath(enquiryId?: string | null): string {
  const id = enquiryId?.trim()
  return id ? `/admin/enquiries?enquiry=${encodeURIComponent(id)}` : "/admin/enquiries"
}

export function adminDealListPath(dealId?: string | null, pipeline?: string | null): string {
  const params = new URLSearchParams()
  const id = dealId?.trim()
  if (id) params.set("deal", id)
  const pipelineValue = pipeline?.trim()
  if (pipelineValue) params.set("pipeline", pipelineValue)
  const query = params.toString()
  return query ? `/admin/deals?${query}` : "/admin/deals"
}

export function adminPipelineHome(stage: string): { href: string; label: string } {
  if (isEnquiryPipelineStage(stage)) {
    return { href: "/admin/enquiries", label: "Enquiries" }
  }
  return { href: "/admin/deals", label: "Deals" }
}

export function adminRecordWorkspacePath(dealId: string, stage: string): string {
  return isEnquiryPipelineStage(stage) ? adminEnquiryListPath(dealId) : adminDealPath(dealId)
}

export const ENQUIRY_CONVERT_STAGE: DealStage = "awaiting_booking_form_send"

export function nextEnquiryCrmStage(deal: {
  stage: DealStage | string
  enquiry_stage?: string | null
  lines: Array<{ sourcing_mode: string }>
}): EnquiryCrmStage | null {
  const stage = enquiryCrmStageFromDeal(deal)
  switch (stage) {
    case "new":
      return "contacted"
    case "contacted":
      return "responded"
    case "responded":
      return enquiryNeedsSourcing({ ...deal, enquiry_stage: "responded" })
        ? "sourcing_required"
        : "price_sent"
    case "sourcing_required":
      return "sourcing_complete"
    case "sourcing_complete":
      return "price_sent"
    case "price_sent":
      return "follow_up"
    default:
      return null
  }
}

export function enquiryNeedsSourcing(deal: {
  stage: DealStage | string
  enquiry_stage?: string | null
  lines: Array<{ sourcing_mode: string }>
}): boolean {
  const stage = enquiryCrmStageFromDeal(deal)
  if (stage === "sourcing_required") return true
  if (
    stage === "sourcing_complete" ||
    stage === "price_sent" ||
    stage === "follow_up" ||
    stage === "not_interested"
  ) {
    return false
  }
  return deal.lines.some((line) => line.sourcing_mode === "brokered")
}

export function enquiryAttentionReason(deal: {
  next_action_due_at: string | null
  owner_profile_id: string | null
}): "No owner" | "Next step overdue" | null {
  if (!deal.owner_profile_id) return "No owner"
  if (!deal.next_action_due_at) return null
  const due = new Date(deal.next_action_due_at).getTime()
  if (Number.isFinite(due) && due < Date.now()) return "Next step overdue"
  return null
}

export function enquiryNeedsAttention(deal: {
  next_action_due_at: string | null
  owner_profile_id: string | null
}): boolean {
  return enquiryAttentionReason(deal) != null
}

export function enquiryInterestLabel(deal: Pick<DealListRow, "race_name" | "line_summary">): string {
  const event = deal.race_name?.trim() || ""
  const lines = deal.line_summary?.trim() || ""
  if (event && lines) return `${event} — ${lines}`
  return event || lines || "—"
}

export function enquiryLastActivityAt(deal: Pick<DealListRow, "updated_at" | "recent_activities">): string {
  return deal.recent_activities[0]?.created_at || deal.updated_at
}

export function relativeActivityTime(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  const deltaMs = Date.now() - date.getTime()
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (deltaMs < minute) return "just now"
  if (deltaMs < hour) return `${Math.max(1, Math.round(deltaMs / minute))}m ago`
  if (deltaMs < day) return `${Math.max(1, Math.round(deltaMs / hour))}h ago`
  if (deltaMs < 7 * day) return `${Math.max(1, Math.round(deltaMs / day))}d ago`
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

export function suggestedEnquiryAction(stage: EnquiryCrmStage): string {
  switch (stage) {
    case "new":
      return "Make contact"
    case "contacted":
      return "Wait for a reply"
    case "responded":
      return "Source or send a price"
    case "sourcing_required":
      return "Confirm sourcing"
    case "sourcing_complete":
      return "Send the price"
    case "price_sent":
      return "Follow up the price"
    case "follow_up":
      return "Follow up"
    case "not_interested":
      return "No further action"
  }
}

export function defaultEnquiryAction(
  deal: Pick<DealListRow, "next_action" | "stage"> & { enquiry_stage?: string | null },
): string {
  if (deal.next_action?.trim()) return deal.next_action
  return suggestedEnquiryAction(enquiryCrmStageFromDeal(deal))
}

export function enquiryNotesPreview(notes: string | null | undefined, max = 90): string {
  const text = notes?.replace(/\s+/g, " ").trim() ?? ""
  if (!text) return ""
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export type EnquiryStockProduct = {
  id: string
  packageName: string
  eventName: string
  stockLeft: number
}

export function enquiryLineAvailability(
  line: { package_id: string; quantity: number; sourcing_mode: string },
  product: EnquiryStockProduct | null | undefined,
): {
  label: string
  requested: number
  available: number | null
  enough: boolean
  sourcing: boolean
} {
  const requested = Math.max(0, Math.floor(Number(line.quantity) || 0))
  const available =
    product && Number.isFinite(product.stockLeft) ? Math.max(0, Math.floor(product.stockLeft)) : null
  return {
    label: product
      ? `${product.eventName} — ${product.packageName}`
      : "Product",
    requested,
    available,
    enough: available != null && available >= requested,
    sourcing: line.sourcing_mode === "brokered",
  }
}

export function enquiryStockSummary(
  deal: Pick<DealListRow, "stage" | "lines" | "reserved_qty"> & { enquiry_stage?: string | null },
): string {
  const brokered = deal.lines.filter((line) => line.sourcing_mode === "brokered").length
  if (deal.reserved_qty > 0) {
    return `${deal.reserved_qty} unit${deal.reserved_qty === 1 ? "" : "s"} on hold`
  }
  const stage = enquiryCrmStageFromDeal(deal)
  if (stage === "sourcing_complete") return "Sourcing complete"
  if (stage === "sourcing_required" || brokered > 0) {
    return brokered > 0
      ? `Needs sourcing — ${brokered} brokered line${brokered === 1 ? "" : "s"}`
      : "Sourcing in progress"
  }
  return "Using ZK stock"
}

export const ENQUIRY_PAGE_SIZE = 50
