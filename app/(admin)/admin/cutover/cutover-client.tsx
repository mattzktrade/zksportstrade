"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, Download, History, PlayCircle, RotateCcw, Search, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import type {
  CutoverDealRow,
  CutoverEventRow,
  CutoverPackageRow,
  CutoverRun,
} from "@/lib/admin/cutover"
import { AdminPageHeader, AdminPanel, AdminStatCard, AdminStats, StatusPill } from "@/components/admin/admin-page-kit"
import {
  createCutoverBaseline,
  decideWonReconciliation,
  prepareCutoverOpenDeal,
  rollbackCutoverRun,
  setCutoverPilotRace,
  setCutoverOpeningBalance,
  setCutoverStatus,
  updateCutoverPackage,
} from "./actions"
import { usePersistedAdminFilters } from "@/lib/admin/use-persisted-admin-filters"

function tone(status: string): "green" | "amber" | "red" | "blue" | "purple" | "gray" {
  if (["verified", "reconciled", "prepared", "pilot_passed", "approved"].includes(status)) return "green"
  if (["blocked", "rollback_required", "rolled_back"].includes(status)) return "red"
  if (["pending", "baselined"].includes(status)) return "amber"
  if (["parallel_run", "pilot_running"].includes(status)) return "blue"
  if (status === "pilot_ready") return "purple"
  return "gray"
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

const NEXT_STATUSES: Record<string, string[]> = {
  baselined: ["parallel_run", "rollback_required", "cancelled"],
  parallel_run: ["pilot_ready", "rollback_required", "cancelled"],
  pilot_ready: ["pilot_running", "parallel_run", "rollback_required"],
  pilot_running: ["pilot_passed", "rollback_required"],
  pilot_passed: ["approved", "rollback_required"],
}

export function CutoverClient({
  runs,
  selectedRun,
  packages,
  deals,
  events,
  races,
}: {
  runs: CutoverRun[]
  selectedRun: CutoverRun | null
  packages: CutoverPackageRow[]
  deals: CutoverDealRow[]
  events: CutoverEventRow[]
  races: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [listState, setListState] = usePersistedAdminFilters("zk-admin-cutover-filters-v1", {
    search: "",
    tab: "inventory" as "inventory" | "open" | "won" | "activity" | "recovery",
  })
  const { search, tab } = listState
  const setTab = (tab: typeof listState.tab) => setListState((current) => ({ ...current, tab }))
  const [name, setName] = useState(`Native pilot ${new Date().toISOString().slice(0, 10)}`)
  const [pilotRaceId, setPilotRaceId] = useState("")
  const [notes, setNotes] = useState("")

  function run(action: () => Promise<{ ok: boolean; message: string; runId?: string }>) {
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      if (result.runId) {
        router.push(`/admin/cutover?run=${result.runId}`)
      } else {
        router.refresh()
      }
    })
  }

  const q = search.trim().toLowerCase()
  const packageRows = packages.filter((row) =>
    !q || `${row.packageName} ${row.packageId}`.toLowerCase().includes(q),
  )
  const openDeals = deals.filter((row) => row.type === "open_pipeline")
  const wonDeals = deals.filter((row) => row.type === "historical_won")
  const driftRows = packages.filter(
    (row) => row.availableDrift !== 0 || row.heldDrift !== 0 || row.sellableDrift !== 0,
  )
  const unresolvedPackages = packages.filter(
    (row) => row.openingBalanceStatus === "pending" || row.supplierStatus === "pending",
  )
  const unresolvedDeals = deals.filter((row) => ["pending", "blocked"].includes(row.status))

  function exportReport() {
    if (!selectedRun) return
    const rows = [
      ["Package ID", "Package", "Baseline available", "Current available", "Available drift", "Baseline sellable", "Current sellable", "Sellable drift", "Opening balance", "Supplier status"],
      ...packages.map((row) => [
        row.packageId, row.packageName, row.baselineAvailable, row.currentAvailable,
        row.availableDrift, row.baselineSellable, row.currentSellable,
        row.sellableDrift, row.openingBalanceStatus, row.supplierStatus,
      ]),
    ]
    const blob = new Blob([rows.map((row) => row.join(",")).join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `cutover-${selectedRun.name.replace(/\W+/g, "-")}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (!selectedRun) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-5">
        <AdminPageHeader title="Controlled Cutover" description="Create an additive baseline before preparing any imported pipeline or pilot inventory." />
        <AdminPanel>
          <div className="space-y-4 p-5">
            <div className="rounded-md bg-amber-50 p-4 text-[10px] leading-5 text-amber-900">
              This captures evidence only. It does not delete Salesforce data, send messages, create invoices, or alter stock.
            </div>
            <label><span className="mb-1 block text-[9px] text-slate-500">Run name</span><input value={name} onChange={(event) => setName(event.target.value)} className="h-10 w-full rounded-md border px-3 text-[11px]" /></label>
            <label><span className="mb-1 block text-[9px] text-slate-500">Pilot event (optional initially)</span><select value={pilotRaceId} onChange={(event) => setPilotRaceId(event.target.value)} className="h-10 w-full rounded-md border bg-white px-3 text-[11px]"><option value="">Choose later</option>{races.map((race) => <option key={race.id} value={race.id}>{race.name}</option>)}</select></label>
            <label><span className="mb-1 block text-[9px] text-slate-500">Notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-24 w-full rounded-md border p-3 text-[10px]" /></label>
            <button disabled={pending || !name.trim()} onClick={() => run(() => createCutoverBaseline({ name, pilotRaceId, notes }))} className="h-10 w-full rounded-md bg-primary text-[10px] font-semibold text-white disabled:opacity-50">Capture baseline</button>
          </div>
        </AdminPanel>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1540px] space-y-3 p-3 sm:p-4 lg:p-5">
      <AdminPageHeader
        title="Controlled Cutover"
        description="Parallel-run reconciliation, pilot evidence, sign-off and scoped rollback."
        action={<button onClick={exportReport} className="flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-[9px] font-semibold"><Download className="h-3.5 w-3.5" /> Export report</button>}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select value={selectedRun.id} onChange={(event) => router.push(`/admin/cutover?run=${event.target.value}`)} className="h-9 min-w-0 w-full sm:min-w-[240px] sm:w-auto rounded-md border bg-white px-3 text-[10px]">{runs.map((runRow) => <option key={runRow.id} value={runRow.id}>{runRow.name}</option>)}</select>
        <StatusPill tone={tone(selectedRun.status)}>{label(selectedRun.status)}</StatusPill>
        {["baselined", "parallel_run"].includes(selectedRun.status) ? (
          <select
            value={selectedRun.pilotRaceId ?? ""}
            disabled={pending}
            onChange={(event) => {
              if (event.target.value) {
                run(() =>
                  setCutoverPilotRace({
                    runId: selectedRun.id,
                    raceId: event.target.value,
                  }),
                )
              }
            }}
            className="h-9 rounded-md border bg-white px-3 text-[9px]"
          >
            <option value="">Select pilot event...</option>
            {races.map((race) => <option key={race.id} value={race.id}>{race.name}</option>)}
          </select>
        ) : (
          <span className="text-[9px] text-slate-400">Pilot: {selectedRun.pilotRaceName || "not selected"}</span>
        )}
        <select disabled={pending || !(NEXT_STATUSES[selectedRun.status]?.length)} value="" onChange={(event) => { if (!event.target.value) return; const note = window.prompt(`Reason for moving to ${label(event.target.value)}:`) ?? ""; run(() => setCutoverStatus({ runId: selectedRun.id, status: event.target.value, note })) }} className="ml-auto h-9 rounded-md border bg-white px-3 text-[10px] disabled:opacity-50"><option value="">Advance status...</option>{(NEXT_STATUSES[selectedRun.status] ?? []).map((status) => <option key={status} value={status}>{label(status)}</option>)}</select>
      </div>

      <AdminStats className="sm:grid-cols-2 xl:grid-cols-5">
        <AdminStatCard icon={ShieldCheck} value={packages.length} label="Packages baselined" tone="blue" />
        <AdminStatCard icon={AlertTriangle} value={driftRows.length} label="Stock drift rows" tone={driftRows.length ? "red" : "green"} />
        <AdminStatCard icon={History} value={unresolvedPackages.length} label="Package decisions" tone="amber" />
        <AdminStatCard icon={PlayCircle} value={openDeals.filter((row) => row.status === "prepared").length} label="Open deals prepared" tone="green" />
        <AdminStatCard icon={AlertTriangle} value={unresolvedDeals.length} label="Deal decisions" tone="red" />
      </AdminStats>

      <AdminPanel>
        <div className="flex overflow-x-auto border-b px-3">
          {[
            ["inventory", "Inventory parity", packages.length],
            ["open", "Open opportunities", openDeals.length],
            ["won", "Historical won", wonDeals.length],
            ["activity", "Audit activity", events.length],
            ["recovery", "Rollback & recovery", 0],
          ].map(([value, text, count]) => <button key={String(value)} onClick={() => setTab(value as typeof tab)} className={`whitespace-nowrap border-b-2 px-4 py-3 text-[9px] font-semibold ${tab === value ? "border-primary text-primary" : "border-transparent text-slate-500"}`}>{text}{Number(count) ? ` · ${count}` : ""}</button>)}
        </div>

        {tab === "inventory" ? (
          <>
            <div className="border-b p-3"><label className="relative block max-w-lg"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setListState((current) => ({ ...current, search: event.target.value }))} placeholder="Search packages..." className="h-9 w-full rounded-md border pl-9 pr-3 text-[10px]" /></label></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[1200px] text-left"><thead className="bg-[#fafbfc] text-[8px] uppercase text-slate-400"><tr><th className="px-4 py-2.5">Package</th><th className="px-4 py-2.5">Available baseline → live</th><th className="px-4 py-2.5">Held baseline → live</th><th className="px-4 py-2.5">Sellable baseline → live</th><th className="px-4 py-2.5">Cost layers</th><th className="px-4 py-2.5">Opening balance</th><th className="px-4 py-2.5">Supplier source</th><th className="px-4 py-2.5">Action</th></tr></thead><tbody className="divide-y text-[9px]">
              {packageRows.map((row) => <tr key={row.id} className={row.availableDrift || row.heldDrift || row.sellableDrift ? "bg-amber-50/50" : ""}><td className="px-4 py-3"><p className="font-semibold">{row.packageName}</p><p className="text-[8px] text-slate-400">{row.packageId}</p></td><td className="px-4 py-3">{row.baselineAvailable} → {row.currentAvailable} <span className={row.availableDrift ? "text-amber-700" : "text-emerald-700"}>({row.availableDrift >= 0 ? "+" : ""}{row.availableDrift})</span></td><td className="px-4 py-3">{row.baselineHeld} → {row.currentHeld} ({row.heldDrift >= 0 ? "+" : ""}{row.heldDrift})</td><td className="px-4 py-3">{row.baselineSellable} → {row.currentSellable} ({row.sellableDrift >= 0 ? "+" : ""}{row.sellableDrift})</td><td className="px-4 py-3">{row.currentLayerUnits}<p className="text-[8px] text-slate-400">{row.unassignedCostUnits} unassigned</p></td><td className="px-4 py-3"><StatusPill tone={tone(row.openingBalanceStatus)}>{label(row.openingBalanceStatus)}</StatusPill></td><td className="px-4 py-3"><StatusPill tone={tone(row.supplierStatus)}>{label(row.supplierStatus)}</StatusPill></td><td className="px-4 py-3"><div className="flex gap-1"><button disabled={pending} onClick={() => { const raw = window.prompt("Verified live quantity:", String(row.currentAvailable)); if (raw == null) return; const quantity = Number(raw); const reason = window.prompt("Opening-balance evidence/reason:") || ""; if (!reason) return; run(() => setCutoverOpeningBalance({ runId: selectedRun.id, packageId: row.packageId, quantity, supplierStatus: row.supplierStatus, reason })) }} className="rounded border px-2 py-1 text-[8px] font-semibold">Set balance</button><button disabled={pending} onClick={() => { const note = window.prompt("Supplier reconciliation evidence:") || ""; if (!note) return; run(() => updateCutoverPackage({ runId: selectedRun.id, packageId: row.packageId, openingBalanceStatus: row.openingBalanceStatus, supplierStatus: "reconciled", note })) }} className="rounded border px-2 py-1 text-[8px] font-semibold">Supplier ✓</button></div></td></tr>)}
            </tbody></table></div>
          </>
        ) : null}

        {tab === "open" ? <DealTable rows={openDeals} actionLabel="Prepare reservation" onAction={(row) => run(() => prepareCutoverOpenDeal({ runId: selectedRun.id, dealId: row.dealId }))} /> : null}
        {tab === "won" ? <DealTable rows={wonDeals} actionLabel="Decide" onAction={(row) => { const reason = window.prompt("Reconciliation evidence/reason:") || ""; if (!reason) return; const ignored = window.confirm("OK = reconciled. Cancel = ignored."); run(() => decideWonReconciliation({ runId: selectedRun.id, dealId: row.dealId, status: ignored ? "reconciled" : "ignored", reason })) }} /> : null}
        {tab === "activity" ? <ActivityList rows={events} /> : null}
        {tab === "recovery" ? <div className="space-y-4 p-5"><div className="rounded-md bg-red-50 p-4 text-[10px] leading-5 text-red-800"><strong>Scoped automatic rollback:</strong> only active reservations created by this cutover run are released. Opening balances, purchases, orders, invoices, imported records and Salesforce data are never automatically reversed or deleted.</div><ol className="list-decimal space-y-2 pl-5 text-[10px] text-slate-600"><li>Stop the pilot and record the incident.</li><li>Export this reconciliation report and audit trail.</li><li>Release cutover-created reservations using the action below.</li><li>Review opening-balance ledger entries manually; only adjust with a new evidenced correction.</li><li>Return runtime mode to the previously approved deployment configuration if production cutover has occurred.</li><li>Reconcile orders, invoices and Xero before resuming.</li></ol><button disabled={pending || ["approved", "rolled_back"].includes(selectedRun.status)} onClick={() => { const reason = window.prompt("Rollback reason (required):") || ""; if (!reason || !window.confirm("Release only reservations created by this cutover run?")) return; run(() => rollbackCutoverRun({ runId: selectedRun.id, reason })) }} className="flex h-10 items-center gap-2 rounded-md border border-red-200 px-4 text-[9px] font-semibold text-red-700 disabled:opacity-50"><RotateCcw className="h-4 w-4" /> Roll back cutover-created reservations</button></div> : null}
      </AdminPanel>
    </div>
  )
}

function DealTable({ rows, actionLabel, onAction }: { rows: CutoverDealRow[]; actionLabel: string; onAction: (row: CutoverDealRow) => void }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left"><thead className="bg-[#fafbfc] text-[8px] uppercase text-slate-400"><tr><th className="px-4 py-2.5">Deal</th><th className="px-4 py-2.5">Account</th><th className="px-4 py-2.5">Stage</th><th className="px-4 py-2.5">Expected</th><th className="px-4 py-2.5">Reserved</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Evidence</th><th className="px-4 py-2.5">Action</th></tr></thead><tbody className="divide-y text-[9px]">{rows.map((row) => <tr key={row.id}><td className="px-4 py-3 font-semibold">{row.reference}</td><td className="px-4 py-3">{row.accountName}</td><td className="px-4 py-3">{label(row.stage)}</td><td className="px-4 py-3">{row.expectedQuantity}</td><td className="px-4 py-3">{row.reservedQuantity}</td><td className="px-4 py-3"><StatusPill tone={tone(row.status)}>{label(row.status)}</StatusPill></td><td className="max-w-[260px] px-4 py-3 text-slate-500">{row.reason || "—"}</td><td className="px-4 py-3"><button onClick={() => onAction(row)} disabled={row.status === "reconciled" || row.status === "ignored"} className="rounded border px-2 py-1 text-[8px] font-semibold disabled:opacity-40">{actionLabel}</button></td></tr>)}{rows.length === 0 ? <tr><td colSpan={8} className="p-10 text-center text-slate-400">No rows in this queue.</td></tr> : null}</tbody></table></div>
}

function ActivityList({ rows }: { rows: CutoverEventRow[] }) {
  return <div className="divide-y">{rows.map((row) => <div key={row.id} className="flex gap-3 px-4 py-3 text-[9px]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="flex-1"><p className="font-medium">{row.summary}</p><p className="mt-0.5 text-[8px] text-slate-400">{row.actorName || "System"} · {new Date(row.createdAt).toLocaleString("en-GB")}</p></div><StatusPill tone="gray">{label(row.eventType)}</StatusPill></div>)}{rows.length === 0 ? <p className="p-10 text-center text-[9px] text-slate-400">No activity yet.</p> : null}</div>
}

