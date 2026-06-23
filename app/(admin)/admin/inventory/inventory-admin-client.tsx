"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"
import { toast } from "sonner"
import { createInventoryHold, releaseInventoryHold } from "@/app/(admin)/actions"
import type { InventoryHoldWithDetails, InventoryPackageOption } from "@/lib/admin/queries"
import type { PortalProfile } from "@/lib/types/profile"

function agentPrimaryLabel(a: PortalProfile): string {
  return (a.company_name?.trim() || a.full_name?.trim() || a.email || "Agent").trim()
}

export function InventoryAdminClient({
  holds,
  agents,
  packages,
}: {
  holds: InventoryHoldWithDetails[]
  agents: PortalProfile[]
  packages: InventoryPackageOption[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const [packageSearch, setPackageSearch] = useState("")
  const [packageId, setPackageId] = useState(packages[0]?.id ?? "")

  const [agentSearch, setAgentSearch] = useState("")
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "")

  const [qty, setQty] = useState("1")
  const [holdHours, setHoldHours] = useState("24")
  const [note, setNote] = useState("")

  const activeHolds = useMemo(() => holds.filter((h) => !h.released_at), [holds])
  const releasedHolds = useMemo(() => holds.filter((h) => h.released_at), [holds])

  const sortedPackages = useMemo(
    () =>
      [...packages].sort(
        (a, b) => a.race_name.localeCompare(b.race_name) || a.name.localeCompare(b.name),
      ),
    [packages],
  )

  const filteredPackages = useMemo(() => {
    const q = packageSearch.trim().toLowerCase()
    if (!q) return sortedPackages
    return sortedPackages.filter((p) => {
      const hay = [p.id, p.name, p.race_name, p.circuit, p.date_range, p.location].join(" ").toLowerCase()
      return hay.includes(q)
    })
  }, [sortedPackages, packageSearch])

  const sortedAgents = useMemo(
    () =>
      [...agents].sort(
        (a, b) => agentPrimaryLabel(a).localeCompare(agentPrimaryLabel(b)) || a.email.localeCompare(b.email),
      ),
    [agents],
  )

  const filteredAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase()
    if (!q) return sortedAgents
    return sortedAgents.filter((a) => {
      const hay = [a.id, a.email, a.full_name, a.company_name].join(" ").toLowerCase()
      return hay.includes(q)
    })
  }, [sortedAgents, agentSearch])

  const selectedPackage = useMemo(() => packages.find((p) => p.id === packageId), [packages, packageId])
  const selectedAgent = useMemo(() => agents.find((a) => a.id === agentId), [agents, agentId])

  useEffect(() => {
    if (packages.length === 0) return
    if (!packages.some((p) => p.id === packageId)) {
      setPackageId(packages[0].id)
    }
  }, [packages, packageId])

  useEffect(() => {
    if (agents.length === 0) return
    if (!agents.some((a) => a.id === agentId)) {
      setAgentId(agents[0].id)
    }
  }, [agents, agentId])

  function submitHold(e: React.FormEvent) {
    e.preventDefault()
    if (!packageId || !agentId) {
      toast.error("Choose a package and an agent.")
      return
    }
    const hours = Math.floor(Number(holdHours))
    if (!Number.isFinite(hours) || hours < 1 || hours > 720) {
      toast.error("Hold duration must be between 1 and 720 hours.")
      return
    }
    start(async () => {
      const res = await createInventoryHold({
        packageId,
        agentProfileId: agentId,
        quantity: Number(qty),
        note: note.trim() || null,
        holdHours: hours,
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

  const sellable =
    selectedPackage != null ? Math.max(0, selectedPackage.qty_available - selectedPackage.qty_held) : null

  return (
    <div className="space-y-10">
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4 max-w-xl">
        <h2 className="text-base font-semibold text-foreground">Create hold</h2>

        <form onSubmit={(e) => void submitHold(e)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Package</label>
            {packages.length === 0 ? (
              <p className="text-sm text-amber-700 dark:text-amber-300 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                No packages with inventory. Add stock from the inventory page first.
              </p>
            ) : (
              <>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={packageSearch}
                    onChange={(e) => setPackageSearch(e.target.value)}
                    placeholder="Search package or race…"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm"
                  />
                </div>
                <select
                  value={packageId}
                  onChange={(e) => setPackageId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm"
                >
                  <option value="">Select package…</option>
                  {filteredPackages.map((p) => {
                    const s = Math.max(0, p.qty_available - p.qty_held)
                    return (
                      <option key={p.id} value={p.id}>
                        {p.race_name} — {p.name} ({s} avail.)
                      </option>
                    )
                  })}
                </select>
                {selectedPackage ? (
                  <p className="text-xs text-muted-foreground mt-2">
                    Sellable now: <span className="font-semibold text-foreground tabular-nums">{sellable}</span>
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Trade partner</label>
            {agents.length === 0 ? (
              <p className="text-sm text-amber-700 dark:text-amber-300 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                No approved agents yet.
              </p>
            ) : (
              <>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={agentSearch}
                    onChange={(e) => setAgentSearch(e.target.value)}
                    placeholder="Search company or email…"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm"
                  />
                </div>
                <select
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm"
                >
                  <option value="">Select agent…</option>
                  {filteredAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {agentPrimaryLabel(a)} ({a.email})
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          <label className="block text-xs text-muted-foreground">
            Quantity
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="mt-1.5 w-full max-w-[160px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>

          <label className="block text-xs text-muted-foreground">
            Hold duration
            <select
              value={holdHours}
              onChange={(e) => setHoldHours(e.target.value)}
              className="mt-1.5 w-full max-w-[220px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              <option value="6">6 hours</option>
              <option value="12">12 hours</option>
              <option value="24">24 hours</option>
              <option value="48">48 hours</option>
              <option value="72">72 hours</option>
              <option value="168">7 days</option>
            </select>
          </label>

          <label className="block text-xs text-muted-foreground">
            Note (optional)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
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

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">Active holds ({activeHolds.length})</h2>
        {activeHolds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active holds.</p>
        ) : (
          <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
            {activeHolds.map((h) => (
              <div key={h.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">{h.package_name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {h.package_event_summary}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {h.agent_company || h.agent_email} · {h.quantity} unit{h.quantity === 1 ? "" : "s"}
                    {h.expires_at ? ` · expires ${new Date(h.expires_at).toLocaleString()}` : ""}
                  </p>
                  {h.note ? <p className="text-xs text-muted-foreground mt-1">{h.note}</p> : null}
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => release(h.id)}
                  className="shrink-0 text-sm font-medium text-destructive hover:underline disabled:opacity-50"
                >
                  Release
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {releasedHolds.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Recently released ({releasedHolds.length})</h2>
          <div className="rounded-xl border border-dashed border-border divide-y divide-border overflow-hidden">
            {releasedHolds.slice(0, 10).map((h) => (
              <div key={h.id} className="px-4 py-2.5 text-sm text-muted-foreground">
                {h.package_name} — {h.agent_company || h.agent_email} ({h.quantity})
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
