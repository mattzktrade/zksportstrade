import Link from "next/link"
import { getXeroConnectionStatus } from "@/lib/integrations/xero/settings-store"
import { isXeroConfigured } from "@/lib/integrations/xero/config"
import { XeroIntegrationClient } from "./xero-integration-client"

export default async function XeroIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>
}) {
  const params = await searchParams
  const status = await getXeroConnectionStatus()

  return (
    <div className="p-6 lg:p-8 max-w-2xl space-y-6">
      <div>
        <Link href="/admin/integrations" className="text-sm text-muted-foreground hover:text-primary">
          ← Integrations
        </Link>
        <h1 className="text-2xl font-semibold text-foreground mt-2">Xero integration</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Creates a Xero invoice when an order is placed. See <code className="text-xs">docs/PHASE2.5_XERO_SETUP.md</code>.
        </p>
      </div>

      <XeroIntegrationClient
        configured={isXeroConfigured()}
        connected={status.connected}
        tenantName={status.tenantName}
        connectedFlash={params.connected === "1"}
        errorFlash={params.error ? decodeURIComponent(params.error) : null}
      />
    </div>
  )
}
