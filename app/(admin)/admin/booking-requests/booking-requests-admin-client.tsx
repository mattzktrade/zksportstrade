"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { approveBookingRequest, rejectBookingRequest } from "@/app/(admin)/actions"
import type { AdminBookingApprovalRow } from "@/lib/booking-approval/types"
import { Loader2 } from "lucide-react"

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export function BookingRequestsAdminClient({ requests }: { requests: AdminBookingApprovalRow[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({})

  function approve(id: string) {
    setActiveId(id)
    start(async () => {
      const res = await approveBookingRequest(id)
      setActiveId(null)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(
        res.orderReference
          ? `Approved — booking ${res.orderReference} created and agent notified.`
          : "Approved and agent notified.",
      )
      router.refresh()
    })
  }

  function reject(id: string) {
    setActiveId(id)
    start(async () => {
      const res = await rejectBookingRequest(id, rejectNote[id] ?? null)
      setActiveId(null)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Request declined and agent notified.")
      router.refresh()
    })
  }

  if (requests.length === 0) {
    return (
      <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-8 text-center">
        No pending Paddock Club requests.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {requests.map((r) => {
        const busy = pending && activeId === r.id
        return (
          <article key={r.id} className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-semibold text-foreground">{r.reference}</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Submitted {new Date(r.created_at).toLocaleString()}
                </p>
              </div>
              <span className="text-xs font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full">
                Pending approval
              </span>
            </div>

            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Package</p>
                <p className="font-medium">{r.packages?.name ?? r.package_id}</p>
                <p className="text-muted-foreground">{r.packages?.circuit}</p>
                <p className="text-muted-foreground mt-1">
                  {r.guests} guests · {formatMoney(Number(r.total_amount), r.currency)}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Agent</p>
                <p className="font-medium">{r.agent?.full_name || "—"}</p>
                <p className="text-muted-foreground">{r.agent?.company_name || "—"}</p>
                <p className="text-muted-foreground">{r.agent?.email}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Client</p>
                <p>
                  {r.client_name} · {r.client_email} · {r.client_phone}
                </p>
                {r.dietary_requirements ? (
                  <p className="text-muted-foreground mt-1">Dietary: {r.dietary_requirements}</p>
                ) : null}
                {r.special_requests ? (
                  <p className="text-muted-foreground">Special: {r.special_requests}</p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:items-end border-t border-border pt-4">
              <div className="flex-1">
                <label className="block text-xs text-muted-foreground mb-1">Decline note (optional)</label>
                <input
                  value={rejectNote[r.id] ?? ""}
                  onChange={(e) => setRejectNote((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  disabled={busy}
                  placeholder="Reason shown to the agent if declined"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                />
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => reject(r.id)}
                  className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Decline"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => approve(r.id)}
                  className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Approve booking
                </button>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
