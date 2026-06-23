"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { runIntegrationOutboxNow } from "@/app/(admin)/actions"

export function XeroIntegrationClient({
  configured,
  connected,
  tenantName,
  connectedFlash,
  errorFlash,
}: {
  configured: boolean
  connected: boolean
  tenantName: string | null
  connectedFlash: boolean
  errorFlash: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function processQueue() {
    start(async () => {
      const res = await runIntegrationOutboxNow()
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      const r = res.result
      if (r.skipped) toast.message(r.message ?? "Queue skipped.")
      else if (r.processed === 0) toast.message("No pending sync jobs.")
      else if (r.failed > 0) {
        const invoiceFail = r.failures?.find((f) => f.event_type === "invoice.create")
        const msg =
          invoiceFail?.error ??
          r.failures?.map((f) => `${f.event_type}: ${f.error}`).join(" · ") ??
          `Failed: ${r.failed}`
        toast.error(msg)
      }
      else if (r.orphaned > 0)
        toast.success(
          `Processed ${r.processed}: ${r.completed} synced, ${r.orphaned} skipped (deleted orders/packages).`,
        )
      else toast.success(`Processed ${r.processed} job(s).`)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {connectedFlash ? (
        <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          Xero connected. New orders will queue invoice creation when you process the sync queue.
        </p>
      ) : null}
      {errorFlash ? (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3">
          {errorFlash}
        </p>
      ) : null}

      <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Env configured</span>
          <span className="font-medium">{configured ? "Yes" : "No — set XERO_CLIENT_ID/SECRET"}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Connected</span>
          <span className="font-medium">{connected ? "Yes" : "No"}</span>
        </div>
        {tenantName ? (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Organisation</span>
            <span className="font-medium">{tenantName}</span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <a
          href="/api/integrations/xero/connect"
          className="inline-flex px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        >
          {connected ? "Reconnect Xero" : "Connect Xero"}
        </a>
        <button
          type="button"
          disabled={pending}
          onClick={() => processQueue()}
          className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {pending ? "Processing…" : "Process sync queue now"}
        </button>
      </div>

      <div className="text-xs text-muted-foreground space-y-2 rounded-lg border border-dashed border-border p-3">
        <p className="font-semibold text-foreground">On each order</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Portal creates order + invoice row (awaiting invoice).</li>
          <li>Queue runs Salesforce (Opportunity + guest contact) and Xero (ACCREC invoice).</li>
          <li>Portal invoice moves to awaiting payment when Xero invoice is created.</li>
        </ol>
        <p>
          Webhook: <span className="font-mono">POST /api/webhooks/xero</span> — set{" "}
          <span className="font-mono">XERO_WEBHOOK_KEY</span> in Xero Developer portal.
        </p>
      </div>
    </div>
  )
}
