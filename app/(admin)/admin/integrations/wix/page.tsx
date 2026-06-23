import Link from "next/link"
import { getWixConfig, isWixConfigured } from "@/lib/integrations/wix/config"

export default function WixIntegrationPage() {
  const configured = isWixConfigured()
  const config = getWixConfig()

  return (
    <div className="p-6 lg:p-8 max-w-2xl space-y-6">
      <div>
        <Link href="/admin/integrations" className="text-sm text-muted-foreground hover:text-primary">
          ← Integrations
        </Link>
        <h1 className="text-2xl font-semibold text-foreground mt-2">Wix</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Shared stock and retail price on zk-sports.com. Paid Wix orders create portal bookings + Salesforce +
          Xero.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3 text-sm">
        <p>
          <span className="text-muted-foreground">API configured:</span>{" "}
          <span className="font-medium">{configured ? "Yes" : "No"}</span>
        </p>
        {config?.agentProfileId ? (
          <p className="text-xs font-mono text-muted-foreground break-all">
            WIX_AGENT_PROFILE_ID: {config.agentProfileId}
          </p>
        ) : (
          <p className="text-amber-800 bg-amber-50/80 dark:text-amber-100 dark:bg-amber-950/30 rounded-lg px-3 py-2 text-xs">
            Set <span className="font-mono">WIX_AGENT_PROFILE_ID</span> in `.env.local` to an approved admin/agent
            profile uuid (orders are attributed to this account).
          </p>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
        <p className="font-semibold">Phase 4 pilot package</p>
        <p className="text-muted-foreground">
          <span className="font-mono text-foreground">barcelona-f1-experiences-paddock-club-2026</span> — 3 Day F1
          Experiences Paddock Club (Spanish GP 2026)
        </p>
        <Link
          href="/admin/catalog/barcelona-f1-experiences-paddock-club-2026"
          className="inline-block text-primary hover:underline text-sm"
        >
          Open in Catalog → map Wix Product ID
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
        <p className="font-semibold">Webhook (paid orders)</p>
        <p className="font-mono text-xs break-all">POST /api/webhooks/wix-order</p>
        <p className="text-xs text-muted-foreground">
          Production: <span className="font-mono">https://zk-sports.trade/api/webhooks/wix-order</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Full setup steps: <span className="font-mono">docs/PHASE4_WIX_SETUP.md</span>
        </p>
      </div>
    </div>
  )
}
