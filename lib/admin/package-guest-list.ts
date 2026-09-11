import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { adminDealPath, adminOrderDealPath } from "@/lib/admin/deal-link"
import type { CostLayerRow } from "@/lib/admin/cost-layers"
import type { PurchaseOrderRow } from "@/lib/admin/purchase-orders"
import {
  assignSuppliersAcrossDays,
  expandBookingGuestSeats,
  guestListDayChips,
  guestListDayRank,
  parseGuestTicketStatus,
  type GuestListGuestRecord,
  type GuestListSupplierSlice,
  type PackageGuestListData,
  type PackageGuestListSeat,
} from "@/lib/admin/package-guest-list-model"
import { costDaySlotsForDuration } from "@/lib/inventory/day-cost-allocation"
import { resolveGuestAttendanceMode } from "@/lib/guest-details/model"
import { dealStageCountsAsSold, type PackageDealSaleRow } from "@/lib/crm/deal-types"
import type { AdminOrderListRow } from "@/lib/orders/queries"
import { orderPartyPrimary } from "@/lib/orders/channel"

export type { PackageGuestListData, PackageGuestListSeat } from "@/lib/admin/package-guest-list-model"

type PackageMeta = {
  id: string
  name: string
  duration: string | null
}

type BookingOps = {
  deliveryMethod: string
  collectionPoint: string
  collectionTime: string
  contactOnSite: string
  internalNotes: string
  supplierDetailsSentAt: string | null
  notesUpdatedAt: string | null
  notesUpdatedById: string | null
  attendanceMode: "same" | "per_day"
}

const GUEST_COLUMNS =
  "id, full_name, email, phone, nationality, date_of_birth, dietary_requirements, special_requests, is_lead_guest, table_number, ticket_number, paddock_tour, ticket_status, sort_order, attendance_day, headshot_path" as const
const GUEST_COLUMNS_BARE =
  "id, full_name, email, phone, nationality, date_of_birth, dietary_requirements, special_requests, is_lead_guest, sort_order, attendance_day, headshot_path" as const
const GUEST_COLUMNS_MIN =
  "id, full_name, email, phone, sort_order" as const
const ORDER_OPS_COLUMNS =
  "order_id, delivery_method, collection_point, collection_time, contact_on_site, internal_notes, supplier_details_sent_at, guest_attendance_mode, updated_at, updated_by" as const
const ORDER_OPS_BARE = "order_id, internal_notes, updated_at, updated_by" as const
const DEAL_OPS_COLUMNS =
  "deal_id, delivery_method, collection_point, collection_time, contact_on_site, internal_notes, supplier_details_sent_at, guest_attendance_mode, updated_at, updated_by" as const
const DEAL_OPS_BARE = "deal_id, updated_at, updated_by" as const

function blank(value: string | null | undefined): string {
  return value?.trim() ?? ""
}

function mapGuestRow(row: {
  id: string
  full_name?: string | null
  email?: string | null
  phone?: string | null
  nationality?: string | null
  date_of_birth?: string | null
  dietary_requirements?: string | null
  special_requests?: string | null
  is_lead_guest?: boolean | null
  table_number?: string | null
  ticket_number?: string | null
  paddock_tour?: string | null
  ticket_status?: string | null
  sort_order?: number | null
  attendance_day?: string | null
  headshot_path?: string | null
}): GuestListGuestRecord {
  return {
    id: row.id,
    fullName: blank(row.full_name) || null,
    email: blank(row.email) || null,
    phone: blank(row.phone) || null,
    nationality: blank(row.nationality) || null,
    dateOfBirth: blank(row.date_of_birth) || null,
    dietaryRequirements: blank(row.dietary_requirements) || null,
    specialRequests: blank(row.special_requests) || null,
    isLeadGuest: Boolean(row.is_lead_guest),
    tableNumber: blank(row.table_number) || null,
    ticketNumber: blank(row.ticket_number) || null,
    paddockTour: blank(row.paddock_tour) || null,
    ticketStatus: parseGuestTicketStatus(row.ticket_status),
    sortOrder: Math.max(0, Math.floor(Number(row.sort_order) || 0)),
    attendanceDay: blank(row.attendance_day) || null,
    headshotPath: blank(row.headshot_path) || null,
  }
}

