import { unstable_noStore as noStore } from "next/cache"
import { bookingFormsAwaitingApprovalHref } from "@/lib/admin/deal-link"
import { getNegativeStockRows } from "@/lib/admin/negative-stock-query"
import { getFinanceWorkflowRows } from "@/lib/admin/workflow-views"
import { countPendingBookingApprovalRequests } from "@/lib/booking-approval/queries"
import { listNativeBookingFormsAwaitingApprovalDealIds } from "@/lib/booking-forms/queries"
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows"
import { createClient } from "@/lib/supabase/server"
import {
  buildAdminDashboardView,
  type AdminDashboardModel,
  type DashboardPipelineDeal,
  type DashboardSaleRow,
} from "@/lib/admin/admin-dashboard-metrics"

type DealPipelineRow = {
  stage: string
  total_amount: number | string | null
  currency: string | null
}

function toSaleRow(
  row: Awaited<ReturnType<typeof getFinanceWorkflowRows>>[number],
): DashboardSaleRow & { grossProfit?: number | null } {
  return {
    id: row.id,
    dealId: row.dealId,
    reference: row.reference,
    dealReference: row.dealReference,
    accountName: row.accountName,
    eventPackage: row.eventPackage,
    total: row.total,
    currency: row.currency,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    ownerName: row.ownerName,
    orderStatus: row.orderStatus,
    invoiceStatus: row.invoiceStatus,
    dealStage: row.dealStage,
    fulfilmentStatus: row.fulfilmentStatus,
    overdueSince: row.overdueSince,
    amountDue: row.amountDue,
    grossProfit: row.grossProfit,
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
    workflowRows,
    pipelineResult,
  ] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
    supabase.from("inventory_holds").select("*", { count: "exact", head: true }).is("released_at", null),
    countPendingBookingApprovalRequests(),
    listNativeBookingFormsAwaitingApprovalDealIds(),
    getNegativeStockRows(),
    getFinanceWorkflowRows(),
    fetchAllRows<DealPipelineRow>((from, to) =>
      supabase
        .from("deals")
        .select("stage, total_amount, currency")
        .not("stage", "in", "(cancelled,closed_lost)")
        .order("id")
        .range(from, to),
    ),
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
    activeHolds: activeHolds ?? 0,
    workflowRows: workflowRows.map(toSaleRow),
    pipelineDeals,
  })
}
