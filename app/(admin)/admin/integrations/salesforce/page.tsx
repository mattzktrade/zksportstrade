import Link from "next/link"
import { getRecentSyncFailures } from "@/lib/admin/integration-failures"
import { getSalesforceConnectionStatus } from "@/lib/integrations/salesforce/settings-store"
import { isSalesforceConfigured } from "@/lib/integrations/salesforce/config"
import { isNativePlatformMode } from "@/lib/platform/runtime-mode"
import { SalesforceIntegrationClient } from "./salesforce-integration-client"

export default async function SalesforceIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>
}) {
  const params = await searchParams
  const nativeMode = isNativePlatformMode()

  if (nativeMode) {
    return (
      <div className="p-6 lg:p-8 max-w-2xl space-y-6">
        <div>
          <Link href="/admin/settings?tab=integrations" className="text-sm text-muted-foreground hover:text-primary">
            ← Settings
          </Link>
          <h1 className="text-2xl font-semibold text-foreground mt-2">Salesforce (legacy)</h1>
        </div>
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-5">
          <p className="font-medium text-foreground">Disabled by native platform mode</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Salesforce data and settings are preserved, but this local rebuild will not connect,
            read, write, pull inventory, or process Salesforce sync jobs.
          </p>
        </div>
      </div>
    )
  }

  const status = await getSalesforceConnectionStatus()
  const configured = isSalesforceConfigured()
  const recentFailures = await getRecentSyncFailures(5)

  return (
    <div className="p-6 lg:p-8 max-w-2xl space-y-6">
      <div>
        <Link href="/admin/settings?tab=integrations" className="text-sm text-muted-foreground hover:text-primary">
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold text-foreground mt-2">Salesforce integration</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect Salesforce, then process the sync queue. Products need a Product Code; orders create Opportunities.
        </p>
      </div>

      <SalesforceIntegrationClient
        configured={configured}
        connected={status.connected}
        instanceUrl={status.instanceUrl}
        connectedFlash={params.connected === "1"}
        errorFlash={params.error ? decodeURIComponent(params.error) : null}
        recentFailures={recentFailures}
      />
    </div>
  )
}
