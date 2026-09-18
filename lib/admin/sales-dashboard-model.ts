import { unstable_noStore as noStore } from "next/cache"
import {
  buildSalesDashboardView,
  type SalesDashboardDeal,
  type SalesDashboardModel,
  type SalesDashboardSale,
} from "@/lib/admin/sales-dashboard-metrics"
import { getFinanceWorkflowRows } from "@/lib/admin/workflow-views"
import { getDealListRows } from "@/lib/crm/deals"

function toSaleRow(
  row: Awaited<ReturnType<typeof getFinanceWorkflowRows>>[number],
): SalesDashboardSale {
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
    ownerId: row.ownerId,
  }
}

function toDealRow(deal: Awaited<ReturnType<typeof getDealListRows>>[number]): SalesDashboardDeal {
  return {
    id: deal.id,
    reference: deal.reference,
    stage: deal.stage,
    enquiry_stage: deal.enquiry_stage,
    source: deal.source,
    owner_profile_id: deal.owner_profile_id,
    total_amount: deal.total_amount,
    currency: deal.currency,
    created_at: deal.created_at,
    race_name: deal.race_name,
    line_summary: deal.line_summary,
    recent_activities: deal.recent_activities.map((activity) => ({
      id: activity.id,
      summary: activity.summary,
      created_at: activity.created_at,
      actor_name: activity.actor_name,
    })),
  }
}

export async function getSalesDashboardModel(profile: { id: string }): Promise<SalesDashboardModel> {
  noStore()
  const [deals, workflowRows] = await Promise.all([getDealListRows(), getFinanceWorkflowRows()])
  return buildSalesDashboardView({
    ownerId: profile.id,
    deals: deals.map(toDealRow),
    sales: workflowRows.map(toSaleRow),
  })
}
