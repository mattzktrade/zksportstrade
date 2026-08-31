import { unstable_noStore as noStore } from "next/cache"
import { computeOrderProfit, getConsumptionsForOrders } from "@/lib/admin/cost-layers"
import { isCancelledWorkflowRow } from "@/lib/admin/workflow-status"
import type { OperationsEmailHistoryRow } from "@/lib/operations/emails"
import { isOperationsEmailKind } from "@/lib/operations/emails"
import type { OperationsStockAllocation, OperationsStockLayer } from "@/lib/operations/stock"
import { applyUnlinkedDealSalesToRemaining, stockLayerKey, summarizeMappedSuppliers } from "@/lib/operations/stock"
import { createClient } from "@/lib/supabase/server"
import { eventSeasonLabel } from "@/lib/catalog/event-label"

export type WorkflowOrderRow = {
  id: string
  reference: string
  channel: string
  orderStatus: string
  accountId: string | null
  contactId: string | null
  dealId: string | null
  dealReference: string | null
  dealStage: string | null
  dealSource: string | null
  dealNextAction: string | null
  dealNextActionDueAt: string | null
  ownerId: string | null
  ownerName: string | null
  accountName: string
  contactName: string
  contactEmail: string
  eventPackage: string
  eventDate: string | null
  quantity: number
  total: number
  currency: string
  cogs: number | null
  grossProfit: number | null
  margin: number | null
  costKnown: boolean
  createdAt: string
  invoiceId: string | null
  invoiceStatus: string | null
  xeroInvoiceNumber: string | null
  xeroSyncStatus: string | null
  xeroSyncError: string | null
  invoiceDueDate: string | null
  overdueSince: string | null
  cancellationEligibleAt: string | null
  reminderCount: number
  lastReminderAt: string | null
  amountDue: number
  amountPaid: number
  paidAt: string | null
  bookingFormStatus: string | null
  bookingFormSentAt: string | null
  bookingFormClientSignedAt: string | null
  bookingFormZkSignedAt: string | null
  bookingFormCompletedAt: string | null
  fulfilmentStatus: string
  guestDetailsStatus: string
  communicationStatus: string
  supplierStatus: string
  deliveryStatus: string
  operationsOwnerId: string | null
  operationsOwnerName: string | null
  guestDetailsDueAt: string | null
  supplierDueAt: string | null
  deliveryDueAt: string | null
  internalNotes: string | null
  guestCount: number
  completeGuestCount: number
  supplierSummary: string
}

export type OperationsGuest = {
  id: string
  orderId: string | null
  dealId: string | null
  fullName: string | null
  email: string | null
  phone: string | null
  nationality: string | null
  dateOfBirth: string | null
  dietaryRequirements: string | null
  specialRequests: string | null
  isLeadGuest: boolean
  detailsComplete: boolean
  sortOrder: number
}

export type OperationsSupplierRow = {
  id: string
  orderId: string
  orderLineItemId: string | null
  packageId: string
  packageName: string
  supplierId: string | null
  supplierName: string | null
  quantity: number
  status: string
  supplierReference: string | null
  expectedAt: string | null
  notes: string | null
}

export type OperationsLineOption = {
  id: string
  orderId: string
  packageId: string
  ledgerPackageId: string
  description: string
  quantity: number
}

