import { operationsTicketStatus } from "@/lib/admin/workflow-status"
import { primaryAccountType, type AccountKind } from "@/lib/crm/account-kinds"

export const SUPPLIER_FULFILMENT_METHODS = [
  "names_only",
  "digital_to_zk",
  "collect_from_supplier",
  "supplier_posts_to_guest",
  "official_ships",
] as const

export const CLIENT_DELIVERY_METHODS = [
  "supplier_handles",
  "send_digital",
  "local_collection",
  "posted_to_guest",
  "official_shipment",
] as const

export type SupplierFulfilmentMethod = (typeof SUPPLIER_FULFILMENT_METHODS)[number]
export type ClientDeliveryMethod = (typeof CLIENT_DELIVERY_METHODS)[number]

export const OPERATIONS_QUEUE_BUCKETS = [
  "needs_guests",
  "waiting_supplier",
  "ready_to_fulfil",
  "awaiting_event",
  "after_event",
  "done",
] as const

export type OperationsQueueBucket = (typeof OPERATIONS_QUEUE_BUCKETS)[number]

export const OPERATIONS_BOARD_STEPS = [
  "paid",
  "ops_contact",
  "guests",
  "supplier",
  "allocate",
  "fulfil",
  "after_event",
] as const

export type OperationsBoardStep = (typeof OPERATIONS_BOARD_STEPS)[number]

const SUPPLIER_METHOD_SET = new Set<string>(SUPPLIER_FULFILMENT_METHODS)
const CLIENT_METHOD_SET = new Set<string>(CLIENT_DELIVERY_METHODS)
const NAMES_ONLY_INBOUND = new Set<SupplierFulfilmentMethod>([
  "names_only",
  "supplier_posts_to_guest",
  "official_ships",
])

export type OperationsStepInput = {
  invoiceStatus: string | null
  dealStage: string | null
  guestDetailsStatus: string
  completeGuestCount: number
  quantity: number
  supplierFulfilmentMethod: string | null
  clientDeliveryMethod: string | null
  supplierDetailsSentAt: string | null
  ticketsReceivedAt: string | null
  supplierStatus?: string | null
  deliveryStatus: string
  fulfilmentStatus: string
  eventDate: string | null
  isDirectClient: boolean
  thankYouSentAt: string | null
  thankYouSkippedAt: string | null
  hasDeliveryProof: boolean
  hasOpsContact?: boolean
  guestDetailsDeadline?: string | null
  deliveryDueAt?: string | null
  unpaidWarningDays?: number
}

export function isSupplierFulfilmentMethod(value: string | null | undefined): value is SupplierFulfilmentMethod {
  return Boolean(value && SUPPLIER_METHOD_SET.has(value))
}

export function isClientDeliveryMethod(value: string | null | undefined): value is ClientDeliveryMethod {
  return Boolean(value && CLIENT_METHOD_SET.has(value))
}

export function parseSupplierFulfilmentMethod(value: string | null | undefined): SupplierFulfilmentMethod | null {
  return isSupplierFulfilmentMethod(value) ? value : null
}

export function parseClientDeliveryMethod(value: string | null | undefined): ClientDeliveryMethod | null {
  return isClientDeliveryMethod(value) ? value : null
}

export function supplierFulfilmentLabel(value: string | null | undefined): string {
  switch (parseSupplierFulfilmentMethod(value)) {
    case "names_only":
      return "Names only — supplier handles tickets"
    case "digital_to_zk":
      return "Digital tickets to ZK"
    case "collect_from_supplier":
      return "We collect from the supplier"
    case "supplier_posts_to_guest":
      return "Supplier posts to the guest"
    case "official_ships":
      return "Official / F1 ships"
    default:
      return "Not set"
  }
}

export function clientDeliveryLabel(value: string | null | undefined): string {
  switch (parseClientDeliveryMethod(value)) {
    case "supplier_handles":
      return "Supplier handles delivery"
    case "send_digital":
      return "We send digital tickets"
    case "local_collection":
      return "Local collection"
    case "posted_to_guest":
      return "Posted to guest"
    case "official_shipment":
      return "Official shipment"
    default:
      return "Not set"
  }
}

export function lockedClientDelivery(
  supplier: string | null | undefined,
): ClientDeliveryMethod | null {
  return parseSupplierFulfilmentMethod(supplier) === "names_only" ? "supplier_handles" : null
}