function emptyOps(): BookingOps {
  return {
    deliveryMethod: "",
    collectionPoint: "",
    collectionTime: "",
    contactOnSite: "",
    internalNotes: "",
    supplierDetailsSentAt: null,
    notesUpdatedAt: null,
    notesUpdatedById: null,
    attendanceMode: "same" as const,
  }
}

function mapOps(row: Record<string, unknown> | null | undefined): BookingOps {
  if (!row) return emptyOps()
  return {
    deliveryMethod: blank(typeof row.delivery_method === "string" ? row.delivery_method : null),
    collectionPoint: blank(typeof row.collection_point === "string" ? row.collection_point : null),
    collectionTime: blank(typeof row.collection_time === "string" ? row.collection_time : null),
    contactOnSite: blank(typeof row.contact_on_site === "string" ? row.contact_on_site : null),
    internalNotes: blank(typeof row.internal_notes === "string" ? row.internal_notes : null),
    supplierDetailsSentAt: typeof row.supplier_details_sent_at === "string" ? row.supplier_details_sent_at : null,
    notesUpdatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    notesUpdatedById: typeof row.updated_by === "string" ? row.updated_by : null,
    attendanceMode: row.guest_attendance_mode === "per_day" ? "per_day" : "same",
  }
}

export async function getPackageGuestList(input: {
  deals: PackageDealSaleRow[]
  orders: AdminOrderListRow[]
  packages: PackageMeta[]
  eventDate: string | null
  purchaseOrders?: PurchaseOrderRow[]
  costLayers?: CostLayerRow[]
}): Promise<PackageGuestListData> {
  noStore()
  const days = guestListDayChips(
    input.eventDate,
    input.packages.map((pkg) => pkg.duration),
  )
  const soldDeals = input.deals.filter((deal) => dealStageCountsAsSold(deal.stage))
  const liveOrders = input.orders.filter((order) => order.status !== "cancelled")
  const dealIds = soldDeals.map((deal) => deal.id)
  const orderIds = [
    ...new Set(
      [
        ...soldDeals.map((deal) => deal.orderId).filter((id): id is string => Boolean(id)),
        ...liveOrders.map((order) => order.id),
      ],
    ),
  ]
  const dealLineIds = soldDeals.flatMap((deal) => deal.lines.map((line) => line.id))
  const coveredOrderIds = new Set(soldDeals.map((deal) => deal.orderId).filter(Boolean))
  const packageById = new Map(input.packages.map((pkg) => [pkg.id, pkg]))
  const poById = new Map((input.purchaseOrders ?? []).map((po) => [po.id, po]))
  const layerById = new Map((input.costLayers ?? []).map((layer) => [layer.id, layer]))

  const supabase = await createClient()

  const [orderGuests, dealGuests, orderOps, dealOps, allocations, staff] = await Promise.all([
    loadGuests(supabase, "order_guests", "order_id", orderIds),
    loadGuests(supabase, "deal_guests", "deal_id", dealIds),
    loadOrderOps(supabase, orderIds),
    loadDealOps(supabase, dealIds),
    loadAllocations(supabase, dealLineIds),
    loadStaffNames(supabase),
  ])

  const seats: PackageGuestListSeat[] = []

  for (const deal of soldDeals) {
    const ops = (deal.orderId ? orderOps.get(deal.orderId) : null) ?? dealOps.get(deal.id) ?? emptyOps()
    const guests = deal.orderId && (orderGuests.get(deal.orderId)?.length ?? 0) > 0
      ? orderGuests.get(deal.orderId) ?? []
      : dealGuests.get(deal.id) ?? []
    const clientName = blank(deal.accountName) || blank(deal.contactName) || "—"
    const orderNumber = blank(deal.orderReference) || deal.reference
    const href = adminDealPath(deal.id)
    const mode = resolveGuestAttendanceMode(ops.attendanceMode, guests)
    let guestOffset = 0
    for (const line of deal.lines) {
      const lineStart = guestOffset
      guestOffset += line.quantity
      if (!packageById.has(line.packageId)) continue
      const lineGuests =
        mode === "per_day"
          ? guests.filter((guest) => guest.sortOrder >= lineStart && guest.sortOrder < lineStart + line.quantity)
          : guests.slice(lineStart, lineStart + line.quantity)
      const pkg = packageById.get(line.packageId)
      const daySlots = costDaySlotsForDuration(pkg?.duration ?? null, input.eventDate)
      const slices = supplierSlicesForLine(line, allocations.get(line.id) ?? [], layerById, poById)
      const expanded = assignSuppliersAcrossDays(
        expandBookingGuestSeats({
          quantity: line.quantity,
          daySlots,
          guests: lineGuests,
          mode: daySlots.length > 1 ? mode : "same",
        }),
        slices,
      )
      for (const seat of expanded) {
        const dayKey = seat.daySlots[0] ?? "all"
        seats.push(
          toSeat({
            id: seat.guest
              ? `${seat.guest.id}:${dayKey}`
              : `placeholder:${deal.id}:${line.id}:${dayKey}:${seat.slotIndex}`,
            guest: seat.guest,
            orderId: deal.orderId,
            dealId: deal.id,
            packageId: line.packageId,
            daySlots: seat.daySlots,
            slotIndex: mode === "per_day" ? seat.slotIndex : lineStart + seat.slotIndex,
            clientName,
            clientAccountId: deal.accountId,
            orderNumber,
            dealHref: href,
            supplierName: seat.supplierName,
            supplierDeadline: seat.supplierDeadline,
            ops,
            notesUpdatedBy: staff.get(ops.notesUpdatedById ?? "") ?? null,
            bookingQuantity: line.quantity,
          }),
        )
      }
    }
  }

  for (const order of liveOrders) {
    if (coveredOrderIds.has(order.id)) continue
    if (!packageById.has(order.package_id)) continue
    const pkg = packageById.get(order.package_id)
    const daySlots = costDaySlotsForDuration(pkg?.duration ?? order.packages?.duration ?? null, input.eventDate)
    const ops = orderOps.get(order.id) ?? emptyOps()
    const guests = orderGuests.get(order.id) ?? []
    const mode = resolveGuestAttendanceMode(ops.attendanceMode, guests)
    const slices: GuestListSupplierSlice[] = order.supplierAllocations.map((allocation) => ({
      name: allocation.supplier,
      quantity: allocation.quantity,
      deadline: deadlineForSupplierName(allocation.supplier, input.costLayers ?? [], poById),
    }))
    const expanded = assignSuppliersAcrossDays(
      expandBookingGuestSeats({
        quantity: order.guests,
        daySlots,
        guests,
        mode: daySlots.length > 1 ? mode : "same",
      }),
      slices,
    )
    const href = adminOrderDealPath(order.deal_id)
    for (const seat of expanded) {
      const dayKey = seat.daySlots[0] ?? "all"
      seats.push(
        toSeat({
          id: seat.guest ? `${seat.guest.id}:${dayKey}` : `placeholder:order:${order.id}:${dayKey}:${seat.slotIndex}`,
          guest: seat.guest,
          orderId: order.id,
          dealId: order.deal_id,
          packageId: order.package_id,
          daySlots: seat.daySlots,
          slotIndex: seat.slotIndex,
          clientName: orderPartyPrimary({
            agentCompany: order.agent?.company_name,
            agentName: order.agent?.full_name,
            accountName: order.account?.name,
            contactName: order.contact?.full_name,
            clientName: order.client_name,
          }) || "—",
          clientAccountId: order.account?.id ?? order.crm_account_id ?? null,
          orderNumber: order.reference,
          dealHref: href,
          supplierName: seat.supplierName,
          supplierDeadline: seat.supplierDeadline,
          ops,
          notesUpdatedBy: staff.get(ops.notesUpdatedById ?? "") ?? null,
          bookingQuantity: order.guests,
        }),
      )
    }
  }

  seats.sort((a, b) => {
    const client = a.clientName.localeCompare(b.clientName, undefined, { sensitivity: "base" })
    if (client !== 0) return client
    const order = a.orderNumber.localeCompare(b.orderNumber, undefined, { sensitivity: "base" })
    if (order !== 0) return order
    const day = guestListDayRank(a.daySlots[0]) - guestListDayRank(b.daySlots[0])
    if (day !== 0) return day
    if (a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex
    return (a.guestName ?? "").localeCompare(b.guestName ?? "", undefined, { sensitivity: "base" })
  })

  return { days, seats }
}

function toSeat(input: {
  id: string
  guest: GuestListGuestRecord | null
  orderId: string | null
  dealId: string | null
  packageId: string
  daySlots: string[]
  slotIndex: number
  clientName: string
  clientAccountId: string | null
  orderNumber: string
  dealHref: string | null
  supplierName: string | null
  supplierDeadline: string | null
  ops: BookingOps
  notesUpdatedBy: string | null
  bookingQuantity: number
}): PackageGuestListSeat {
  return {
    id: input.id,
    guestId: input.guest?.id ?? null,
    orderId: input.orderId,
    dealId: input.dealId,
    packageId: input.packageId,
    daySlots: input.daySlots,
    slotIndex: input.slotIndex,
    guestName: input.guest?.fullName ?? null,
    email: input.guest?.email ?? null,
    phone: input.guest?.phone ?? null,
    clientName: input.clientName,
    clientAccountId: input.clientAccountId,
    orderNumber: input.orderNumber,
    dealHref: input.dealHref,
    tableNumber: input.guest?.tableNumber ?? "",
    ticketNumber: input.guest?.ticketNumber ?? "",
    paddockTour: input.guest?.paddockTour ?? "",
    supplierName: input.supplierName,
    supplierDeadline: input.supplierDeadline,
    supplierDetailsSentAt: input.ops.supplierDetailsSentAt,
    ticketStatus: input.guest?.ticketStatus ?? "pending",
    deliveryMethod: input.ops.deliveryMethod,
    collectionPoint: input.ops.collectionPoint,
    collectionTime: input.ops.collectionTime,
    contactOnSite: input.ops.contactOnSite,
    internalNotes: input.ops.internalNotes,
    notesUpdatedAt: input.ops.notesUpdatedAt,
    notesUpdatedBy: input.notesUpdatedBy,
    bookingQuantity: input.bookingQuantity,
    nationality: input.guest?.nationality ?? null,
    dateOfBirth: input.guest?.dateOfBirth ?? null,
    dietaryRequirements: input.guest?.dietaryRequirements ?? null,
    specialRequests: input.guest?.specialRequests ?? null,
    isLeadGuest: Boolean(input.guest?.isLeadGuest),
    attendanceDay:
      input.guest?.attendanceDay ?? (input.daySlots.length === 1 ? input.daySlots[0] ?? null : null),
    headshotPath: input.guest?.headshotPath ?? null,
  }
}

function supplierSlicesForLine(
  line: PackageDealSaleRow["lines"][number],
  allocations: Array<{ costLayerId: string | null; quantity: number }>,
  layerById: Map<string, CostLayerRow>,
  poById: Map<string, PurchaseOrderRow>,
): GuestListSupplierSlice[] {
  if (allocations.length > 0) {
    return allocations.map((allocation) => {
      const layer = allocation.costLayerId ? layerById.get(allocation.costLayerId) : null
      const po = layer?.purchase_order_id ? poById.get(layer.purchase_order_id) : null
      return {
        name: po?.supplier || layer?.source || line.supplierName,
        quantity: allocation.quantity,
        deadline: po?.guest_details_deadline ?? null,
      }
    })
  }
  if (line.supplierAllocations.length > 0) {
    return line.supplierAllocations.map((allocation) => ({
      name: allocation.name,
      quantity: allocation.quantity,
      deadline: line.costLayerId
        ? poById.get(layerById.get(line.costLayerId)?.purchase_order_id ?? "")?.guest_details_deadline ?? null
        : null,
    }))
  }
  if (line.supplierName) {
    return [{ name: line.supplierName, quantity: line.quantity, deadline: null }]
  }
  return []
}

function deadlineForSupplierName(
  supplier: string,
  layers: CostLayerRow[],
  poById: Map<string, PurchaseOrderRow>,
): string | null {
  const needle = supplier.trim().toLowerCase()
  if (!needle) return null
  for (const layer of layers) {
    const po = layer.purchase_order_id ? poById.get(layer.purchase_order_id) : null
    const name = (po?.supplier || layer.source || "").trim().toLowerCase()
    if (name === needle) return po?.guest_details_deadline ?? null
  }
  return null
}

async function loadGuests(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: "order_guests" | "deal_guests",
  parent: "order_id" | "deal_id",
  ids: string[],
): Promise<Map<string, GuestListGuestRecord[]>> {
  const out = new Map<string, GuestListGuestRecord[]>()
  if (ids.length === 0) return out
  const selectParent = `${parent}, ${GUEST_COLUMNS}`
  const bareParent = `${parent}, ${GUEST_COLUMNS_BARE}`
  const minParent = `${parent}, ${GUEST_COLUMNS_MIN}`
  let data: unknown[] | null = null
  const full = await supabase.from(table).select(selectParent).in(parent, ids).order("sort_order")
  if (!full.error && full.data) data = full.data
  else {
    const bare = await supabase.from(table).select(bareParent).in(parent, ids).order("sort_order")
    if (!bare.error && bare.data) data = bare.data
    else {
      const min = await supabase.from(table).select(minParent).in(parent, ids).order("sort_order")
      if (!min.error && min.data) data = min.data
    }
  }
  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown> & { id: string }
    const parentId = String(row[parent] ?? "")
    if (!parentId) continue
    const list = out.get(parentId) ?? []
    list.push(mapGuestRow(row))
    out.set(parentId, list)
  }
  return out
}

