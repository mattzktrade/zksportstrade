"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createInventoryHold, releaseInventoryHold } from "@/app/(admin)/actions"
import type { InventoryHoldWithDetails, InventoryPackageOption } from "@/lib/admin/queries"
import type { PortalProfile } from "@/lib/types/profile"

function optionMatchesSearch(p: InventoryPackageOption, q: string): boolean {
  if (!q.trim()) return true
  const s = q.trim().toLowerCase()
  const hay = [p.id, p.name, p.race_name, p.circuit, p.date_range, p.location].join(" ").toLowerCase()
  return hay.includes(s)
}

function optionPrimaryLabel(p: InventoryPackageOption): string {
  return `${p.race_name} — ${p.name}`
}

function optionSecondaryLabel(p: InventoryPackageOption): string {
  const bits: string[] = []
  if (p.date_range?.trim()) bits.push(p.date_range.trim())
  if (p.circuit?.trim()) bits.push(p.circuit.trim())
  else if (p.location?.trim()) bits.push(p.location.trim())
  return bits.join(" · ")
}

function agentPrimaryLabel(a: PortalProfile): string {
  return (a.company_name?.trim() || a.full_name?.trim() || a.email || "Agent").trim()
}

function agentMatchesSearch(a: PortalProfile, q: string): boolean {
  if (!q.trim()) return true
  const s = q.trim().toLowerCase()
  const hay = [a.id, a.email, a.full_name, a.company_name].join(" ").toLowerCase()
  return hay.includes(s)
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
  const [packageId, setPackageId] = useState(packages[0]?.id ?? "")
  const [packageSearch, setPackageSearch] = useState("")
  const [packageListOpen, setPackageListOpen] = useState(false)
  const packagePickerRef = useRef<HTMLDivElement>(null)

  const [agentSearch, setAgentSearch] = useState("")
  const [agentListOpen, setAgentListOpen] = useState(false)
  const agentPickerRef = useRef<HTMLDivElement>(null)

  const [agentId, setAgentId] = useState(agents[0]?.id ?? "")
  const [qty, setQty] = useState("1")
  const [holdHours, setHoldHours] = useState("24")
  const [note, setNote] = useState("")

  const activeHolds = useMemo(() => holds.filter((h) => !h.released_at), [holds])
  const releasedHolds = useMemo(() => holds.filter((h) => h.released_at), [holds])

  const filteredPackages = useMemo(
    () => packages.filter((p) => optionMatchesSearch(p, packageSearch)),
    [packages, packageSearch],
  )

  const selectedPackage = useMemo(() => packages.find((p) => p.id === packageId), [packages, packageId])

  const sortedAgents = useMemo(
    () => [...agents].sort((a, b) => agentPrimaryLabel(a).localeCompare(agentPrimaryLabel(b)) || a.email.localeCompare(b.email)),
    [agents],
  )

  const filteredAgents = useMemo(
    () => sortedAgents.filter((a) => agentMatchesSearch(a, agentSearch)),
    [sortedAgents, agentSearch],
  )

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

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (packagePickerRef.current && !packagePickerRef.current.contains(t)) {
        setPackageListOpen(false)
      }
      if (agentPickerRef.current && !agentPickerRef.current.contains(t)) {
        setAgentListOpen(false)
      }
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [])

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
        <p className="text-sm text-muted-foreground">
          Reserves units against an agent for a specific catalog package (inventory row required). Stock checks run in
          the database; held counts must stay within capacity. Holds auto-release after the duration you set if the
          agent does not check out (also released every 15 minutes via server cron when configured).
        </p>
        <form onSubmit={(e) => void submitHold(e)} className="space-y-3">
          <div ref={packagePickerRef} className="block text-xs text-muted-foreground">
            <span className="block">Package</span>
            {packages.length === 0 ? (
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-300 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                No packages with an inventory row. Add inventory from the catalog page first.
              </p>
            ) : (
              <>
                <input
                  type="search"
                  value={packageSearch}
                  onChange={(e) => {
                    setPackageSearch(e.target.value)
                    setPackageListOpen(true)
                  }}
                  onFocus={() => setPackageListOpen(true)}
                  placeholder="Search event, hospitality name, circuit, id…"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  aria-label="Search packages for hold"
                  aria-controls="inventory-package-list"
                  aria-expanded={packageListOpen}
                />
                {packageListOpen && (
                  <ul
                    id="inventory-package-list"
                    role="listbox"
                    className="mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-card shadow-md z-20"
                  >
                    {filteredPackages.length === 0 ? (
                      <li className="px-3 py-2 text-sm text-muted-foreground">No packages match this search.</li>
                    ) : (
                      filteredPackages.map((p) => {
                        const active = p.id === packageId
                        const s = Math.max(0, p.qty_available - p.qty_held)
                        return (
                          <li key={p.id} role="option" aria-selected={active}>
                            <button
                              type="button"
                              onClick={() => {
                                setPackageId(p.id)
                                setPackageSearch("")
                                setPackageListOpen(false)
                              }}
                              className={`w-full text-left px-3 py-2.5 text-sm border-b border-border last:border-0 transition-colors ${
                                active ? "bg-primary/10" : "hover:bg-muted/80"
                              }`}
                            >
                              <div className="font-medium text-foreground leading-snug">{optionPrimaryLabel(p)}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">{optionSecondaryLabel(p)}</div>
                              <div className="text-[11px] font-mono text-muted-foreground mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                                <span>{p.id}</span>
                                <span className="text-foreground/80">
                                  Sellable {s} / cap {p.qty_available} (held {p.qty_held})
                                </span>
                              </div>
                            </button>
                          </li>
                        )
                      })
                    )}
                  </ul>
                )}
                {selectedPackage && (
                  <div className="mt-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm space-y-0.5">
                    <div className="font-medium text-foreground">{optionPrimaryLabel(selectedPackage)}</div>
                    <div className="text-xs text-muted-foreground">{optionSecondaryLabel(selectedPackage)}</div>
                    <div className="text-[11px] font-mono text-muted-foreground pt-0.5">{selectedPackage.id}</div>
                    <div className="text-xs text-foreground pt-1">
                      Sellable now: <span className="font-semibold tabular-nums">{sellable}</span> (capacity{" "}
                      {selectedPackage.qty_available}, held {selectedPackage.qty_held})
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          <div ref={agentPickerRef} className="block text-xs text-muted-foreground">
            <span className="block">Agent</span>
            {agents.length === 0 ? (
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-300 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                No approved agents yet. Approve agent accounts first.
              </p>
            ) : (
              <>
                <input
                  type="search"
                  value={agentSearch}
                  onChange={(e) => {
                    setAgentSearch(e.target.value)
                    setAgentListOpen(true)
                  }}
                  onFocus={() => setAgentListOpen(true)}
                  placeholder="Search company, name, email, id…"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  aria-label="Search agents for hold"
                  aria-controls="inventory-agent-list"
                  aria-expanded={agentListOpen}
                />
                {agentListOpen && (
                  <ul
                    id="inventory-agent-list"
                    role="listbox"
                    className="mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-card shadow-md z-20"
                  >
                    {filteredAgents.length === 0 ? (
                      <li className="px-3 py-2 text-sm text-muted-foreground">No agents match this search.</li>
                    ) : (
                      filteredAgents.map((a) => {
                        const active = a.id === agentId
                        return (
                          <li key={a.id} role="option" aria-selected={active}>
                            <button
                              type="button"
                              onClick={() => {
                                setAgentId(a.id)
                                setAgentSearch("")
                                setAgentListOpen(false)
                              }}
                              className={`w-full text-left px-3 py-2.5 text-sm border-b border-border last:border-0 transition-colors ${
                                active ? "bg-primary/10" : "hover:bg-muted/80"
                              }`}
                            >
                              <div className="font-medium text-foreground leading-snug">{agentPrimaryLabel(a)}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">{a.email}</div>
                              {a.company_name?.trim() &&
                              a.full_name?.trim() &&
                              a.full_name.trim().toLowerCase() !== a.company_name.trim().toLowerCase() ? (
                                <div className="text-[11px] text-muted-foreground mt-0.5">{a.full_name}</div>
                              ) : null}
                              <div className="text-[11px] font-mono text-muted-foreground mt-1">{a.id}</div>
                            </button>
                          </li>
                        )
                      })
                    )}
                  </ul>
                )}
                {selectedAgent && (
                  <div className="mt-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm space-y-0.5">
                    <div className="font-medium text-foreground">{agentPrimaryLabel(selectedAgent)}</div>
                    <div className="text-xs text-muted-foreground">{selectedAgent.email}</div>
                    <div className="text-[11px] font-mono text-muted-foreground pt-0.5">{selectedAgent.id}</div>
                  </div>
                )}
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
              className="mt-1 w-full max-w-[160px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Hold duration (hours until auto-release)
            <select
              value={holdHours}
              onChange={(e) => setHoldHours(e.target.value)}
              className="mt-1 w-full max-w-[220px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              <option value="6">6 hours</option>
              <option value="12">12 hours</option>
              <option value="24">24 hours</option>
              <option value="48">48 hours</option>
              <option value="72">72 hours</option>
              <option value="168">7 days (168 hours)</option>
            </select>
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
  holds: InventoryHoldWithDetails[]
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
            <th className="p-3 font-medium whitespace-nowrap">Expires</th>
            <th className="p-3 font-medium">Created</th>
            {!released && <th className="p-3 font-medium w-[120px]" />}
            {released && <th className="p-3 font-medium">Released</th>}
          </tr>
        </thead>
        <tbody>
          {holds.map((h) => (
            <tr key={h.id} className="border-b border-border last:border-0">
              <td className="p-3 min-w-[220px]">
                {h.package_event_summary ? (
                  <div className="text-sm font-medium text-foreground leading-snug">{h.package_event_summary}</div>
                ) : null}
                <div
                  className={
                    h.package_event_summary
                      ? "text-xs text-muted-foreground mt-1 leading-snug"
                      : "font-medium text-foreground leading-snug"
                  }
                >
                  {h.package_name}
                </div>
                <div className="text-[11px] font-mono text-muted-foreground mt-1">{h.package_id}</div>
              </td>
              <td className="p-3 text-muted-foreground">
                <div>{h.agent_company || h.agent_email}</div>
                <div className="text-xs">{h.agent_email}</div>
              </td>
              <td className="p-3 tabular-nums">{h.quantity}</td>
              <td className="p-3 text-muted-foreground max-w-[200px]">{h.note ?? "—"}</td>
              <td className="p-3 text-muted-foreground whitespace-nowrap text-xs">
                {h.expires_at ? new Date(h.expires_at).toLocaleString() : "—"}
              </td>
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
