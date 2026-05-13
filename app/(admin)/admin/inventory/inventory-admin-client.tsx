"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createInventoryHold, releaseInventoryHold } from "@/app/(admin)/actions"
import type { InventoryHoldRow } from "@/lib/admin/queries"
import type { PortalProfile } from "@/lib/types/profile"

type HoldDetail = InventoryHoldRow & {
  package_name: string
  agent_email: string
  agent_company: string
}

type PackageOption = { id: string; name: string }

export function InventoryAdminClient({
  holds,
  agents,
  packages,
}: {
  holds: HoldDetail[]
  agents: PortalProfile[]
  packages: PackageOption[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [packageId, setPackageId] = useState(packages[0]?.id ?? "")
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "")
  const [qty, setQty] = useState("1")
  const [note, setNote] = useState("")

  const activeHolds = useMemo(() => holds.filter((h) => !h.released_at), [holds])
  const releasedHolds = useMemo(() => holds.filter((h) => h.released_at), [holds])

  function submitHold(e: React.FormEvent) {
    e.preventDefault()
    if (!packageId || !agentId) {
      toast.error("Choose a package and an agent.")
      return
    }
    start(async () => {
      const res = await createInventoryHold({
        packageId,
        agentProfileId: agentId,
        quantity: Number(qty),
        note: note.trim() || null,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Hold created.")
      setNote("")
      router.refresh()
    })
  }

  function release(id: string) {
    start(async () => {
      const res = await releaseInventoryHold(id)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Hold released.")
      router.refresh()
    })
  }

  return (
    <div className="space-y-10">
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4 max-w-xl">
        <h2 className="text-base font-semibold text-foreground">Create hold</h2>
        <p className="text-sm text-muted-foreground">
          Reserves units against an agent. Stock checks run in the database; held counts must stay within capacity.
        </p>
        <form onSubmit={(e) => void submitHold(e)} className="space-y-3">
          <label className="block text-xs text-muted-foreground">
            Package
            <select
              value={packageId}
              onChange={(e) => setPackageId(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-muted-foreground">
            Agent
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.company_name || a.full_name || a.email}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-muted-foreground">
            Quantity
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="mt-1 w-full max-w-[160px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Note (optional)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={pending || packages.length === 0 || agents.length === 0}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            Create hold
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Active holds</h2>
        {activeHolds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active holds.</p>
        ) : (
          <HoldTable holds={activeHolds} onRelease={release} pending={pending} released={false} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Released holds</h2>
        {releasedHolds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No history yet.</p>
        ) : (
          <HoldTable holds={releasedHolds} onRelease={() => {}} pending={pending} released />
        )}
      </section>
    </div>
  )
}

function HoldTable({
  holds,
  onRelease,
  pending,
  released,
}: {
  holds: HoldDetail[]
  onRelease: (id: string) => void
  pending: boolean
  released: boolean
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="p-3 font-medium">Package</th>
            <th className="p-3 font-medium">Agent</th>
            <th className="p-3 font-medium">Qty</th>
            <th className="p-3 font-medium">Note</th>
            <th className="p-3 font-medium">Created</th>
            {!released && <th className="p-3 font-medium w-[120px]" />}
            {released && <th className="p-3 font-medium">Released</th>}
          </tr>
        </thead>
        <tbody>
          {holds.map((h) => (
            <tr key={h.id} className="border-b border-border last:border-0">
              <td className="p-3">
                <div className="font-medium text-foreground">{h.package_name}</div>
                <div className="text-[11px] font-mono text-muted-foreground">{h.package_id}</div>
              </td>
              <td className="p-3 text-muted-foreground">
                <div>{h.agent_company || h.agent_email}</div>
                <div className="text-xs">{h.agent_email}</div>
              </td>
              <td className="p-3 tabular-nums">{h.quantity}</td>
              <td className="p-3 text-muted-foreground max-w-[200px]">{h.note ?? "—"}</td>
              <td className="p-3 text-muted-foreground whitespace-nowrap">
                {new Date(h.created_at).toLocaleString()}
              </td>
              {!released && (
                <td className="p-3">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onRelease(h.id)}
                    className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                  >
                    Release
                  </button>
                </td>
              )}
              {released && (
                <td className="p-3 text-muted-foreground whitespace-nowrap">
                  {h.released_at ? new Date(h.released_at).toLocaleString() : "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
