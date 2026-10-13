import Link from "next/link"
import { requireCmsPermission } from "@/lib/admin/require-admin"
import { isWixIntegrationDisconnected } from "@/lib/integrations/wix/config"

export default async function WixIntegrationPage() {
  await requireCmsPermission("settings.manage")
  const disconnected = isWixIntegrationDisconnected()

  return (
    <div className="p-6 lg:p-8 max-w-2xl space-y-6">
      <div>
        <Link href="/admin/settings?tab=integrations" className="text-sm text-muted-foreground hover:text-primary">
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold text-foreground mt-2">Wix</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {disconnected
            ? "The website connection is turned off. Catalog, stock, and order updates stay in the CRM and are not sent to Wix."
            : "Shared stock and retail price on zk-sports.com. Paid Wix orders create portal bookings and keep website inventory in sync."}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3 text-sm">
        <p>
          <span className="text-muted-foreground">Status:</span>{" "}
          <span className="font-medium">{disconnected ? "Disconnected" : "Connected"}</span>
        </p>
        {disconnected ? (
          <p className="text-muted-foreground text-xs">
            No product, price, stock, or order request is sent to Wix. Existing website products are left unchanged.
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
        <p className="font-semibold">Paid orders</p>
        <p className="text-xs text-muted-foreground">
          Incoming Wix order webhooks are acknowledged and ignored. They do not create bookings, and they do not change
          anything on Wix.
        </p>
      </div>
    </div>
  )
}
