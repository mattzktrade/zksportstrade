import Link from "next/link"
import nextDynamic from "next/dynamic"
import { requireAdmin } from "@/lib/admin/require-admin"
import { toAdminPlaceOrderPackageOptions } from "@/lib/admin/place-order"
import { getCatalog } from "@/lib/catalog/queries"
import { createClient } from "@/lib/supabase/server"
import { checkoutDefaultsFromProfile } from "@/lib/types/checkout-addresses"
import type { PortalProfile } from "@/lib/types/profile"
import { PageLoadingSpinner } from "@/components/page-loading-spinner"

export const dynamic = "force-dynamic"

const PlaceOrderAdminClient = nextDynamic(
  () => import("./place-order-admin-client").then((m) => ({ default: m.PlaceOrderAdminClient })),
  { loading: () => <PageLoadingSpinner /> },
)

const AGENT_ORDER_COLUMNS =
  "id, email, full_name, company_name, mobile, shipping_address_line1, shipping_address_line2, shipping_city, shipping_postcode, shipping_country, billing_address_line1, billing_address_line2, billing_city, billing_postcode, billing_country" as const

export default async function AdminPlaceOrderPage() {
  await requireAdmin()
  const supabase = await createClient()
  const catalog = await getCatalog(null)

  const { data: agentRows } = await supabase
    .from("profiles")
    .select(AGENT_ORDER_COLUMNS)
    .eq("role", "agent")
    .eq("approval_status", "approved")
    .order("company_name", { ascending: true })

  const agents = (agentRows ?? []) as PortalProfile[]
  const packageOptions = catalog ? toAdminPlaceOrderPackageOptions(catalog.packages) : []

  const agentOptions = agents.map((a) => ({
    id: a.id,
    label: a.company_name?.trim() ? `${a.company_name} — ${a.full_name || a.email}` : a.full_name || a.email,
    email: a.email,
    companyName: a.company_name,
    savedAddresses: checkoutDefaultsFromProfile(a),
  }))

  return (
    <div className="p-6 lg:p-8 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Place order for agent</h1>
      </div>

      {agents.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-8 text-center">
          No approved agents yet. Approve a partner under{" "}
          <Link href="/admin/pending-users" className="text-primary hover:underline">
            Pending users
          </Link>{" "}
          first.
        </p>
      ) : packageOptions.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-8 text-center">
          No bookable packages in the catalog right now.
        </p>
      ) : (
        <PlaceOrderAdminClient agents={agentOptions} packageOptions={packageOptions} />
      )}

      <Link href="/admin/orders" className="text-sm text-primary hover:underline inline-block">
        ← Back to orders
      </Link>
    </div>
  )
}
