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
import { DealsClient } from "./deals-client"

export const dynamic = "force-dynamic"

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ deal?: string; pipeline?: string }>
}) {
  const profile = await requireAdmin()
  const { deal: initialSelectedId, pipeline: initialPipeline } = await searchParams
  const [initialDeals, packages, accountOptions, staffOptions, bookingForms, suppliers] = await Promise.all([
    getDealListRows(),
    getAdminCatalogListRows(),
    getCrmAccountOptions(),
    getSalesStaffOptions(),
    getBookingFormsForDeals(),
    getSuppliers(),
  ])

  let deals = initialDeals
  const selectedId = initialSelectedId?.trim() || null
  if (selectedId && !deals.some((deal) => deal.id === selectedId)) {
    const extra = await getDealListRows({ ids: [selectedId] })
    if (extra.length > 0) deals = [...extra, ...deals]
  }

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
      <DealsClient
        deals={deals}
        packageOptions={packageOptions}
        createPackageOptions={createPackageOptions}
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
        supplierOptions={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
        initialSelectedId={initialSelectedId ?? null}
        initialPipelineFilter={
          initialPipeline === "ready_to_send" ||
          initialPipeline === "new_enquiry" ||
          initialPipeline === "price_sent" ||
          initialPipeline === "booking_form" ||
          initialPipeline === "awaiting_approval" ||
          initialPipeline === "awaiting_payment" ||
          initialPipeline === "won" ||
          initialPipeline === "lost"
            ? initialPipeline
            : ""
        }
      />
    </div>
  )
}