export type OperationsSupportingData = {
  guests: OperationsGuest[]
  supplierRows: OperationsSupplierRow[]
  lines: OperationsLineOption[]
  stockLayers: OperationsStockLayer[]
  allocations: OperationsStockAllocation[]
  suppliers: Array<{ id: string; name: string }>
  staff: Array<{ id: string; name: string }>
  emails: OperationsEmailHistoryRow[]
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

const CHECKOUT_CHANNELS = new Set(["trade_portal", "admin", "partner_api", "wix"])
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type PackageEmbed = {
  id?: string
  name: string
  event_date: string | null
  races: { name: string; season: number } | Array<{ name: string; season: number }> | null
}

type DealEmbed = {
  id: string
  order_id: string | null
  reference: string
  stage: string
  source: string
  account_id: string | null
  primary_contact_id: string | null
  owner_profile_id: string | null
  next_action: string | null
  next_action_due_at: string | null
}

type InvoiceEmbed = {
  id: string
  order_id: string
  status: string
  created_at: string
  xero_invoice_number: string | null
  xero_sync_status: string | null
  xero_sync_error: string | null
  due_date: string | null
  overdue_since: string | null
  cancellation_eligible_at: string | null
  payment_reminder_count: number | null
  last_payment_reminder_at: string | null
  xero_amount_due: number | null
  xero_amount_paid: number | null
  paid_at: string | null
}

type LineEmbed = {
  order_id: string
  package_id: string
  description: string
  quantity: number
  sort_order: number
}

type OperationEmbed = {
  order_id: string
  fulfilment_status: string
  guest_details_status: string
  communication_status: string
  supplier_status: string
  delivery_status: string
  owner_profile_id: string | null
  guest_details_due_at: string | null
  supplier_due_at: string | null
  delivery_due_at: string | null
  internal_notes: string | null
}

async function fetchInChunks<T>(
  ids: string[],
  run: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  if (ids.length === 0) return []
  const size = 400
  const out: T[] = []
  for (let i = 0; i < ids.length; i += size) {
    out.push(...(await run(ids.slice(i, i + size))))
  }
  return out
}

function invoiceStatusFromDeal(stage: string | null | undefined, orderStatus: string): string | null {
  if (orderStatus === "cancelled") return "cancelled"
  switch (stage) {
    case "paid_confirmed":
    case "in_fulfilment":
    case "fulfilled":
      return "paid"
    case "awaiting_payment":
      return "awaiting_payment"
    case "awaiting_invoice":
    case "signed":
      return "awaiting_invoice"
    case "cancelled":
    case "closed_lost":
      return "cancelled"
    default:
      return null
  }
}

function channelFromDealSource(source: string | null | undefined, salesforceId?: string | null): string {
  if (salesforceId) return "salesforce_import"
  if (source === "portal") return "trade_portal"
  if (source === "website") return "wix"
  return source || "offline"
}

function fulfilmentFromDealStage(stage: string): string {
  if (stage === "fulfilled") return "delivered"
  if (stage === "in_fulfilment") return "in_progress"
  if (stage === "paid_confirmed") return "confirmed"
  if (stage === "cancelled") return "cancelled"
  return "awaiting_payment"
}

function workflowBookingFormStatus(
  formStatus: string | null | undefined,
  dealStage: string | null | undefined,
): string | null {
  if (formStatus === "draft" || formStatus === "failed") {
    return "ready_to_send"
  }
  if (formStatus) return formStatus
  if (dealStage === "awaiting_booking_form_send") return "ready_to_send"
  return bookingFormStatusFromDealStage(dealStage ?? "")
}

function bookingFormStatusFromDealStage(stage: string): string | null {
  if (
    [
      "signed",
      "awaiting_invoice",
      "awaiting_payment",
      "paid_confirmed",
      "in_fulfilment",
      "fulfilled",
    ].includes(stage)
  ) {
    return "completed"
  }
  if (stage === "awaiting_zk_signature") return "client_signed"
  if (stage === "booking_form_sent" || stage === "awaiting_client_signature") return "sent"
  if (stage === "awaiting_booking_form_send") return "ready_to_send"
  return null
}

const FINANCE_DEAL_STAGES = [
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
  "cancelled",
] as const

const OPERATIONS_DEAL_STAGES = [
  "signed",
  "awaiting_invoice",
  "awaiting_payment",
  "paid_confirmed",
  "in_fulfilment",
  "fulfilled",
] as const

const DEAL_WORKFLOW_SELECT = `
  id, reference, stage, source, currency, total_amount, expected_close_date,
  account_id, primary_contact_id, order_id, salesforce_opportunity_id,
  external_created_at, closed_at, created_at, owner_profile_id,
  next_action, next_action_due_at,
  crm_accounts(name), crm_contacts(full_name, email),
  deal_line_items(
    package_id, quantity, unit_sale_price, expected_unit_cost, sort_order,
    supplier_id, fulfilment_cost_layer_id,
    packages(name, event_date, races(name, season))
  )
` as const

type DealWorkflowRecord = {
  id: string
  reference: string
  stage: string
  source: string
  currency: string | null
  total_amount: number | null
  expected_close_date: string | null
  account_id: string | null
  primary_contact_id: string | null
  order_id: string | null
  salesforce_opportunity_id: string | null
  external_created_at: string | null
  closed_at: string | null
  created_at: string
  owner_profile_id: string | null
  next_action: string | null
  next_action_due_at: string | null
  crm_accounts: { name: string } | { name: string }[] | null
  crm_contacts: { full_name: string; email: string | null } | { full_name: string; email: string | null }[] | null
  deal_line_items: Array<{
    package_id: string
    quantity: number
    unit_sale_price: number
    expected_unit_cost: number | null
    sort_order: number
    supplier_id: string | null
    fulfilment_cost_layer_id: string | null
    packages:
      | PackageEmbed
      | PackageEmbed[]
      | null
  }> | null
}

function mapDealToWorkflowRow(
  deal: DealWorkflowRecord,
  ownerNames: Map<string, string>,
  bookingForm?: {
    status: string
    sent_at: string | null
    client_signed_at: string | null
    zk_signed_at: string | null
    completed_at: string | null
  } | null,
  operations?: {
    fulfilment_status: string
    guest_details_status: string
    communication_status: string
    supplier_status: string
    delivery_status: string
  } | null,
  guestStats?: { count: number; complete: number },
  supplierById?: Map<string, string>,
): WorkflowOrderRow {
  const account = one(deal.crm_accounts)
  const contact = one(deal.crm_contacts)
  const lines = [...(deal.deal_line_items ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  const quantity = lines.reduce((sum, line) => sum + Number(line.quantity), 0)
  const total = Number(deal.total_amount ?? 0)
  const costKnown = lines.length > 0 && lines.every((line) => line.expected_unit_cost != null)
  const cogs = costKnown
    ? lines.reduce((sum, line) => sum + Number(line.expected_unit_cost) * Number(line.quantity), 0)
    : null
  const firstPackage = one(lines[0]?.packages)
  const eventPackage =
    lines
      .map((line) => packageLabel(one(line.packages), line.package_id))
      .join(", ") || "Product not mapped"
  const reportingDate =
    deal.expected_close_date ||
    deal.closed_at?.slice(0, 10) ||
    deal.external_created_at?.slice(0, 10) ||
    deal.created_at.slice(0, 10)
  const createdAt = deal.created_at.includes("T") ? deal.created_at : `${reportingDate}T12:00:00.000Z`
  const invoiceStatus = invoiceStatusFromDeal(deal.stage, deal.stage === "cancelled" ? "cancelled" : "confirmed")
  const paidLike = ["paid", "delivered", "cancelled"].includes(invoiceStatus ?? "")
  const historical = Boolean(deal.salesforce_opportunity_id) && !deal.order_id
  return {
    id: `deal:${deal.id}`,
    reference: deal.reference,
    channel: channelFromDealSource(deal.source, deal.salesforce_opportunity_id),
    orderStatus: historical ? "historical_won" : deal.stage === "cancelled" ? "cancelled" : "confirmed",
    accountId: deal.account_id ?? null,
    contactId: deal.primary_contact_id ?? null,
    dealId: deal.id,
    dealReference: deal.reference,
    dealStage: deal.stage,
    dealSource: deal.source,
    dealNextAction: deal.next_action,
    dealNextActionDueAt: deal.next_action_due_at,
    ownerId: deal.owner_profile_id,
    ownerName: deal.owner_profile_id ? ownerNames.get(deal.owner_profile_id) ?? null : null,
    accountName: account?.name ?? "Unknown account",
    contactName: contact?.full_name ?? "—",
    contactEmail: contact?.email ?? "",
    eventPackage,
    eventDate: firstPackage?.event_date ?? null,
    quantity,
    total,
    currency: deal.currency || "USD",
    cogs,
    grossProfit: cogs == null ? null : total - cogs,
    margin: cogs == null || total <= 0 ? null : (total - cogs) / total,
    costKnown,
    createdAt,
    invoiceId: null,
    invoiceStatus,
    xeroInvoiceNumber: null,
    xeroSyncStatus: null,
    xeroSyncError: null,
    invoiceDueDate: null,
    overdueSince: null,
    cancellationEligibleAt: null,
    reminderCount: 0,
    lastReminderAt: null,
    amountDue: paidLike ? 0 : total,
    amountPaid: paidLike ? total : 0,
    paidAt: paidLike ? deal.closed_at ?? deal.created_at : null,
    bookingFormStatus: workflowBookingFormStatus(bookingForm?.status, deal.stage),
    bookingFormSentAt: bookingForm?.sent_at ?? null,
    bookingFormClientSignedAt: bookingForm?.client_signed_at ?? null,
    bookingFormZkSignedAt: bookingForm?.zk_signed_at ?? null,
    bookingFormCompletedAt: bookingForm?.completed_at ?? null,
    fulfilmentStatus: operations?.fulfilment_status ?? fulfilmentFromDealStage(deal.stage),
    guestDetailsStatus: operations?.guest_details_status ?? "not_requested",
    communicationStatus: operations?.communication_status ?? "not_started",
    supplierStatus: operations?.supplier_status ?? "unassigned",
    deliveryStatus: operations?.delivery_status ?? "not_ready",
    operationsOwnerId: null,
    operationsOwnerName: null,
    guestDetailsDueAt: null,
    supplierDueAt: null,
    deliveryDueAt: null,
    internalNotes: historical
      ? "Imported deal without a native operational order yet."
      : deal.order_id
        ? null
        : "Offline deal without a committed order yet.",
    guestCount: guestStats?.count ?? 0,
    completeGuestCount: guestStats?.complete ?? 0,
    supplierSummary:
      summarizeMappedSuppliers(
        lines.map((line) => ({
          quantity: Number(line.quantity),
          supplierName: line.supplier_id ? supplierById?.get(line.supplier_id) ?? null : null,
        })),
      ) || "Unassigned",
  }
}

async function getUnlinkedDealWorkflowRows(stages: readonly string[]): Promise<WorkflowOrderRow[]> {
  noStore()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("deals")
    .select(DEAL_WORKFLOW_SELECT)
    .in("stage", [...stages])
    .is("order_id", null)
    .order("created_at", { ascending: false })
    .limit(10000)
  if (error) {
    console.error("[getUnlinkedDealWorkflowRows]", error.message)
    return []
  }
  if (!data?.length) return []

  const dealIds = data.map((deal) => String(deal.id))
  const ownerIds = [...new Set(data.map((deal) => deal.owner_profile_id).filter(Boolean))] as string[]
  const [ownersResult, bookingForms, operationsRows, dealGuestRows] = await Promise.all([
    ownerIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", ownerIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
    fetchInChunks(dealIds, async (chunk) => {
      const { data: rows, error: formError } = await supabase
        .from("booking_forms")
        .select("deal_id, revision, status, sent_at, client_signed_at, zk_signed_at, completed_at")
        .in("deal_id", chunk)
        .order("revision", { ascending: false })
      if (formError) console.error("[getUnlinkedDealWorkflowRows] booking forms", formError.message)
      return (rows ?? []) as Array<{
        deal_id: string
        revision: number
        status: string
        sent_at: string | null
        client_signed_at: string | null
        zk_signed_at: string | null
        completed_at: string | null
      }>
    }),
    fetchInChunks(dealIds, async (chunk) => {
      const { data: rows, error: opsError } = await supabase
        .from("deal_operations")
        .select(
          "deal_id, fulfilment_status, guest_details_status, communication_status, supplier_status, delivery_status",
        )
        .in("deal_id", chunk)
      if (opsError) console.error("[getUnlinkedDealWorkflowRows] deal operations", opsError.message)
      return (rows ?? []) as Array<{
        deal_id: string
        fulfilment_status: string
        guest_details_status: string
        communication_status: string
        supplier_status: string
        delivery_status: string
      }>
    }),
    fetchInChunks(dealIds, async (chunk) => {
      const { data: rows, error: guestError } = await supabase
        .from("deal_guests")
        .select("deal_id, details_complete")
        .in("deal_id", chunk)
      if (guestError) console.error("[getUnlinkedDealWorkflowRows] deal guests", guestError.message)
      return (rows ?? []) as Array<{ deal_id: string; details_complete: boolean }>
    }),
  ])
  const ownerNames = new Map((ownersResult.data ?? []).map((owner) => [owner.id, owner.full_name]))
  const bookingFormByDeal = new Map<string, (typeof bookingForms)[number]>()
  for (const form of bookingForms) {
    if (!bookingFormByDeal.has(String(form.deal_id))) {
      bookingFormByDeal.set(String(form.deal_id), form)
    }
  }
  const operationsByDeal = new Map(operationsRows.map((row) => [String(row.deal_id), row]))
  const guestStatsByDeal = new Map<string, { count: number; complete: number }>()
  for (const row of dealGuestRows) {
    const dealId = String(row.deal_id)
    const current = guestStatsByDeal.get(dealId) ?? { count: 0, complete: 0 }
    current.count += 1
    if (row.details_complete) current.complete += 1
    guestStatsByDeal.set(dealId, current)
  }

  const supplierIds = [
    ...new Set(
      (data as DealWorkflowRecord[])
        .flatMap((deal) => deal.deal_line_items ?? [])
        .map((line) => line.supplier_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const { data: namedSuppliers } = supplierIds.length
    ? await supabase.from("suppliers").select("id, name").in("id", supplierIds)
    : { data: [] as Array<{ id: string; name: string }> }
  const supplierById = new Map((namedSuppliers ?? []).map((row) => [String(row.id), String(row.name)]))

  return (data as DealWorkflowRecord[]).map((deal) =>
    mapDealToWorkflowRow(
      deal,
      ownerNames,
      bookingFormByDeal.get(String(deal.id)) ?? null,
      operationsByDeal.get(String(deal.id)) ?? null,
      guestStatsByDeal.get(String(deal.id)),
      supplierById,
    ),
  )
}

function mergeOrderAndDealRows(orders: WorkflowOrderRow[], deals: WorkflowOrderRow[]): WorkflowOrderRow[] {
  const linkedDealIds = new Set(orders.map((row) => row.dealId).filter(Boolean))
  const extra = deals.filter((row) => !row.dealId || !linkedDealIds.has(row.dealId))
  return [...orders, ...extra].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

export async function getFinanceWorkflowRows(): Promise<WorkflowOrderRow[]> {
  const [orders, deals] = await Promise.all([
    getWorkflowOrderRows(),
    getUnlinkedDealWorkflowRows(FINANCE_DEAL_STAGES),
  ])
  return mergeOrderAndDealRows(orders, deals)
}

export async function getOperationsWorkflowRows(): Promise<WorkflowOrderRow[]> {
  const [orders, deals] = await Promise.all([
    getWorkflowOrderRows(),
    getUnlinkedDealWorkflowRows(OPERATIONS_DEAL_STAGES),
  ])
  return mergeOrderAndDealRows(orders, deals).filter((row) => !isCancelledWorkflowRow(row))
}

function packageLabel(pkg: PackageEmbed | null | undefined, fallback: string): string {
  if (!pkg) return fallback
  const race = one(pkg.races)
  const event = race ? eventSeasonLabel(race.name, race.season) : null
  return [event, pkg.name].filter(Boolean).join(" · ") || fallback
}

export async function getWorkflowOrderRows(): Promise<WorkflowOrderRow[]> {
  noStore()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("orders")
    .select(
      `
      id, reference, channel, status, deal_id, agent_profile_id, crm_account_id,
      crm_contact_id, client_name, client_email, package_id,
      guests, total_amount, currency, created_at
    `,
    )
    .order("created_at", { ascending: false })
    .limit(10000)
  if (error) {
    console.error("[getWorkflowOrderRows] orders", error.message)
    return []
  }
  if (!data?.length) return []

  const orderIds = data.map((row) => String(row.id))
  const dealIdsFromOrders = data.map((row) => row.deal_id).filter(Boolean).map(String)
  const agentIds = data.map((row) => row.agent_profile_id).filter(Boolean).map(String)
  const accountIdsFromOrders = data.map((row) => row.crm_account_id).filter(Boolean).map(String)
  const contactIdsFromOrders = data.map((row) => row.crm_contact_id).filter(Boolean).map(String)

  const [
    invoices,
    dealsByIdRows,
    dealsByOrderRows,
    lineItems,
    operations,
    guests,
    supplierRows,
    agents,
    consumptionsByOrder,
  ] = await Promise.all([
    fetchInChunks(orderIds, async (chunk) => {
      const { data: rows, error: invoiceError } = await supabase
        .from("invoices")
        .select(
          `
          id, order_id, status, created_at, xero_invoice_number, xero_sync_status,
          xero_sync_error, due_date, overdue_since, cancellation_eligible_at,
          payment_reminder_count, last_payment_reminder_at, xero_amount_due,
          xero_amount_paid, paid_at
        `,
        )
        .in("order_id", chunk)
        .order("created_at", { ascending: false })
      if (invoiceError) console.error("[getWorkflowOrderRows] invoices", invoiceError.message)
      return (rows ?? []) as InvoiceEmbed[]
    }),
    fetchInChunks(dealIdsFromOrders, async (chunk) => {
      const { data: rows, error: dealError } = await supabase
        .from("deals")
        .select(
          "id, order_id, reference, stage, source, account_id, primary_contact_id, owner_profile_id, next_action, next_action_due_at",
        )
        .in("id", chunk)
      if (dealError) console.error("[getWorkflowOrderRows] deals", dealError.message)
      return (rows ?? []) as DealEmbed[]
    }),
    fetchInChunks(orderIds, async (chunk) => {
      const { data: rows, error: dealError } = await supabase
        .from("deals")
        .select(
          "id, order_id, reference, stage, source, account_id, primary_contact_id, owner_profile_id, next_action, next_action_due_at",
        )
        .in("order_id", chunk)
      if (dealError) console.error("[getWorkflowOrderRows] deals-by-order", dealError.message)
      return (rows ?? []) as DealEmbed[]
    }),
    fetchInChunks(orderIds, async (chunk) => {
      const { data: rows, error: lineError } = await supabase
        .from("order_line_items")
        .select("order_id, package_id, description, quantity, sort_order")
        .in("order_id", chunk)
        .order("sort_order")
      if (lineError) console.error("[getWorkflowOrderRows] line items", lineError.message)
      return (rows ?? []) as LineEmbed[]
    }),
    fetchInChunks(orderIds, async (chunk) => {
      const { data: rows, error: opError } = await supabase
        .from("order_operations")
        .select(
          `
          order_id, fulfilment_status, guest_details_status, communication_status,
          supplier_status, delivery_status, owner_profile_id, guest_details_due_at,
          supplier_due_at, delivery_due_at, internal_notes
        `,
        )
        .in("order_id", chunk)
      if (opError) console.error("[getWorkflowOrderRows] operations", opError.message)
      return (rows ?? []) as OperationEmbed[]
    }),
    fetchInChunks(orderIds, async (chunk) => {
      const { data: rows, error: guestError } = await supabase
        .from("order_guests")
        .select("id, order_id, details_complete")
        .in("order_id", chunk)
      if (guestError) console.error("[getWorkflowOrderRows] guests", guestError.message)
      return (rows ?? []) as Array<{ id: string; order_id: string; details_complete: boolean }>
    }),
    fetchInChunks(orderIds, async (chunk) => {
      const { data: rows, error: supplierError } = await supabase
        .from("order_supplier_fulfilments")
        .select("order_id, quantity, status, suppliers(name)")
        .in("order_id", chunk)
      if (supplierError) {
        console.error("[getWorkflowOrderRows] supplier fulfilments", supplierError.message)
      }
      return (rows ?? []) as Array<{
        order_id: string
        quantity: number
        status: string
        suppliers: { name: string } | { name: string }[] | null
      }>
    }),
    fetchInChunks(agentIds, async (chunk) => {
      const { data: rows, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, company_name, email")
        .in("id", chunk)
      if (profileError) console.error("[getWorkflowOrderRows] agents", profileError.message)
      return (rows ?? []) as Array<{
        id: string
        full_name: string | null
        company_name: string | null
        email: string
      }>
    }),
    getConsumptionsForOrders(orderIds),
  ])

  const dealsById = new Map<string, DealEmbed>()
  const dealsByOrder = new Map<string, DealEmbed>()
  for (const deal of [...dealsByIdRows, ...dealsByOrderRows]) {
    dealsById.set(String(deal.id), deal)
    if (deal.order_id) dealsByOrder.set(String(deal.order_id), deal)
  }

  const invoiceByOrder = new Map<string, InvoiceEmbed>()
  for (const invoice of invoices) {
    const orderId = String(invoice.order_id)
    if (!invoiceByOrder.has(orderId)) invoiceByOrder.set(orderId, invoice)
  }

  const linesByOrder = new Map<string, LineEmbed[]>()
  for (const line of lineItems) {
    const orderId = String(line.order_id)
    const list = linesByOrder.get(orderId) ?? []
    list.push(line)
    linesByOrder.set(orderId, list)
  }

  const operationByOrder = new Map(operations.map((row) => [String(row.order_id), row]))
  const guestsByOrder = new Map<string, Array<{ id: string; details_complete: boolean }>>()
  for (const guest of guests) {
    const orderId = String(guest.order_id)
    const list = guestsByOrder.get(orderId) ?? []
    list.push(guest)
    guestsByOrder.set(orderId, list)
  }
  const suppliersByOrder = new Map<string, typeof supplierRows>()
  for (const row of supplierRows) {
    const orderId = String(row.order_id)
    const list = suppliersByOrder.get(orderId) ?? []
    list.push(row)
    suppliersByOrder.set(orderId, list)
  }
  const agentById = new Map(agents.map((row) => [String(row.id), row]))

  const packageIds = [
    ...new Set(
      [
        ...data.map((row) => String(row.package_id)),
        ...lineItems.map((line) => String(line.package_id)),
      ].filter(Boolean),
    ),
  ]
  const accountIds = [
    ...new Set(
      [
        ...accountIdsFromOrders,
        ...[...dealsById.values()].map((deal) => deal.account_id).filter(Boolean).map(String),
      ],
    ),
  ]
  const contactIds = [
    ...new Set(
      [
        ...contactIdsFromOrders,
        ...[...dealsById.values()].map((deal) => deal.primary_contact_id).filter(Boolean).map(String),
      ],
    ),
  ]
  const resolvedDealIds = [
    ...new Set(
      data
        .map((row) => {
          const deal = (row.deal_id && dealsById.get(String(row.deal_id))) || dealsByOrder.get(String(row.id))
          return deal?.id
        })
        .filter(Boolean)
        .map(String),
    ),
  ]

  const [packages, accounts, contacts, bookingForms] = await Promise.all([
    fetchInChunks(packageIds, async (chunk) => {
      const { data: rows, error: packageError } = await supabase
        .from("packages")
        .select("id, name, event_date, races(name, season)")
        .in("id", chunk)
      if (packageError) console.error("[getWorkflowOrderRows] packages", packageError.message)
      return (rows ?? []) as Array<PackageEmbed & { id: string }>
    }),
    fetchInChunks(accountIds, async (chunk) => {
      const { data: rows, error: accountError } = await supabase
        .from("crm_accounts")
        .select("id, name")
        .in("id", chunk)
      if (accountError) console.error("[getWorkflowOrderRows] accounts", accountError.message)
      return (rows ?? []) as Array<{ id: string; name: string }>
    }),
    fetchInChunks(contactIds, async (chunk) => {
      const { data: rows, error: contactError } = await supabase
        .from("crm_contacts")
        .select("id, full_name, email")
        .in("id", chunk)
      if (contactError) console.error("[getWorkflowOrderRows] contacts", contactError.message)
      return (rows ?? []) as Array<{ id: string; full_name: string; email: string | null }>
    }),
    fetchInChunks(resolvedDealIds, async (chunk) => {
      const { data: rows, error: formError } = await supabase
        .from("booking_forms")
        .select("deal_id, revision, status, sent_at, client_signed_at, zk_signed_at, completed_at")
        .in("deal_id", chunk)
        .order("revision", { ascending: false })
      if (formError) console.error("[getWorkflowOrderRows] booking forms", formError.message)
      return (rows ?? []) as Array<{
        deal_id: string
        revision: number
        status: string
        sent_at: string | null
        client_signed_at: string | null
        zk_signed_at: string | null
        completed_at: string | null
      }>
    }),
  ])

  const packageById = new Map(packages.map((row) => [String(row.id), row]))
  const accountById = new Map(accounts.map((row) => [String(row.id), row]))
  const contactById = new Map(contacts.map((row) => [String(row.id), row]))
  const bookingFormByDeal = new Map<string, (typeof bookingForms)[number]>()
  for (const form of bookingForms) {
    if (!bookingFormByDeal.has(String(form.deal_id))) {
      bookingFormByDeal.set(String(form.deal_id), form)
    }
  }

  const ownerIds = [
    ...new Set(
      [
        ...[...dealsById.values()].map((deal) => deal.owner_profile_id),
        ...operations.map((row) => row.owner_profile_id),
      ].filter(Boolean) as string[],
    ),
  ]
  const { data: owners } = ownerIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ownerIds)
    : { data: [] as Array<{ id: string; full_name: string }> }
  const ownerNames = new Map((owners ?? []).map((owner) => [owner.id, owner.full_name]))

  return data.map((row) => {
    const orderId = String(row.id)
    const deal = (row.deal_id && dealsById.get(String(row.deal_id))) || dealsByOrder.get(orderId) || null
    const profile = row.agent_profile_id ? agentById.get(String(row.agent_profile_id)) ?? null : null
    const accountId = row.crm_account_id ?? deal?.account_id ?? null
    const contactId = row.crm_contact_id ?? deal?.primary_contact_id ?? null
    const account = accountId ? accountById.get(String(accountId)) ?? null : null
    const contact = contactId ? contactById.get(String(contactId)) ?? null : null
    const pkg = packageById.get(String(row.package_id)) ?? null
    const invoice = invoiceByOrder.get(orderId) ?? null
    const operation = operationByOrder.get(orderId) ?? null
    const bookingForm = deal ? bookingFormByDeal.get(String(deal.id)) ?? null : null
    const lines = [...(linesByOrder.get(orderId) ?? [])].sort((a, b) => a.sort_order - b.sort_order)
    const guestList = guestsByOrder.get(orderId) ?? []
    const fulfilmentSuppliers = suppliersByOrder.get(orderId) ?? []
    const quantity = lines.length
      ? lines.reduce((sum, line) => sum + Number(line.quantity), 0)
      : Number(row.guests)
    const total = Number(row.total_amount)
    const currency = String(row.currency || "USD")
    const profit = computeOrderProfit(
      currency,
      total,
      consumptionsByOrder.get(orderId) ?? [],
      quantity || undefined,
    )
    const productLabel = lines.length
      ? lines
          .map((line) =>
            packageLabel(packageById.get(String(line.package_id)) ?? null, line.description),
          )
          .join(", ")
      : packageLabel(pkg, String(row.package_id))
    const lineEventDates = lines
      .map((line) => packageById.get(String(line.package_id))?.event_date)
      .filter((value): value is string => Boolean(value))
    const invoiceStatus =
      invoice?.status ?? invoiceStatusFromDeal(deal?.stage, String(row.status)) ?? "awaiting_invoice"
    const paidLike = ["paid", "delivered", "cancelled"].includes(invoiceStatus)
    const checkoutConfirmed = CHECKOUT_CHANNELS.has(String(row.channel)) && !bookingForm
    const ownerId = deal?.owner_profile_id ?? row.agent_profile_id ?? null
    const supplierSummary =
      fulfilmentSuppliers.length > 0
        ? fulfilmentSuppliers
            .map((supplierRow) => {
              const supplier = one(supplierRow.suppliers)
              return `${supplierRow.quantity}× ${supplier?.name || "Unassigned"}`
            })
            .join(", ")
        : (consumptionsByOrder.get(orderId) ?? [])
            .map((consumption) => consumption.supplier_source_snapshot || "Unassigned")
            .filter((value, index, all) => all.indexOf(value) === index)
            .join(", ")

    return {
      id: orderId,
      reference: String(row.reference),
      channel: String(row.channel || "trade_portal"),
      orderStatus: String(row.status),
      accountId: accountId ? String(accountId) : null,
      contactId: contactId ? String(contactId) : null,
      dealId: deal?.id ?? row.deal_id ?? null,
      dealReference: deal?.reference ?? null,
      dealStage: deal?.stage ?? null,
      dealSource: deal?.source ?? null,
      dealNextAction: deal?.next_action ?? null,
      dealNextActionDueAt: deal?.next_action_due_at ?? null,
      ownerId: ownerId ? String(ownerId) : null,
      ownerName: ownerId
        ? ownerNames.get(String(ownerId)) ?? profile?.full_name ?? null
        : profile?.full_name ?? null,
      accountName:
        account?.name || profile?.company_name || profile?.full_name || row.client_name || "Direct client",
      contactName: contact?.full_name || row.client_name || profile?.full_name || "—",
      contactEmail: contact?.email || row.client_email || profile?.email || "",
      eventPackage: productLabel,
      eventDate: lineEventDates.length > 0 ? [...lineEventDates].sort()[0] : pkg?.event_date ?? null,
      quantity,
      total,
      currency,
      cogs: profit.cogs,
      grossProfit: profit.gross_profit,
      margin: profit.margin,
      costKnown: profit.cost_known,
      createdAt: String(row.created_at),
      invoiceId: invoice?.id ?? null,
      invoiceStatus,
      xeroInvoiceNumber: invoice?.xero_invoice_number ?? null,
      xeroSyncStatus: invoice?.xero_sync_status ?? null,
      xeroSyncError: invoice?.xero_sync_error ?? null,
      invoiceDueDate: invoice?.due_date ?? null,
      overdueSince: invoice?.overdue_since ?? null,
      cancellationEligibleAt: invoice?.cancellation_eligible_at ?? null,
      reminderCount: Number(invoice?.payment_reminder_count ?? 0),
      lastReminderAt: invoice?.last_payment_reminder_at ?? null,
      amountDue:
        invoice?.xero_amount_due == null ? (paidLike ? 0 : total) : Number(invoice.xero_amount_due),
      amountPaid: Number(invoice?.xero_amount_paid ?? (paidLike ? total : 0)),
      paidAt: invoice?.paid_at ?? null,
      bookingFormStatus: bookingForm
        ? workflowBookingFormStatus(bookingForm.status, deal?.stage ?? null)
        : checkoutConfirmed
          ? "checkout_terms"
          : null,
      bookingFormSentAt: bookingForm?.sent_at ?? (checkoutConfirmed ? String(row.created_at) : null),
      bookingFormClientSignedAt:
        bookingForm?.client_signed_at ?? (checkoutConfirmed ? String(row.created_at) : null),
      bookingFormZkSignedAt: bookingForm?.zk_signed_at ?? null,
      bookingFormCompletedAt:
        bookingForm?.completed_at ?? (checkoutConfirmed ? String(row.created_at) : null),
      fulfilmentStatus: operation?.fulfilment_status ?? (paidLike ? "confirmed" : "awaiting_payment"),
      guestDetailsStatus: operation?.guest_details_status ?? "not_requested",
      communicationStatus: operation?.communication_status ?? "not_started",
      supplierStatus: operation?.supplier_status ?? "unassigned",
      deliveryStatus: operation?.delivery_status ?? "not_ready",
      operationsOwnerId: operation?.owner_profile_id ?? null,
      operationsOwnerName: operation?.owner_profile_id
        ? ownerNames.get(operation.owner_profile_id) ?? null
        : null,
      guestDetailsDueAt: operation?.guest_details_due_at ?? null,
      supplierDueAt: operation?.supplier_due_at ?? null,
      deliveryDueAt: operation?.delivery_due_at ?? null,
      internalNotes: operation?.internal_notes ?? null,
      guestCount: guestList.length,
      completeGuestCount: guestList.filter((guest) => guest.details_complete).length,
      supplierSummary: supplierSummary || "Unassigned",
    }
  })
}

/** Confirmed-sales reporting rows, including won deals with no native order. */
export async function getSalesTrackerRows(): Promise<WorkflowOrderRow[]> {
  const [orders, deals] = await Promise.all([
    getWorkflowOrderRows(),
    getUnlinkedDealWorkflowRows(["paid_confirmed", "in_fulfilment", "fulfilled"]),
  ])
  return mergeOrderAndDealRows(orders, deals)
}

export async function getOperationsSupportingData(): Promise<OperationsSupportingData> {
  noStore()
  const supabase = await createClient()
  const [
    { data: guestRows },
    { data: dealGuestRows },
    { data: supplierRows },
    { data: lineRows },
    { data: suppliers },
    { data: staff },
    { data: orderRows },
    emailsResult,
    { data: unlinkedDeals },
  ] = await Promise.all([
    supabase
      .from("order_guests")
      .select(
        "id, order_id, full_name, email, phone, nationality, date_of_birth, dietary_requirements, special_requests, is_lead_guest, details_complete, sort_order",
      )
      .order("sort_order"),
    supabase
      .from("deal_guests")
      .select(
        "id, deal_id, full_name, email, phone, nationality, date_of_birth, dietary_requirements, special_requests, is_lead_guest, details_complete, sort_order",
      )
      .order("sort_order"),
    supabase
      .from("order_supplier_fulfilments")
      .select(
        "id, order_id, order_line_item_id, package_id, supplier_id, quantity, status, supplier_reference, expected_at, notes, packages(name), suppliers(name)",
      )
      .order("created_at"),
    supabase
      .from("order_line_items")
      .select("id, order_id, package_id, description, quantity")
      .order("sort_order"),
    supabase.from("suppliers").select("id, name").eq("active", true).order("name"),
    supabase
      .from("profiles")
      .select("id, full_name")
      .in("role", ["admin", "sales"])
      .order("full_name"),
    supabase.from("orders").select("id, package_id, guests, packages(name)"),
    supabase
      .from("operations_emails")
      .select("id, deal_id, order_id, kind, to_email, to_name, subject, sent_at, sent_by")
      .order("sent_at", { ascending: false })
      .limit(4000),
    supabase
      .from("deals")
      .select("id")
      .is("order_id", null)
      .in("stage", [...OPERATIONS_DEAL_STAGES])
      .limit(10000),
  ])

  const unlinkedDealIds = (unlinkedDeals ?? []).map((row) => String(row.id))
  const dealLineRows =
    unlinkedDealIds.length > 0
      ? await fetchInChunks(unlinkedDealIds, async (chunk) => {
          const { data } = await supabase
            .from("deal_line_items")
            .select("id, deal_id, package_id, quantity, supplier_id, fulfilment_cost_layer_id, packages(name)")
            .in("deal_id", chunk)
            .order("sort_order")
          return (data ?? []) as Array<{
            id: string
            deal_id: string
            package_id: string
            quantity: number
            supplier_id: string | null
            fulfilment_cost_layer_id: string | null
            packages: { name: string } | { name: string }[] | null
          }>
        })
      : []
  const dealLines: OperationsLineOption[] = dealLineRows.map((row) => ({
    id: String(row.id),
    orderId: `deal:${row.deal_id}`,
    packageId: String(row.package_id),
    ledgerPackageId: String(row.package_id),
    description: one(row.packages)?.name ?? String(row.package_id),
    quantity: Number(row.quantity),
  }))
  const nativeLineOrderIds = new Set((lineRows ?? []).map((row) => String(row.order_id)))
  const fallbackLines: OperationsLineOption[] = (orderRows ?? [])
    .filter((row) => !nativeLineOrderIds.has(String(row.id)))
    .map((row) => ({
      id: `legacy:${row.id}`,
      orderId: String(row.id),
      packageId: String(row.package_id),
      ledgerPackageId: String(row.package_id),
      description:
        one(row.packages as unknown as Array<{ name: string }> | null)?.name ??
        String(row.package_id),
      quantity: Number(row.guests),
    }))
  const lines: OperationsLineOption[] = [
    ...(lineRows ?? []).map((row) => ({
      id: String(row.id),
      orderId: String(row.order_id),
      packageId: String(row.package_id),
      ledgerPackageId: String(row.package_id),
      description: String(row.description),
      quantity: Number(row.quantity),
    })),
    ...fallbackLines,
    ...dealLines,
  ]
  let stockLayers: OperationsStockLayer[] = []
  let allocations: OperationsStockAllocation[] = []
  try {
    const stock = await loadOperationsStock(
      supabase,
      lines,
      dealLineRows
        .map((row) => row.fulfilment_cost_layer_id)
        .filter((id): id is string => Boolean(id)),
    )
    stockLayers = stock.stockLayers
    allocations = stock.allocations
    for (const line of lines) {
      line.ledgerPackageId = stock.ledgerByPackage.get(line.packageId) ?? line.packageId
    }
    const supplierById = new Map((suppliers ?? []).map((row) => [String(row.id), String(row.name)]))
    const missingSupplierIds = [
      ...new Set(
        dealLineRows
          .map((row) => row.supplier_id)
          .filter((id): id is string => Boolean(id) && !supplierById.has(String(id))),
      ),
    ]
    if (missingSupplierIds.length) {
      const extraNames = await fetchInChunks(missingSupplierIds, async (chunk) => {
        const { data } = await supabase.from("suppliers").select("id, name").in("id", chunk)
        return (data ?? []) as Array<{ id: string; name: string }>
      })
      for (const row of extraNames) supplierById.set(String(row.id), String(row.name))
    }
    const layerById = new Map(stockLayers.map((layer) => [layer.costLayerId, layer]))
    for (const row of dealLineRows) {
      const layer = row.fulfilment_cost_layer_id ? layerById.get(String(row.fulfilment_cost_layer_id)) : null
      const supplierId = row.supplier_id ? String(row.supplier_id) : layer?.supplierId ?? null
      const supplierName = layer?.supplierName || (supplierId ? supplierById.get(supplierId) : null)
      if (!supplierName && !layer) continue
      allocations.push({
        orderId: `deal:${row.deal_id}`,
        packageId: String(row.package_id),
        costLayerId: row.fulfilment_cost_layer_id ? String(row.fulfilment_cost_layer_id) : null,
        quantity: Math.max(0, Math.floor(Number(row.quantity) || 0)),
        supplierKey:
          layer?.supplierKey ??
          stockLayerKey({
            supplierId,
            source: supplierName,
            costLayerId: row.fulfilment_cost_layer_id,
          }),
        supplierName: supplierName || "Unassigned",
        supplierId,
      })
    }
    applyUnlinkedDealSalesToRemaining(
      stockLayers,
      dealLineRows.map((row) => {
        const mappedLayer = row.fulfilment_cost_layer_id
          ? layerById.get(String(row.fulfilment_cost_layer_id))
          : null
        const supplierId = row.supplier_id ? String(row.supplier_id) : mappedLayer?.supplierId ?? null
        return {
          packageId: String(row.package_id),
          costLayerId: row.fulfilment_cost_layer_id ? String(row.fulfilment_cost_layer_id) : null,
          supplierKey: mappedLayer?.supplierKey ?? (supplierId ? stockLayerKey({ supplierId }) : null),
          quantity: Math.max(0, Math.floor(Number(row.quantity) || 0)),
        }
      }),
      new Map(lines.map((line) => [line.packageId, line.ledgerPackageId])),
    )
  } catch (error) {
    console.error("[getOperationsSupportingData] stock", error)
  }

  return {
    guests: [
      ...(guestRows ?? []).map((row) => ({
        id: String(row.id),
        orderId: String(row.order_id),
        dealId: null,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        nationality: row.nationality,
        dateOfBirth: row.date_of_birth,
        dietaryRequirements: row.dietary_requirements,
        specialRequests: row.special_requests,
        isLeadGuest: Boolean(row.is_lead_guest),
        detailsComplete: Boolean(row.details_complete),
        sortOrder: Number(row.sort_order),
      })),
      ...(dealGuestRows ?? []).map((row) => ({
        id: String(row.id),
        orderId: null,
        dealId: String(row.deal_id),
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        nationality: row.nationality,
        dateOfBirth: row.date_of_birth,
        dietaryRequirements: row.dietary_requirements,
        specialRequests: row.special_requests,
        isLeadGuest: Boolean(row.is_lead_guest),
        detailsComplete: Boolean(row.details_complete),
        sortOrder: Number(row.sort_order),
      })),
    ],
    supplierRows: (supplierRows ?? []).map((row) => ({
      id: String(row.id),
      orderId: String(row.order_id),
      orderLineItemId: row.order_line_item_id,
      packageId: String(row.package_id),
      packageName:
        one(row.packages as unknown as Array<{ name: string }> | null)?.name ??
        String(row.package_id),
      supplierId: row.supplier_id,
      supplierName:
        one(row.suppliers as unknown as Array<{ name: string }> | null)?.name ?? null,
      quantity: Number(row.quantity),
      status: String(row.status),
      supplierReference: row.supplier_reference,
      expectedAt: row.expected_at,
      notes: row.notes,
    })),
    lines,
    stockLayers,
    allocations,
    suppliers: (suppliers ?? []).map((row) => ({ id: String(row.id), name: String(row.name) })),
    staff: (staff ?? []).map((row) => ({
      id: String(row.id),
      name: row.full_name || "CMS user",
    })),
    emails: (emailsResult.data ?? [])
      .filter((row): row is typeof row & { kind: OperationsEmailHistoryRow["kind"] } =>
        isOperationsEmailKind(String(row.kind)),
      )
      .map((row) => ({
        id: String(row.id),
        dealId: row.deal_id ? String(row.deal_id) : null,
        orderId: row.order_id ? String(row.order_id) : null,
        kind: row.kind,
        toEmail: String(row.to_email),
        toName: row.to_name ? String(row.to_name) : null,
        subject: String(row.subject),
        sentAt: String(row.sent_at),
        sentByName: null,
      })),
  }
}

type CmsClient = Awaited<ReturnType<typeof createClient>>

async function loadOperationsStock(
  supabase: CmsClient,
  lines: OperationsLineOption[],
  extraLayerIds: string[] = [],
): Promise<{
  stockLayers: OperationsStockLayer[]
  allocations: OperationsStockAllocation[]
  ledgerByPackage: Map<string, string>
}> {
  const packageIds = [...new Set(lines.map((line) => line.packageId).filter(Boolean))]
  const orderIds = [
    ...new Set(
      lines
        .map((line) => line.orderId)
        .filter((id): id is string => Boolean(id) && UUID_RE.test(id)),
    ),
  ]
  const ledgerByPackage = new Map(packageIds.map((id) => [id, id]))
  if (packageIds.length === 0) {
    return { stockLayers: [], allocations: [], ledgerByPackage }
  }

  const packages = await fetchInChunks(packageIds, async (chunk) => {
    const { data } = await supabase
      .from("packages")
      .select("id, inventory_group_id, duration, shell_parent_package_id")
      .in("id", chunk)
    return (data ?? []) as Array<{
      id: string
      inventory_group_id: string | null
      duration: string | null
      shell_parent_package_id: string | null
    }>
  })
  const groupIds = [
    ...new Set(packages.map((row) => row.inventory_group_id).filter((id): id is string => Boolean(id))),
  ]
  const parents =
    groupIds.length > 0
      ? await fetchInChunks(groupIds, async (chunk) => {
          const { data } = await supabase
            .from("packages")
            .select("id, inventory_group_id")
            .in("inventory_group_id", chunk)
            .eq("duration", "3_day")
            .is("shell_parent_package_id", null)
          return (data ?? []) as Array<{ id: string; inventory_group_id: string | null }>
        })
      : []
  const parentByGroup = new Map<string, string>()
  for (const parent of parents) {
    if (parent.inventory_group_id && !parentByGroup.has(parent.inventory_group_id)) {
      parentByGroup.set(parent.inventory_group_id, String(parent.id))
    }
  }

  const layerPackageIds = [
    ...new Set([...packageIds, ...parents.map((row) => String(row.id))]),
  ]
  const layerRows = await fetchInChunks(layerPackageIds, async (chunk) => {
    const { data } = await supabase
      .from("package_cost_layers")
      .select(
        "id, package_id, quantity_remaining, unit_cost, currency, source, received_at, purchase_order_id, fulfilment_block_id, supplier_id",
      )
      .in("package_id", chunk)
    return (data ?? []) as Array<{
      id: string
      package_id: string
      quantity_remaining: number
      unit_cost: number
      currency: string
      source: string | null
      received_at: string | null
      purchase_order_id: string | null
      fulfilment_block_id: string | null
      supplier_id: string | null
    }>
  })

  const remainingByPackage = new Map<string, number>()
  for (const layer of layerRows) {
    remainingByPackage.set(
      layer.package_id,
      (remainingByPackage.get(layer.package_id) ?? 0) + Math.max(0, Math.floor(Number(layer.quantity_remaining) || 0)),
    )
  }
  for (const pkg of packages) {
    const ownRemaining = remainingByPackage.get(String(pkg.id)) ?? 0
    const group = pkg.inventory_group_id?.trim()
    if (ownRemaining > 0 || !group) {
      ledgerByPackage.set(String(pkg.id), String(pkg.id))
      continue
    }
    ledgerByPackage.set(String(pkg.id), parentByGroup.get(group) ?? String(pkg.id))
  }

  const [consumptions, fulfilmentRows, operationRows] = await Promise.all([
    getConsumptionsForOrders(orderIds),
    orderIds.length
      ? fetchInChunks(orderIds, async (chunk) => {
          const { data } = await supabase
            .from("order_supplier_fulfilments")
            .select("order_id, package_id, status")
            .in("order_id", chunk)
            .in("status", ["confirmed", "tickets_received"])
          return (data ?? []) as Array<{ order_id: string; package_id: string; status: string }>
        })
      : Promise.resolve([]),
    orderIds.length
      ? fetchInChunks(orderIds, async (chunk) => {
          const { data } = await supabase
            .from("order_operations")
            .select("order_id, delivery_status")
            .in("order_id", chunk)
            .eq("delivery_status", "delivered")
          return (data ?? []) as Array<{ order_id: string; delivery_status: string }>
        })
      : Promise.resolve([]),
  ])
  const deliveredOrders = new Set(operationRows.map((row) => String(row.order_id)))
  const lockByOrderPackage = new Map<string, string>()
  for (const row of fulfilmentRows) {
    lockByOrderPackage.set(
      `${row.order_id}:${row.package_id}`,
      row.status === "tickets_received" ? "Tickets received" : "Supplier confirmed",
    )
  }
  const knownLayerIds = new Set(layerRows.map((row) => String(row.id)))
  const missingLayerIds = [
    ...new Set(
      [
        ...[...consumptions.values()].flat().map((row) => row.cost_layer_id),
        ...extraLayerIds,
      ]
        .filter((id): id is string => typeof id === "string" && id.length > 0)
        .filter((id) => !knownLayerIds.has(id)),
    ),
  ]
  if (missingLayerIds.length > 0) {
    const extra = await fetchInChunks(missingLayerIds, async (chunk) => {
      const { data } = await supabase
        .from("package_cost_layers")
        .select(
          "id, package_id, quantity_remaining, unit_cost, currency, source, received_at, purchase_order_id, fulfilment_block_id, supplier_id",
        )
        .in("id", chunk)
      return (data ?? []) as typeof layerRows
    })
    layerRows.push(...extra)
  }

  const poIds = [
    ...new Set(layerRows.map((row) => row.purchase_order_id).filter((id): id is string => Boolean(id))),
  ]
  const supplierIds = [
    ...new Set(layerRows.map((row) => row.supplier_id).filter((id): id is string => Boolean(id))),
  ]
  const [pos, supplierNames] = await Promise.all([
    poIds.length
      ? fetchInChunks(poIds, async (chunk) => {
          const { data } = await supabase
            .from("purchase_orders")
            .select("id, po_number, supplier, supplier_id")
            .in("id", chunk)
          return (data ?? []) as Array<{
            id: string
            po_number: string | null
            supplier: string | null
            supplier_id: string | null
          }>
        })
      : Promise.resolve([]),
    supplierIds.length
      ? fetchInChunks(supplierIds, async (chunk) => {
          const { data } = await supabase.from("suppliers").select("id, name").in("id", chunk)
          return (data ?? []) as Array<{ id: string; name: string }>
        })
      : Promise.resolve([]),
  ])
  const poById = new Map(pos.map((row) => [String(row.id), row]))
  const supplierById = new Map(supplierNames.map((row) => [String(row.id), String(row.name)]))

  const stockLayers: OperationsStockLayer[] = layerRows.map((row) => {
    const po = row.purchase_order_id ? poById.get(row.purchase_order_id) : null
    const supplierId = po?.supplier_id ?? row.supplier_id ?? null
    const supplierName =
      (supplierId ? supplierById.get(supplierId) : null) ||
      po?.supplier?.trim() ||
      row.source?.trim() ||
      "Unassigned"
    return {
      costLayerId: String(row.id),
      packageId: String(row.package_id),
      supplierId,
      supplierName,
      supplierKey: stockLayerKey({
        supplierId,
        source: po?.supplier || row.source,
        costLayerId: String(row.id),
      }),
      remaining: Math.max(0, Math.floor(Number(row.quantity_remaining) || 0)),
      unitCost: Number(row.unit_cost) || 0,
      currency: String(row.currency || "USD"),
      source: row.source,
      purchaseOrderId: row.purchase_order_id,
      fulfilmentBlockId: row.fulfilment_block_id,
      receivedAt: row.received_at,
    }
  })
  const layerById = new Map(stockLayers.map((layer) => [layer.costLayerId, layer]))

  const allocations: OperationsStockAllocation[] = []
  for (const [orderId, rows] of consumptions) {
    for (const row of rows) {
      const layer = row.cost_layer_id ? layerById.get(row.cost_layer_id) : null
      allocations.push({
        orderId,
        packageId: String(row.package_id),
        costLayerId: row.cost_layer_id,
        quantity: Math.max(0, Math.floor(Number(row.quantity) || 0)),
        supplierKey:
          layer?.supplierKey ??
          stockLayerKey({
            source: row.supplier_source_snapshot,
            costLayerId: row.cost_layer_id,
          }),
        supplierName: layer?.supplierName || row.supplier_source_snapshot || "Unassigned",
        supplierId: layer?.supplierId ?? null,
        locked:
          deliveredOrders.has(orderId) ||
          lockByOrderPackage.has(`${orderId}:${String(row.package_id)}`),
        lockReason:
          deliveredOrders.has(orderId)
            ? "Delivered"
            : lockByOrderPackage.get(`${orderId}:${String(row.package_id)}`) ?? null,
      })
    }
  }

  return { stockLayers, allocations, ledgerByPackage }
}

