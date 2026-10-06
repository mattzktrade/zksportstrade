import { redirect } from "next/navigation"
import { requireAdmin } from "@/lib/admin/require-admin"
import {
  countBoardDealsUpdatedThisMonth,
  getCrmAccountOptions,
  getDealListRows,
  getDealPackagePicker,
  type DealListRow,
} from "@/lib/crm/deals"
import { getSalesStaffOptions } from "@/lib/crm/leads"
import { getBookingFormsForDeals, listNativeBookingFormsAwaitingApprovalDealIds } from "@/lib/booking-forms/queries"
import { hasCmsPermission, canSendNativeBookingForm, canSignNativeBookingForm } from "@/lib/auth/permissions"
import { getSuppliers } from "@/lib/inventory/suppliers"
import {
  DEAL_BOARD_STAGES,
  ENQUIRY_CRM_STAGES,
  ENQUIRY_PIPELINE_STAGES,
  adminDealListPath,
  isDealBoardStage,
  isEnquiryPipelineStage,
  type EnquiryStageTabId,
} from "@/lib/crm/deal-pipeline"
import { isAwaitingZkApprovalDeal, uniqueDealIds } from "@/lib/admin/deal-link"
import { listMarketingOutreachForDeals, loadMarketingOutreachAdmin } from "@/lib/integrations/marketing-leads/outreach-store"
import { toEnquiryOutreachBadge } from "@/lib/integrations/marketing-leads/outreach-labels"
import { expirePastEventEnquiries } from "@/lib/crm/expire-past-event-enquiries"
import { EnquiriesClient } from "./enquiries-client"
import { AdminRouteShell } from "@/components/admin/admin-route-shell"

export const dynamic = "force-dynamic"

const STAGE_TABS = new Set<EnquiryStageTabId>(["all", ...ENQUIRY_CRM_STAGES])

function parseStageTab(value: string | undefined): EnquiryStageTabId | "" {
  if (!value) return ""
  if (value === "new_enquiry") return "new"
  if (value === "quoting") return "sourcing_required"
  if (value === "all") return ""
  return STAGE_TABS.has(value as EnquiryStageTabId) ? (value as EnquiryStageTabId) : ""
}

function parseOwnerFilter(value: string | undefined): string {
  const raw = value?.trim() ?? ""
  if (!raw) return ""
  if (raw === "unassigned") return "unassigned"
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return raw
  return ""
}

export default function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ enquiry?: string; stage?: string; owner?: string }>
}) {
  return (
    <AdminRouteShell>
      <EnquiriesPageBody searchParams={searchParams} />
    </AdminRouteShell>
  )
}

async function EnquiriesPageBody({
  searchParams,
}: {
  searchParams: Promise<{ enquiry?: string; stage?: string; owner?: string }>
}) {
  const expiry = expirePastEventEnquiries()
  const profile = await requireAdmin()
  const { enquiry: initialSelectedId, stage: stageParam, owner: ownerParam } = await searchParams
  const selectedId = initialSelectedId?.trim() || null
  const [allDeals, selectedRows, packagePicker, accountOptions, staffOptions, suppliers, bookingForms, awaitingZkDealIdsRaw, convertedThisMonth] =
    await Promise.all([
      getDealListRows({ stages: ENQUIRY_PIPELINE_STAGES, summary: true }),
      selectedId ? getDealListRows({ ids: [selectedId] }) : Promise.resolve([] as DealListRow[]),
      getDealPackagePicker(),
      getCrmAccountOptions(),
      getSalesStaffOptions(),
      getSuppliers(),
      getBookingFormsForDeals(),
      listNativeBookingFormsAwaitingApprovalDealIds(),
      countBoardDealsUpdatedThisMonth(DEAL_BOARD_STAGES),
      expiry,
    ])

  const awaitingZkDealIds = uniqueDealIds(awaitingZkDealIdsRaw)
  let deals = allDeals
  const opened = selectedRows[0]
  if (opened) deals = [opened, ...deals.filter((deal) => deal.id !== opened.id)]

  const selected = selectedId ? deals.find((deal) => deal.id === selectedId) ?? null : null
  if (
    selected &&
    (isDealBoardStage(selected.stage) || isAwaitingZkApprovalDeal(selected.id, awaitingZkDealIds))
  ) {
    redirect(adminDealListPath(selected.id))
  }

  const enquiryDeals = deals.filter(
    (deal) =>
      isEnquiryPipelineStage(deal.stage) && !isAwaitingZkApprovalDeal(deal.id, awaitingZkDealIds),
  )
  const { packageOptions, createPackageOptions, eventOptions } = packagePicker
  const [outreachSummaries, outreachAdmin] = await Promise.all([
    listMarketingOutreachForDeals(enquiryDeals.map((deal) => deal.id)),
    loadMarketingOutreachAdmin(),
  ])
  const outreachByDeal = Object.fromEntries(
    Object.entries(outreachSummaries).map(([id, summary]) => [id, toEnquiryOutreachBadge(summary)]),
  )

  return (
    <div className="mx-auto max-w-[1540px] p-3 sm:p-5 lg:p-7">
      <EnquiriesClient
        deals={enquiryDeals}
        outreachByDeal={outreachByDeal}
        outreachSequenceEnabled={outreachAdmin.settings?.enabled === true}
        convertedThisMonth={convertedThisMonth}
        packageOptions={createPackageOptions}
        createEventOptions={eventOptions}
        stockProducts={packageOptions}
        accountOptions={accountOptions}
        staffOptions={staffOptions}
        currentCanManageDeals={hasCmsPermission(profile, "deals.manage")}
        currentCanSendBookingForm={canSendNativeBookingForm(profile)}
        currentCanSignBookingForm={canSignNativeBookingForm(profile)}
        currentProfileName={profile.full_name || "ZK Admin"}
        bookingForms={bookingForms.forms}
        bookingFormEvents={bookingForms.events}
        supplierOptions={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
        initialSelectedId={selectedId}
        initialStageTab={parseStageTab(stageParam)}
        initialOwnerFilter={parseOwnerFilter(ownerParam)}
      />
    </div>
  )
}
