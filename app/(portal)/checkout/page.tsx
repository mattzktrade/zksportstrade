import Link from "next/link"
import dynamic from "next/dynamic"
import { getPackageById } from "@/lib/catalog/queries"
import { getPortalProfile } from "@/lib/supabase/profile"
import { checkoutDefaultsFromProfile, emptyCheckoutAddressFields } from "@/lib/types/checkout-addresses"
import { PageLoadingSpinner } from "@/components/page-loading-spinner"

const CheckoutClient = dynamic(
  () => import("./checkout-client").then((m) => ({ default: m.CheckoutClient })),
  { loading: () => <PageLoadingSpinner /> },
)

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ package?: string; guests?: string }>
}) {
  const sp = await searchParams
  const packageId = sp.package
  if (!packageId) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-xl font-bold">Missing package</h1>
        <Link href="/packages" className="text-primary mt-4 inline-block">
          Back to packages
        </Link>
      </div>
    )
  }

  const profile = await getPortalProfile()
  const pkg = await getPackageById(packageId, profile?.id ?? null)
  if (!pkg) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold">Package not found</h1>
        <Link href="/packages" className="text-primary mt-4 inline-block">
          Back to packages
        </Link>
      </div>
    )
  }

  const rawGuests = sp.guests ? Number.parseInt(sp.guests, 10) : 2
  const initialGuests = Number.isFinite(rawGuests) && rawGuests > 0 ? rawGuests : 2
  const savedAddresses = profile ? checkoutDefaultsFromProfile(profile) : emptyCheckoutAddressFields()

  const agentAgencyLabel =
    profile?.company_name?.trim() || profile?.full_name?.trim() || profile?.email?.split("@")[0] || null

  return (
    <CheckoutClient
      pkg={pkg}
      initialGuests={initialGuests}
      savedAddresses={savedAddresses}
      agentAgencyLabel={agentAgencyLabel}
    />
  )
}