async function loadOrderOps(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<Map<string, BookingOps>> {
  const out = new Map<string, BookingOps>()
  if (ids.length === 0) return out
  let data: unknown[] | null = null
  const full = await supabase.from("order_operations").select(ORDER_OPS_COLUMNS).in("order_id", ids)
  if (!full.error && full.data) data = full.data
  else {
    const bare = await supabase.from("order_operations").select(ORDER_OPS_BARE).in("order_id", ids)
    if (!bare.error && bare.data) data = bare.data
  }
  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown> & { order_id: string }
    out.set(row.order_id, mapOps(row))
  }
  return out
}

async function loadDealOps(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<Map<string, BookingOps>> {
  const out = new Map<string, BookingOps>()
  if (ids.length === 0) return out
  let data: unknown[] | null = null
  const full = await supabase.from("deal_operations").select(DEAL_OPS_COLUMNS).in("deal_id", ids)
  if (!full.error && full.data) data = full.data
  else {
    const bare = await supabase.from("deal_operations").select(DEAL_OPS_BARE).in("deal_id", ids)
    if (!bare.error && bare.data) data = bare.data
  }
  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown> & { deal_id: string }
    out.set(row.deal_id, mapOps(row))
  }
  return out
}

async function loadAllocations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lineIds: string[],
): Promise<Map<string, Array<{ costLayerId: string | null; quantity: number }>>> {
  const out = new Map<string, Array<{ costLayerId: string | null; quantity: number }>>()
  if (lineIds.length === 0) return out
  const { data } = await supabase
    .from("inventory_allocations")
    .select("deal_line_item_id, cost_layer_id, quantity")
    .in("deal_line_item_id", lineIds)
    .in("state", ["reserved", "committed"])
  for (const raw of data ?? []) {
    const row = raw as { deal_line_item_id: string; cost_layer_id: string | null; quantity: number }
    const list = out.get(row.deal_line_item_id) ?? []
    list.push({
      costLayerId: row.cost_layer_id,
      quantity: Math.max(0, Math.floor(Number(row.quantity) || 0)),
    })
    out.set(row.deal_line_item_id, list)
  }
  return out
}

async function loadStaffNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("role", ["admin", "finance", "sales"])
  return new Map(
    (data ?? []).map((row) => [String((row as { id: string }).id), String((row as { full_name: string | null }).full_name ?? "").trim()]),
  )
}
