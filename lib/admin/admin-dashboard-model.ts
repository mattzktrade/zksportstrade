import { cache } from "react"
import { unstable_noStore as noStore } from "next/cache"
import { bookingFormsAwaitingApprovalHref } from "@/lib/admin/deal-link"
import { countNegativeStockItems } from "@/lib/admin/negative-stock-query"
import { countPurchaseOrdersAwaitingBuyPrice } from "@/lib/admin/purchase-orders"
import { getDashboardSaleRows, dashboardSalesSince } from "@/lib/admin/dashboard-sales"
import { countPendingBookingApprovalRequests } from "@/lib/booking-approval/queries"
import { listNativeBookingFormsAwaitingApprovalDealIds } from "@/lib/booking-forms/queries"
import { ENQUIRY_PIPELINE_STAGES } from "@/lib/crm/deal-pipeline"
import { ADMIN_READ_TTL_MS, rememberTtl } from "@/lib/server/ttl-cache"
import { createClient } from "@/lib/supabase/server"
import {
  buildAdminDashboardView,
  type AdminDashboardModel,
} from "@/lib/admin/admin-dashboard-metrics"

export type AdminDashboardCounts = {
  pendingUsers: number
  paddockRequests: number
  bookingFormsAwaiting: number
  bookingFormsHref: string
  negativeStock: number
  purchaseOrdersAwaitingBuyPrice: number
  sourcingRequired: number
  activeHolds: number
}

const EMPTY_COUNTS: AdminDashboardCounts = {
  pendingUsers: 0,
  paddockRequests: 0,
  bookingFormsAwaiting: 0,
  bookingFormsHref: "/admin/deals",
  negativeStock: 0,
  purchaseOrdersAwaitingBuyPrice: 0,
  sourcingRequired: 0,
  activeHolds: 0,
}

async function countSourcingRequired(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<number> {
  try {
    const [tagged, legacy] = await Promise.all([
      supabase
        .from("deals")
        .select("id", { count: "exact", head: true })
        .in("stage", [...ENQUIRY_PIPELINE_STAGES])
        .eq("enquiry_stage", "sourcing_required"),
      supabase
        .from("deals")
        .select("id", { count: "exact", head: true })
        .eq("stage", "sourcing")
        .is("enquiry_stage", null),
    ])
    return (tagged.count ?? 0) + (legacy.count ?? 0)
  } catch {
    return 0
  }
}

async function loadAdminDashboardCounts(): Promise<AdminDashboardCounts> {
  const supabase = await createClient()
  const [
    { count: pendingUsers },
    { count: activeHolds },
    paddockRequests,
    bookingFormDealIds,
    negativeStock,
    purchaseOrdersAwaitingBuyPrice,
    sourcingRequired,
  ] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
    supabase.from("inventory_holds").select("*", { count: "exact", head: true }).is("released_at", null),
    countPendingBookingApprovalRequests(),
    listNativeBookingFormsAwaitingApprovalDealIds(),
    countNegativeStockItems(),
    countPurchaseOrdersAwaitingBuyPrice(),
    countSourcingRequired(supabase),
  ])

  return {
    pendingUsers: pendingUsers ?? 0,
    paddockRequests,
    bookingFormsAwaiting: bookingFormDealIds.length,
    bookingFormsHref: bookingFormsAwaitingApprovalHref(bookingFormDealIds),
    negativeStock,
    purchaseOrdersAwaitingBuyPrice,
    sourcingRequired,
    activeHolds: activeHolds ?? 0,
  }
}

export const getAdminDashboardCounts = cache(async (): Promise<AdminDashboardCounts> => {
  noStore()
  return rememberTtl("admin-dashboard-counts", ADMIN_READ_TTL_MS, loadAdminDashboardCounts)
})

export const getAdminDashboardSalesModel = cache(async (): Promise<AdminDashboardModel> => {
  noStore()
  return rememberTtl("admin-dashboard-sales", ADMIN_READ_TTL_MS, async () => {
    const workflowRows = await getDashboardSaleRows(dashboardSalesSince().toISOString())
    return buildAdminDashboardView({
      ...EMPTY_COUNTS,
      workflowRows,
      pipelineDeals: [],
    })
  })
})

export async function getAdminDashboardModel(): Promise<AdminDashboardModel> {
  const [counts, sales] = await Promise.all([getAdminDashboardCounts(), getAdminDashboardSalesModel()])
  return {
    ...sales,
    pendingUsers: counts.pendingUsers,
    paddockRequests: counts.paddockRequests,
    bookingFormsAwaiting: counts.bookingFormsAwaiting,
    bookingFormsHref: counts.bookingFormsHref,
    negativeStock: counts.negativeStock,
    purchaseOrdersAwaitingBuyPrice: counts.purchaseOrdersAwaitingBuyPrice,
    sourcingRequired: counts.sourcingRequired,
    activeHolds: counts.activeHolds,
  }
}