export function resolvedClientDelivery(
  supplier: string | null | undefined,
  client: string | null | undefined,
): ClientDeliveryMethod | null {
  return lockedClientDelivery(supplier) ?? parseClientDeliveryMethod(client)
}

export function supplierNeedsTicketsIn(supplier: string | null | undefined): boolean {
  const method = parseSupplierFulfilmentMethod(supplier)
  return method === "digital_to_zk" || method === "collect_from_supplier"
}

export function supplierNeedsNamesSent(supplier: string | null | undefined): boolean {
  const method = parseSupplierFulfilmentMethod(supplier)
  return method != null && NAMES_ONLY_INBOUND.has(method)
}

export function isOperationsPaid(input: Pick<OperationsStepInput, "invoiceStatus" | "dealStage">): boolean {
  if (["paid", "delivered"].includes(input.invoiceStatus ?? "")) return true
  return ["paid_confirmed", "in_fulfilment", "fulfilled"].includes(input.dealStage ?? "")
}

export function isDirectClientAccount(kinds: readonly AccountKind[]): boolean {
  return primaryAccountType([...kinds]) === "direct_client"
}

export function guestsAreComplete(input: Pick<OperationsStepInput, "guestDetailsStatus" | "completeGuestCount" | "quantity">): boolean {
  if (input.guestDetailsStatus === "complete" || input.guestDetailsStatus === "not_required") return true
  const needed = Math.max(1, Math.floor(Number(input.quantity) || 1))
  return Math.max(0, Math.floor(Number(input.completeGuestCount) || 0)) >= needed
}

export function isOperationsDelivered(input: Pick<OperationsStepInput, "deliveryStatus" | "fulfilmentStatus">): boolean {
  return operationsTicketStatus(input) === "delivered"
}

export function supplierInboundComplete(input: Pick<
  OperationsStepInput,
  "supplierFulfilmentMethod" | "supplierDetailsSentAt" | "ticketsReceivedAt" | "supplierStatus"
>): boolean {
  const method = parseSupplierFulfilmentMethod(input.supplierFulfilmentMethod)
  if (!method) return false
  if (NAMES_ONLY_INBOUND.has(method)) return Boolean(input.supplierDetailsSentAt)
  if (input.ticketsReceivedAt) return true
  return input.supplierStatus === "tickets_received"
}

export function eventDateIso(value: string | null | undefined): string | null {
  const iso = value?.trim().slice(0, 10) ?? ""
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null
}

export function utcTodayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function eventHasPassed(eventDate: string | null | undefined, todayIso = utcTodayIso()): boolean {
  const iso = eventDateIso(eventDate)
  return Boolean(iso && iso < todayIso)
}

export function daysUntilEvent(eventDate: string | null | undefined, todayIso = utcTodayIso()): number | null {
  const iso = eventDateIso(eventDate)
  if (!iso) return null
  const today = Date.parse(`${todayIso}T00:00:00Z`)
  const event = Date.parse(`${iso}T00:00:00Z`)
  if (Number.isNaN(today) || Number.isNaN(event)) return null
  return Math.round((event - today) / 86_400_000)
}

export function unpaidCloseToEvent(
  input: Pick<OperationsStepInput, "invoiceStatus" | "dealStage" | "eventDate">,
  todayIso = utcTodayIso(),
  withinDays = 14,
): boolean {
  if (isOperationsPaid(input)) return false
  const days = daysUntilEvent(input.eventDate, todayIso)
  return days != null && days >= 0 && days <= withinDays
}

export function thankYouDue(
  input: Pick<
    OperationsStepInput,
    "isDirectClient" | "eventDate" | "thankYouSentAt" | "thankYouSkippedAt" | "deliveryStatus" | "fulfilmentStatus"
  >,
  todayIso = utcTodayIso(),
): boolean {
  if (!input.isDirectClient) return false
  if (input.thankYouSentAt || input.thankYouSkippedAt) return false
  if (!isOperationsDelivered(input)) return false
  return eventHasPassed(input.eventDate, todayIso)
}

export function operationsQueueBucket(
  input: OperationsStepInput,
  todayIso = utcTodayIso(),
): OperationsQueueBucket {
  if (!guestsAreComplete(input)) return "needs_guests"
  if (!supplierInboundComplete(input)) return "waiting_supplier"
  if (!isOperationsDelivered(input)) return "ready_to_fulfil"
  if (thankYouDue(input, todayIso)) return "after_event"
  if (!eventHasPassed(input.eventDate, todayIso)) return "awaiting_event"
  return "done"
}

