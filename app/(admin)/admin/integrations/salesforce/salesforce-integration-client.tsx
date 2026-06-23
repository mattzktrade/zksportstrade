"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { runIntegrationOutboxNow, pullSalesforceInventoryNow } from "@/app/(admin)/actions"
import type { RecentSyncFailure } from "@/lib/admin/integration-failures"

export function SalesforceIntegrationClient({
  configured,
  connected,
  instanceUrl,
  connectedFlash,
  errorFlash,
  recentFailures,
}: {
  configured: boolean
  connected: boolean
  instanceUrl: string | null
  connectedFlash: boolean
  errorFlash: string | null
  recentFailures: RecentSyncFailure[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [pullPending, startPull] = useTransition()

  function processQueue() {
    start(async () => {
      const res = await runIntegrationOutboxNow()
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      const r = res.result
      if (r.skipped) {
        toast.message(r.message ?? "Queue skipped.")
      } else if (r.processed === 0) {
        toast.message("No pending sync jobs.")
      } else if (r.failed > 0 && r.failures?.[0]?.error) {
        const parts = [`${r.completed} ok`, `${r.failed} failed`]
        if (r.orphaned > 0) parts.push(`${r.orphaned} skipped (deleted)`)
        toast.error(`${parts.join(", ")}. ${r.failures[0].error}`, { duration: 12000 })
      } else if (r.failed > 0) {
        toast.error(`Processed ${r.processed}: ${r.completed} ok, ${r.failed} failed.`)
      } else if (r.orphaned > 0) {
        toast.success(
          `Processed ${r.processed}: ${r.completed} synced, ${r.orphaned} skipped (deleted orders/packages).`,
        )
      } else {
        toast.success(`Processed ${r.processed}: all succeeded.`)
      }
      router.refresh()
    })
  }

  function pullOfflineSales() {
    startPull(async () => {
      const res = await pullSalesforceInventoryNow()
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      const { pull, outbox } = res
      if (pull.errors.length > 0) {
        toast.error(`Pull had errors: ${pull.errors[0]}`, { duration: 12000 })
      } else if (pull.closedWon?.lineItemsApplied) {
        toast.success(
          `Applied ${pull.closedWon.lineItemsApplied} offline sale(s) from Closed Won opportunities. Queued channel sync.`,
        )
      } else if (pull.adjusted > 0) {
        toast.success(
          `Updated ${pull.adjusted} package(s) from Salesforce inventory. Queued ${pull.channelSyncQueued} channel sync(s).`,
        )
      } else {
        const scanned = pull.closedWon?.opportunitiesScanned ?? 0
        toast.message(
          scanned > 0
            ? `Checked ${scanned} Closed Won opportunities — portal already up to date.`
            : `Checked ${pull.checked} packages — portal already matches Salesforce.`,
        )
      }
      if (outbox.failed > 0 && outbox.failures?.[0]?.error) {
        toast.error(`Sync queue: ${outbox.failures[0].error}`, { duration: 12000 })
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {connectedFlash ? (
        <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          Salesforce connected successfully. Run the sync queue below, or wait for cron.
        </p>
      ) : null}
      {errorFlash ? (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3">
          {errorFlash}
        </p>
      ) : null}

      <div className="rounded-xl border border-border bg-card p-4 space-y-3 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Env configured</span>
          <span className="font-medium">{configured ? "Yes" : "No — set Client ID/Secret in .env.local"}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Connected (refresh token)</span>
          <span className="font-medium">{connected ? "Yes" : "No"}</span>
        </div>
        {instanceUrl ? (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Instance</span>
            <span className="font-mono text-xs break-all text-right">{instanceUrl}</span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <a
          href="/api/integrations/salesforce/connect"
          className="inline-flex px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        >
          {connected ? "Reconnect Salesforce" : "Connect Salesforce"}
        </a>
        <button
          type="button"
          disabled={pending || !connected}
          onClick={() => processQueue()}
          className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {pending ? "Processing…" : "Process sync queue now"}
        </button>
        <button
          type="button"
          disabled={pullPending || !connected}
          onClick={() => pullOfflineSales()}
          className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {pullPending ? "Pulling…" : "Pull offline sales from Salesforce"}
        </button>
      </div>

      {recentFailures.length > 0 ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-2">
          <p className="text-sm font-semibold text-destructive">Latest sync error</p>
          {recentFailures.map((f, i) => (
            <div key={i} className="text-xs text-destructive/90 space-y-1">
              {f.package_id ? (
                <p>
                  Package:{" "}
                  <a href={`/admin/catalog/${f.package_id}`} className="font-mono underline">
                    {f.package_id}
                  </a>
                </p>
              ) : null}
              <p className="break-words">{f.error}</p>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground pt-1">
            Also check the package’s <strong>Channels &amp; Salesforce</strong> section in Catalog.
          </p>
        </div>
      ) : null}

      <div className="text-xs text-muted-foreground space-y-2 rounded-lg border border-dashed border-border p-3">
        <p className="font-semibold text-foreground">After connecting</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Add Product Codes on packages (match Salesforce Sales List).</li>
          <li>Save a package or click “Queue sync again” — then Process sync queue.</li>
          <li>Place a test order — Salesforce sync runs automatically in the background (no button needed).</li>
          <li>
            Offline deals in Salesforce sync automatically (production: every minute via cron; local: use{" "}
            <span className="font-mono">npm run dev:local</span>). You can still click{" "}
            <strong>Pull offline sales</strong> for an immediate run.
          </li>
        </ol>
        <p>
          <strong>Production:</strong> Vercel cron runs every minute on{" "}
          <span className="font-mono">/api/cron/integration-outbox</span> (offline SF sales, holds, sync queue).
          Set <span className="font-mono">CRON_SECRET</span> in Vercel env.
        </p>
        <p>
          <strong>Local testing:</strong> run <span className="font-mono">npm run dev:local</span> instead of{" "}
          <span className="font-mono">npm run dev</span> — automatic sync every 60s (set{" "}
          <span className="font-mono">LOCAL_CRON_INTERVAL_SEC</span> in <span className="font-mono">.env.local</span>{" "}
          to change). Requires <span className="font-mono">CRON_SECRET</span> in <span className="font-mono">.env.local</span>.
        </p>
      </div>
    </div>
  )
}
