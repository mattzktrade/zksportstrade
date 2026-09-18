import { unstable_noStore as noStore } from "next/cache"
import { loadOperationsCalendarEntries } from "@/app/(admin)/admin/operations/calendar-actions"
import { getNegativeStockRows } from "@/lib/admin/negative-stock-query"
import {
  buildOperationsDashboardView,
  type OperationsDashboardBookingInput,
  type OperationsDashboardModel,
  type OperationsDashboardPurchaseOrderInput,
  type OperationsDashboardRaceInput,
} from "@/lib/admin/operations-dashboard-metrics"
import { getPurchaseOrdersWithMeta } from "@/lib/admin/purchase-orders"
import { calendarTodayIso } from "@/lib/admin/purchase-order-payment"
import { getOperationsWorkflowRows } from "@/lib/admin/workflow-views"
import { officialCircuitNameForRaceId, isMissingRaceCircuitColumnError } from "@/lib/catalog/race-circuit"
import { bookingStepInput } from "@/lib/operations/booking-view"
import { createClient } from "@/lib/supabase/server"

function toBookingInput(
  row: Awaited<ReturnType<typeof getOperationsWorkflowRows>>[number],
): OperationsDashboardBookingInput {
  const step = bookingStepInput(row, [])
  return {
    ...step,
    id: row.id,
    accountName: row.accountName,
    eventPackage: row.eventPackage,
    dealId: row.dealId,
    collectionPoint: row.collectionPoint,
    collectionTime: row.collectionTime,
    purchaseOrderIds: row.purchaseOrders.map((po) => po.id),
    reference: row.reference,
    xeroInvoiceNumber: row.xeroInvoiceNumber,
    total: row.total,
    currency: row.currency,
    amountDue: row.amountDue,
    overdueSince: row.overdueSince,
  }
}

function toPurchaseOrderInput(
  po: Awaited<ReturnType<typeof getPurchaseOrdersWithMeta>>[number],
): OperationsDashboardPurchaseOrderInput {
  return {
    id: po.id,
    po_number: po.po_number,
    supplier: po.supplier,
    guest_details_deadline: po.guest_details_deadline,
    tickets_received_at: po.tickets_received_at,
    payment_due_date: po.payment_due_date,
    paid_at: po.paid_at,
    note: po.note,
    usage: {
      lines: po.usage.lines.map((line) => ({
        packageName: line.packageName,
        eventName: line.eventName,
        quantityPurchased: line.quantityPurchased,
        unitCost: line.unitCost,
        currency: line.currency,
      })),
    },
  }
}

async function loadUpcomingRaces(): Promise<OperationsDashboardRaceInput[]> {
  const supabase = await createClient()
  const withCircuit =
    "id, name, short_name, circuit, location, country, country_code, event_date, date_range, is_archived"
  const withoutCircuit =
    "id, name, short_name, location, country, country_code, event_date, date_range, is_archived"
  let { data, error } = await supabase.from("races").select(withCircuit).order("event_date")
  if (error && isMissingRaceCircuitColumnError(error.message)) {
    const retry = await supabase.from("races").select(withoutCircuit).order("event_date")
    data = (retry.data ?? []).map((row) => ({ ...row, circuit: null }))
    error = retry.error
  }
  if (error || !data) return []
  return data.flatMap((row) => {
    if (row.is_archived) return []
    const id = String(row.id)
    const circuit =
      String((row as { circuit?: string | null }).circuit ?? "").trim() ||
      officialCircuitNameForRaceId(id) ||
      String(row.location ?? "").trim()
    return [
      {
        id,
        name: String(row.name ?? ""),
        shortName: row.short_name ? String(row.short_name) : null,
        circuit,
        dateRange: String(row.date_range ?? "").trim(),
        eventDate: String(row.event_date).slice(0, 10),
        countryCode: String(row.country_code ?? ""),
      },
    ]
  })
}

export async function getOperationsDashboardModel(): Promise<OperationsDashboardModel> {
  noStore()
  const [bookings, calendarEntries, purchaseOrders, negativeStock, races] = await Promise.all([
    getOperationsWorkflowRows(),
    loadOperationsCalendarEntries(),
    getPurchaseOrdersWithMeta(),
    getNegativeStockRows(),
    loadUpcomingRaces(),
  ])

  return buildOperationsDashboardView({
    todayIso: calendarTodayIso(),
    bookings: bookings.map(toBookingInput),
    calendarEntries,
    purchaseOrders: purchaseOrders.map(toPurchaseOrderInput),
    negativeStock: negativeStock.map((row) => ({
      id: row.id,
      packageId: row.packageId,
      packageName: row.packageName,
      quantity: row.quantity,
      eventDate: row.eventDate,
    })),
    races,
  })
}
