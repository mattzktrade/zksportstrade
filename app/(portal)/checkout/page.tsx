import Link from "next/link"
import { getPackageById } from "@/lib/catalog/queries"
import { CheckoutClient } from "./checkout-client"

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

  const pkg = await getPackageById(packageId)
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

  return <CheckoutClient pkg={pkg} initialGuests={initialGuests} />
}
