import { redirect } from "next/navigation"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getCrmAccountOptions, getDealListRows, getDealPackagePicker, type DealListRow } from "@/lib/crm/deals"
import { getSalesStaffOptions } from "@/lib/crm/leads"
import {
  getBookingFormsForDeals,
  listNativeBookingFormsAwaitingApprovalDealIds,
} from "@/lib/booking-forms/queries"
import { hasCmsPermission, canSendNativeBookingForm, canSignNativeBookingForm } from "@/lib/auth/permissions"
import { getSuppliers } from "@/lib/inventory/suppliers"
import { DEAL_BOARD_STAGES, adminEnquiryListPath, isDealBoardStage, isEnquiryPipelineStage } from "@/lib/crm/deal-pipeline"
import { isAwaitingZkApprovalDeal, uniqueDealIds } from "@/lib/admin/deal-link"
import { DealsClient } from "./deals-client"

export const dynamic = "force-dynamic"

const DEAL_BOARD_FILTERS = [
  "ready_to_send",
  "booking_form",
  "form_expired",
  "awaiting_approval",
  "awaiting_payment",
  "won",
  "lost",
] as const

function isDealBoardFilter(
  value: string | undefined,
): value is (typeof DEAL_BOARD_FILTERS)[number] {
  return typeof value === "string" && (DEAL_BOARD_FILTERS as readonly string[]).includes(value)
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ deal?: string; pipeline?: string }>
}) {
  const profile = await requireAdmin()
  const { deal: initialSelectedId, pipeline: initialPipeline } = await searchParams

  if (initialPipeline === "new_enquiry") {
    redirect("/admin/enquiries?stage=new")
  }
  if (initialPipeline === "price_sent") {
    redirect("/admin/enquiries?stage=price_sent")
  }

  const selectedId = initialSelectedId?.trim() || null
  const [initialDeals, selectedRows, packagePicker, accountOptions, staffOptions, bookingForms, suppliers, awaitingZkDealIdsRaw] =
    await Promise.all([
      getDealListRows({ stages: DEAL_BOARD_STAGES, summary: true }),
      selectedId ? getDealListRows({ ids: [selectedId] }) : Promise.resolve([] as DealListRow[]),
      getDealPackagePicker(),
      getCrmAccountOptions(),
      getSalesStaffOptions(),
      getBookingFormsForDeals(),
      getSuppliers(),
      listNativeBookingFormsAwaitingApprovalDealIds(),
    ])

  const awaitingZkDealIds = uniqueDealIds(awaitingZkDealIdsRaw)
  let deals = initialDeals
  const opened = selectedRows[0]
  if (opened) deals = [opened, ...deals.filter((deal) => deal.id !== opened.id)]
  const extraIds = awaitingZkDealIds.filter((id) => !deals.some((deal) => deal.id === id))
  if (extraIds.length > 0) {
    const extra = await getDealListRows({ ids: extraIds, summary: true })
    if (extra.length > 0) deals = [...extra, ...deals]
  }

  const selected = selectedId ? deals.find((deal) => deal.id === selectedId) ?? null : null
  if (
    selected &&
    isEnquiryPipelineStage(selected.stage) &&
    !isAwaitingZkApprovalDeal(selected.id, awaitingZkDealIds)
  ) {
    redirect(adminEnquiryListPath(selected.id))
  }

  const boardDeals = deals.filter(
    (deal) => isDealBoardStage(deal.stage) || isAwaitingZkApprovalDeal(deal.id, awaitingZkDealIds),
  )

  const { packageOptions, createPackageOptions, eventOptions } = packagePicker

  return (
    <div className="mx-auto max-w-[1540px] p-3 sm:p-5 lg:p-7">
      <DealsClient
        deals={boardDeals}
        packageOptions={packageOptions}
        createPackageOptions={createPackageOptions}
        createEventOptions={eventOptions}
        accountOptions={accountOptions}
        staffOptions={staffOptions}
        currentProfileId={profile.id}
        currentProfileName={profile.full_name || "ZK Admin"}
        currentCanSendBookingForm={canSendNativeBookingForm(profile)}
        currentCanSignBookingForm={canSignNativeBookingForm(profile)}
        currentCanManageFinance={hasCmsPermission(profile, "finance.manage")}
        currentCanManageDeals={hasCmsPermission(profile, "deals.manage")}
        bookingForms={bookingForms.forms}
        bookingFormEvents={bookingForms.events}
        awaitingZkDealIds={awaitingZkDealIds}
        supplierOptions={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
        initialSelectedId={initialSelectedId ?? null}
        initialPipelineFilter={isDealBoardFilter(initialPipeline) ? initialPipeline : ""}
      />
    </div>
  )
}
