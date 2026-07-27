"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { clearSalesforceSyncFailures, runIntegrationOutboxNow, pullSalesforceInventoryNow, backfillShellSingleTicketsForAllThreeDayPackages } from "@/app/(admin)/actions"
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
  const [clearPending, startClear] = useTransition()
  const [shellBackfillPending, startShellBackfill] = useTransition()

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
      const { pull } = res
      const applied = pull.closedWon?.lineItemsApplied ?? 0
      const unmapped = pull.closedWon?.skippedUnmappedProduct ?? 0
      const healed = pull.linkedGroupHeal?.packagesFixed ?? 0
      const limitHit = pull.errors.some((e) =>
        /TotalRequests|REQUEST_LIMIT_EXCEEDED|api.?limit/i.test(e),
      )
      if (limitHit) {
        toast.error(
          `Salesforce API daily limit exceeded. Offline pull paused — try again after the limit resets (usually overnight). ${pull.errors[0]}`,
          { duration: 14000 },
        )
      } else if (pull.errors.length > 0 && applied === 0 && healed === 0) {
        toast.error(`Pull had errors: ${pull.errors[0]}`, { duration: 12000 })
      } else if (applied > 0 || healed > 0) {
        toast.success(
          applied > 0
            ? `Recorded ${applied} Closed Won offline sale(s) and refreshed inventory for open + won opportunities on affected packages.`
            : `Refreshed inventory from recent Salesforce opportunities (open pipeline holds + Closed Won) on ${healed} package(s).`,
          { duration: 11000 },
        )
        if (pull.errors.length > 0) {
          toast.message(`Some follow-up warnings: ${pull.errors[0]}`, { duration: 8000 })
        }
      } else if (unmapped > 0) {
        toast.message(
          `Found Closed Won lines but ${unmapped} Product2 Id(s) are not mapped to a portal package.`,
          { duration: 10000 },
        )
      } else {
        const scanned = pull.closedWon?.opportunitiesScanned ?? 0
        toast.message(
          scanned > 0 || (pull.checked ?? 0) > 0
            ? `Checked recent Salesforce opportunities (all stages) — portal inventory already up to date.`
            : "No recent Salesforce opportunity changes found for mapped packages.",
        )
      }
      router.refresh()
    })
  }

  function clearFailures() {
    startClear(async () => {
      const res = await clearSalesforceSyncFailures()
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Cleared Salesforce sync error banners (and stopped retrying bad jobs).")
      router.refresh()
    })
  }

  function backfillShells() {
    startShellBackfill(async () => {
      const res = await backfillShellSingleTicketsForAllThreeDayPackages()
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      const errNote = res.errors.length > 0 ? ` ${res.errors.length} warning(s) — see server logs.` : ""
      toast.success(
        `Processed ${res.processed} three-day package(s): ${res.shellsCreated} new shell(s), ${res.queued} queued for Salesforce sync.${errNote}`,
        { duration: 10000 },
      )
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
        <button
          type="button"
          disabled={shellBackfillPending || !connected}
          onClick={() => backfillShells()}
          className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
          title="Create hidden Single Ticket shell children for every 3-day package and queue Salesforce sync"
        >
          {shellBackfillPending ? "Backfilling…" : "Backfill Single Ticket shells"}
        </button>
      </div>

      {recentFailures.length > 0 ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-destructive">Latest sync error</p>
            <button
              type="button"
              disabled={clearPending}
              onClick={() => clearFailures()}
              className="text-xs font-medium text-destructive hover:underline disabled:opacity-50"
            >
              {clearPending ? "Clearing..." : "Clear old errors"}
            </button>
          </div>
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
            Offline Salesforce opportunities sync automatically — <strong>Closed Won</strong> counts as sold,{" "}
            <strong>open</strong> stages hold Remaining (SF Pipeline), <strong>Closed Lost</strong> releases stock
            (production: every minute via cron; local: use <span className="font-mono">npm run dev:local</span>).
            Click <strong>Pull offline sales</strong> for an immediate refresh of recent opportunities (all stages).
          </li>
        </ol>
        <p>
          <strong>Production:</strong> Vercel cron runs every minute on{" "}
          <span className="font-mono">/api/cron/integration-outbox</span> (offline SF opportunities, holds, sync queue).
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