export function operationsQueueBucketLabel(bucket: OperationsQueueBucket): string {
  switch (bucket) {
    case "needs_guests":
      return "Needs guests"
    case "waiting_supplier":
      return "Waiting on supplier"
    case "ready_to_fulfil":
      return "Ready to fulfil"
    case "awaiting_event":
      return "Event upcoming"
    case "after_event":
      return "After event"
    case "done":
      return "Done"
  }
}

export function operationsNextStepLabel(bucket: OperationsQueueBucket): string {
  switch (bucket) {
    case "needs_guests":
      return "Collect guest details"
    case "waiting_supplier":
      return "Tickets / names to supplier"
    case "ready_to_fulfil":
      return "Fulfil to client"
    case "awaiting_event":
      return "Wait for event"
    case "after_event":
      return "Send thank-you"
    case "done":
      return "Complete"
  }
}

export function operationsBoardStepStatus(
  step: OperationsBoardStep,
  input: OperationsStepInput,
  todayIso = utcTodayIso(),
): "done" | "current" | "todo" | "skipped" {
  const bucket = operationsQueueBucket(input, todayIso)
  switch (step) {
    case "paid":
      return isOperationsPaid(input) ? "done" : "todo"
    case "ops_contact":
      return input.hasOpsContact ? "done" : "current"
    case "guests":
      if (guestsAreComplete(input)) return "done"
      return bucket === "needs_guests" ? "current" : "todo"
    case "supplier":
      if (!guestsAreComplete(input)) return "todo"
      if (supplierInboundComplete(input)) return "done"
      return bucket === "waiting_supplier" ? "current" : "todo"
    case "allocate":
      return isOperationsDelivered(input) ? "done" : "todo"
    case "fulfil":
      if (isOperationsDelivered(input)) return "done"
      if (!guestsAreComplete(input) || !supplierInboundComplete(input)) return "todo"
      return "current"
    case "after_event":
      if (!input.isDirectClient) return "skipped"
      if (input.thankYouSentAt || input.thankYouSkippedAt) return "done"
      return thankYouDue(input, todayIso) ? "current" : "todo"
  }
}

export function operationsSortDeadline(input: OperationsStepInput & { guestDetailsDeadline?: string | null; deliveryDueAt?: string | null }): string | null {
  const bucket = operationsQueueBucket(input)
  if (bucket === "needs_guests") return eventDateIso(input.guestDetailsDeadline) ?? eventDateIso(input.eventDate)
  if (bucket === "waiting_supplier") return eventDateIso(input.guestDetailsDeadline) ?? eventDateIso(input.eventDate)
  if (bucket === "ready_to_fulfil") return eventDateIso(input.deliveryDueAt) ?? eventDateIso(input.eventDate)
  return eventDateIso(input.eventDate)
}

export function operationsQueueSortKey(input: OperationsStepInput, todayIso = utcTodayIso()): string {
  const due = operationsSortDeadline(input)
  if (due && due < todayIso) return `0-${due}`
  return `1-${due ?? "9999-12-31"}`
}

export type OperationsCalendarKind = "race" | "guest_deadline" | "collection"

export type OperationsCalendarItem = {
  date: string
  kind: OperationsCalendarKind
  bookingId: string
  label: string
}

export function operationsCalendarItems(
  row: OperationsStepInput & {
    id: string
    accountName: string
    eventPackage: string
    guestDetailsDeadline?: string | null
    deliveryDueAt?: string | null
  },
): OperationsCalendarItem[] {
  const items: OperationsCalendarItem[] = []
  const race = eventDateIso(row.eventDate)
  if (race) {
    items.push({
      date: race,
      kind: "race",
      bookingId: row.id,
      label: row.eventPackage || row.accountName,
    })
  }
  const deadline = eventDateIso(row.guestDetailsDeadline)
  if (deadline && !guestsAreComplete(row)) {
    items.push({
      date: deadline,
      kind: "guest_deadline",
      bookingId: row.id,
      label: `${row.accountName} guest deadline`,
    })
  }
  const collection = eventDateIso(row.deliveryDueAt)
  const client = resolvedClientDelivery(row.supplierFulfilmentMethod, row.clientDeliveryMethod)
  if (
    collection &&
    !isOperationsDelivered(row) &&
    (client === "local_collection" || client === "posted_to_guest" || client === "official_shipment")
  ) {
    items.push({
      date: collection,
      kind: "collection",
      bookingId: row.id,
      label: `${row.accountName} ${clientDeliveryLabel(client)}`,
    })
  }
  return items
}
