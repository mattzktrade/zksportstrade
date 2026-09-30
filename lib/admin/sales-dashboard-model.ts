import { unstable_noStore as noStore } from "next/cache"
import { dashboardSalesSince, getDashboardSaleRows } from "@/lib/admin/dashboard-sales"
import {
  buildSalesDashboardView,
  type SalesDashboardDeal,
  type SalesDashboardModel,
  type SalesDashboardSale,
} from "@/lib/admin/sales-dashboard-metrics"
import { getDealListRows } from "@/lib/crm/deals"
import { createClient } from "@/lib/supabase/server"

function toSaleRow(row: Awaited<ReturnType<typeof getDashboardSaleRows>>[number]): SalesDashboardSale {
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
    updated_at: deal.updated_at,
    account_name: deal.account_name,
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

async function recentActivitiesByDeal(): Promise<
  Map<string, Array<{ id: string; summary: string; created_at: string; actor_name: string | null }>>
> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("deal_activities")
    .select("id, deal_id, summary, created_at")
    .order("created_at", { ascending: false })
    .limit(200)
  const byDeal = new Map<string, Array<{ id: string; summary: string; created_at: string; actor_name: string | null }>>()
  for (const row of data ?? []) {
    const dealId = String(row.deal_id ?? "")
    if (!dealId) continue
    const list = byDeal.get(dealId) ?? []
    if (list.length >= 5) continue
    list.push({
      id: String(row.id),
      summary: String(row.summary ?? ""),
      created_at: String(row.created_at),
      actor_name: null,
    })
    byDeal.set(dealId, list)
  }
  return byDeal
}

export async function getSalesDashboardModel(profile: { id: string }): Promise<SalesDashboardModel> {
  noStore()
  const [deals, workflowRows, activities] = await Promise.all([
    getDealListRows({ summary: true }),
    getDashboardSaleRows(dashboardSalesSince().toISOString()),
    recentActivitiesByDeal(),
  ])
  return buildSalesDashboardView({
    ownerId: profile.id,
    deals: deals.map((deal) => {
      const row = toDealRow(deal)
      const recent = activities.get(deal.id)
      return recent ? { ...row, recent_activities: recent } : row
    }),
    sales: workflowRows.map(toSaleRow),
  })
}
