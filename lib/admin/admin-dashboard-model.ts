import { unstable_noStore as noStore } from "next/cache"
import { bookingFormsAwaitingApprovalHref } from "@/lib/admin/deal-link"
import { getNegativeStockRows } from "@/lib/admin/negative-stock-query"
import { countPurchaseOrdersAwaitingBuyPrice } from "@/lib/admin/purchase-orders"
import { getDashboardSaleRows, dashboardSalesSince } from "@/lib/admin/dashboard-sales"
import { countPendingBookingApprovalRequests } from "@/lib/booking-approval/queries"
import { listNativeBookingFormsAwaitingApprovalDealIds } from "@/lib/booking-forms/queries"
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows"
import { createClient } from "@/lib/supabase/server"
import {
  buildAdminDashboardView,
  type AdminDashboardModel,
  type DashboardPipelineDeal,
} from "@/lib/admin/admin-dashboard-metrics"
import { isOpenSourcingStage } from "@/lib/crm/sourcing-notifications"

type DealPipelineRow = {
  stage: string
  total_amount: number | string | null
  currency: string | null
}

async function countSourcingRequired(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<number> {
  try {
    const result = await fetchAllRows<{ stage: string; enquiry_stage: string | null }>((from, to) =>
      supabase
        .from("deals")
        .select("stage, enquiry_stage")
        .in("stage", ["draft", "sourcing", "proposal"])
        .order("id")
        .range(from, to),
    )
    if (result.error) return 0
    return (result.data ?? []).filter((deal) => isOpenSourcingStage(deal, "sourcing_required")).length
  } catch {
    return 0
  }
}

export async function getAdminDashboardModel(): Promise<AdminDashboardModel> {
  noStore()
  const supabase = await createClient()
  const [
    { count: pendingUsers },
    { count: activeHolds },
    paddockRequests,
    bookingFormDealIds,
    negativeStockRows,
    purchaseOrdersAwaitingBuyPrice,
    workflowRows,
    pipelineResult,
    sourcingRequired,
  ] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
    supabase.from("inventory_holds").select("*", { count: "exact", head: true }).is("released_at", null),
    countPendingBookingApprovalRequests(),
    listNativeBookingFormsAwaitingApprovalDealIds(),
    getNegativeStockRows(),
    countPurchaseOrdersAwaitingBuyPrice(),
    getDashboardSaleRows(dashboardSalesSince().toISOString()),
    fetchAllRows<DealPipelineRow>((from, to) =>
      supabase
        .from("deals")
        .select("stage, total_amount, currency")
        .not("stage", "in", "(cancelled,closed_lost)")
        .order("id")
        .range(from, to),
    ),
    countSourcingRequired(supabase),
  ])

  const pipelineDeals: DashboardPipelineDeal[] = (pipelineResult.data ?? []).map((deal) => ({
    stage: deal.stage,
    total_amount: Number(deal.total_amount ?? 0),
    currency: deal.currency || "GBP",
  }))

  return buildAdminDashboardView({
    pendingUsers: pendingUsers ?? 0,
    paddockRequests,
    bookingFormsAwaiting: bookingFormDealIds.length,
    bookingFormsHref: bookingFormsAwaitingApprovalHref(bookingFormDealIds),
    negativeStock: negativeStockRows.length,
    purchaseOrdersAwaitingBuyPrice,
    sourcingRequired,
    activeHolds: activeHolds ?? 0,
    workflowRows,
    pipelineDeals,
  })
}
