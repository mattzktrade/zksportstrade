import { redirect } from "next/navigation"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getAdminCatalogListRows } from "@/lib/admin/queries"
import {
  adminPackageNetQuantity,
  adminPackageSellable,
} from "@/lib/inventory/effective-availability"
import { getCrmAccountOptions, getDealListRows } from "@/lib/crm/deals"
import { getSalesStaffOptions } from "@/lib/crm/leads"
import { getBookingFormsForDeals } from "@/lib/booking-forms/queries"
import { hasCmsPermission, canSendNativeBookingForm, canSignNativeBookingForm } from "@/lib/auth/permissions"
import { getSuppliers } from "@/lib/inventory/suppliers"
import {
  ENQUIRY_CRM_STAGES,
  adminDealListPath,
  isDealBoardStage,
  isEnquiryPipelineStage,
  type EnquiryStageTabId,
} from "@/lib/crm/deal-pipeline"
import { EnquiriesClient } from "./enquiries-client"

export const dynamic = "force-dynamic"

const STAGE_TABS = new Set<EnquiryStageTabId>(["all", ...ENQUIRY_CRM_STAGES])

function parseStageTab(value: string | undefined): EnquiryStageTabId | "" {
  if (!value) return ""
  if (value === "new_enquiry") return "new"
  if (value === "quoting") return "sourcing_required"
  if (value === "all") return ""
  return STAGE_TABS.has(value as EnquiryStageTabId) ? (value as EnquiryStageTabId) : ""
}

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ enquiry?: string; stage?: string }>
}) {
  const profile = await requireAdmin()
  const { enquiry: initialSelectedId, stage: stageParam } = await searchParams
  const [allDeals, packages, accountOptions, staffOptions, suppliers, bookingForms] = await Promise.all([
    getDealListRows(),
    getAdminCatalogListRows(),
    getCrmAccountOptions(),
    getSalesStaffOptions(),
    getSuppliers(),
    getBookingFormsForDeals(),
  ])

  const selectedId = initialSelectedId?.trim() || null
  let deals = allDeals
  if (selectedId && !deals.some((deal) => deal.id === selectedId)) {
    const extra = await getDealListRows({ ids: [selectedId] })
    if (extra.length > 0) deals = [...extra, ...deals]
  }

  const selected = selectedId ? deals.find((deal) => deal.id === selectedId) ?? null : null
  if (selected && isDealBoardStage(selected.stage)) {
    redirect(adminDealListPath(selected.id))
  }

  const enquiryDeals = deals.filter((deal) => isEnquiryPipelineStage(deal.stage))
  const monthKey = new Date().toISOString().slice(0, 7)
  const convertedThisMonth = deals.filter(
    (deal) =>
      isDealBoardStage(deal.stage) &&
      deal.stage !== "closed_lost" &&
      deal.stage !== "cancelled" &&
      deal.updated_at.startsWith(monthKey),
  ).length

  const packageOptions = packages
    .filter((row) => !row.shell_parent_package_id)
    .map((row) => ({
      id: row.id,
      label: `${row.race_name} — ${row.name}`,
      eventId: row.race_id,
      eventName: row.race_name,
      packageName: row.name,
      price: row.trade_price,
      currency: row.currency || "USD",
      stockLeft: adminPackageSellable(row),
      netStock: adminPackageNetQuantity(row),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const createPackageOptions = packageOptions.filter((option) =>
    packages.some((row) => row.id === option.id && !row.is_hidden),
  )

  return (
    <div className="mx-auto max-w-[1540px] p-3 sm:p-5 lg:p-7">
      <EnquiriesClient
        deals={enquiryDeals}
        convertedThisMonth={convertedThisMonth}
        packageOptions={createPackageOptions}
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
      />
    </div>
  )
}
