"use client"

import { useMemo, useState } from "react"
import { CircleDollarSign, Download, Target, TrendingUp, Users } from "lucide-react"
import type { WorkflowOrderRow } from "@/lib/admin/workflow-views"
import { AdminPageHeader, AdminPanel, AdminStatCard, AdminStats, AdminDesktopTable, AdminMobileList, StatusPill } from "@/components/admin/admin-page-kit"

type SourceAggregate = {
  source: string
  rows: WorkflowOrderRow[]
  monthRevenue: number
  monthProfit: number
  ytdRevenue: number
  ytdProfit: number
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function sourceFor(row: WorkflowOrderRow): string {
  if (row.channel === "trade_portal" || row.dealSource === "portal") return "Portal"
  if (row.channel === "wix" || row.dealSource === "website") return "Website"
  if (row.dealSource === "referral") return "Referral"
  if (
    row.channel === "native_deal" ||
    row.channel === "admin" ||
    row.channel === "salesforce_import" ||
    row.dealSource === "offline"
  ) {
    return "Offline"
  }
  return "Other"
}

export function SalesSourceTrackerClient({ rows }: { rows: WorkflowOrderRow[] }) {
  const years = useMemo(
    () => [...new Set(rows.map((row) => new Date(row.createdAt).getUTCFullYear()))].sort((a, b) => b - a),
    [rows],
  )
  const now = new Date()
  const [year, setYear] = useState(years[0] ?? now.getUTCFullYear())
  const [month, setMonth] = useState(now.getUTCMonth())
  const [selectedSource, setSelectedSource] = useState("Portal")
  const active = rows.filter(
    (row) => row.orderStatus !== "cancelled" && row.currency === "USD",
  )
  const aggregates = useMemo(() => {
    const map = new Map<string, SourceAggregate>()
    for (const row of active) {
      const created = new Date(row.createdAt)
      if (created.getUTCFullYear() !== year) continue
      const source = sourceFor(row)
      const aggregate = map.get(source) ?? {
        source,
        rows: [],
        monthRevenue: 0,
        monthProfit: 0,
        ytdRevenue: 0,
        ytdProfit: 0,
      }
      aggregate.rows.push(row)
      aggregate.ytdRevenue += row.total
      aggregate.ytdProfit += row.grossProfit ?? 0
      if (created.getUTCMonth() === month) {
        aggregate.monthRevenue += row.total
        aggregate.monthProfit += row.grossProfit ?? 0
      }
      map.set(source, aggregate)
    }
    return [...map.values()].sort((a, b) => b.ytdRevenue - a.ytdRevenue)
  }, [active, year, month])
  const totalMonthRevenue = aggregates.reduce((sum, row) => sum + row.monthRevenue, 0)
  const totalMonthProfit = aggregates.reduce((sum, row) => sum + row.monthProfit, 0)
  const totalYtdRevenue = aggregates.reduce((sum, row) => sum + row.ytdRevenue, 0)
  const totalYtdProfit = aggregates.reduce((sum, row) => sum + row.ytdProfit, 0)
  const selected = aggregates.find((row) => row.source === selectedSource) ?? aggregates[0]
  const topEvents = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of selected?.rows ?? []) {
      map.set(row.eventPackage, (map.get(row.eventPackage) ?? 0) + row.total)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [selected])
  const monthly = Array.from({ length: 12 }, (_, index) =>
    active
      .filter((row) => {
        const created = new Date(row.createdAt)
        return created.getUTCFullYear() === year && created.getUTCMonth() === index
      })
      .reduce((sum, row) => sum + row.total, 0),
  )
  const maxMonthly = Math.max(...monthly, 1)

  function exportCsv() {
    const lines = [
      ["Source", "Deals", "Month revenue", "Month gross profit", "YTD revenue", "YTD gross profit"],
      ...aggregates.map((row) => [
        row.source,
        row.rows.length,
        row.monthRevenue,
        row.monthProfit,
        row.ytdRevenue,
        row.ytdProfit,
      ]),
    ]
    const blob = new Blob([lines.map((line) => line.join(",")).join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `sales-by-source-${year}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-[1540px] space-y-3 p-3 sm:p-4 lg:p-5">
      <AdminPageHeader
        title="Sales Tracker"
        description="Monitor confirmed native orders and imported historical won deals by sales source."
        action={
          <button onClick={exportCsv} className="flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-[9px] font-semibold">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        }
      />
      <AdminStats className="sm:grid-cols-2 xl:grid-cols-5">
        <AdminStatCard icon={CircleDollarSign} value={money(totalMonthRevenue)} label="This month revenue" tone="blue" />
        <AdminStatCard icon={TrendingUp} value={money(totalMonthProfit)} label="This month gross profit" tone="green" />
        <AdminStatCard icon={CircleDollarSign} value={money(totalYtdRevenue)} label="YTD revenue" />
        <AdminStatCard icon={Target} value={money(totalYtdProfit)} label="YTD gross profit" tone="green" />
        <AdminStatCard icon={Users} value={aggregates[0]?.source ?? "—"} label="Top-performing source" />
      </AdminStats>

      <div className="flex flex-wrap gap-2">
        <select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="h-9 rounded-md border bg-white px-3 text-[10px]">
          {Array.from({ length: 12 }, (_, index) => <option key={index} value={index}>{new Date(Date.UTC(2026, index, 1)).toLocaleDateString("en-GB", { month: "long" })}</option>)}
        </select>
        <select value={year} onChange={(event) => setYear(Number(event.target.value))} className="h-9 rounded-md border bg-white px-3 text-[10px]">
          {(years.length ? years : [now.getUTCFullYear()]).map((value) => <option key={value}>{value}</option>)}
        </select>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <div className="space-y-3">
          <AdminPanel>
            <AdminDesktopTable>
              <table className="w-full min-w-[920px] text-left">
                <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-slate-400">
                  <tr><th className="px-4 py-2.5">Source</th><th className="px-4 py-2.5 text-right">Deals</th><th className="px-4 py-2.5 text-right">Month revenue</th><th className="px-4 py-2.5 text-right">Month GP</th><th className="px-4 py-2.5 text-right">YTD revenue</th><th className="px-4 py-2.5 text-right">YTD GP</th><th className="px-4 py-2.5 text-right">Average order</th></tr>
                </thead>
                <tbody className="divide-y text-[10px]">
                  {aggregates.map((row, index) => <tr key={row.source} onClick={() => setSelectedSource(row.source)} className={`cursor-pointer hover:bg-slate-50 ${selected?.source === row.source ? "bg-red-50/50" : ""}`}><td className="px-4 py-3 font-semibold">{row.source}{index === 0 ? <StatusPill tone="green">Top source</StatusPill> : null}</td><td className="px-4 py-3 text-right">{row.rows.length}</td><td className="px-4 py-3 text-right">{money(row.monthRevenue)}</td><td className="px-4 py-3 text-right text-emerald-700">{money(row.monthProfit)}</td><td className="px-4 py-3 text-right font-semibold">{money(row.ytdRevenue)}</td><td className="px-4 py-3 text-right text-emerald-700">{money(row.ytdProfit)}</td><td className="px-4 py-3 text-right">{money(row.rows.length ? row.ytdRevenue / row.rows.length : 0)}</td></tr>)}
                  <tr className="bg-slate-50 font-semibold"><td className="px-4 py-3">Total</td><td className="px-4 py-3 text-right">{aggregates.reduce((sum, row) => sum + row.rows.length, 0)}</td><td className="px-4 py-3 text-right">{money(totalMonthRevenue)}</td><td className="px-4 py-3 text-right">{money(totalMonthProfit)}</td><td className="px-4 py-3 text-right">{money(totalYtdRevenue)}</td><td className="px-4 py-3 text-right">{money(totalYtdProfit)}</td><td /></tr>
                </tbody>
              </table>
            </AdminDesktopTable>
            <AdminMobileList>
              {aggregates.map((row, index) => (
                <button
                  type="button"
                  key={row.source}
                  onClick={() => setSelectedSource(row.source)}
                  className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left ${selected?.source === row.source ? "bg-red-50/50" : ""}`}
                >
                  <div className="min-w-0">
                    <p className="font-semibold">{row.source}{index === 0 ? <span className="ml-2"><StatusPill tone="green">Top source</StatusPill></span> : null}</p>
                    <p className="mt-0.5 text-[8px] text-slate-400">{row.rows.length} deals</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold">{money(row.monthRevenue)}</p>
                    <p className="mt-0.5 text-[8px] text-emerald-700">{money(row.monthProfit)} GP</p>
                  </div>
                </button>
              ))}
            </AdminMobileList>
          </AdminPanel>
          <section className="grid gap-3 lg:grid-cols-2">
            <AdminPanel>
              <div className="border-b px-4 py-3 text-[10px] font-semibold">Revenue split by source</div>
              <div className="space-y-3 p-4">{aggregates.map((row) => <div key={row.source}><div className="mb-1 flex justify-between text-[9px]"><span>{row.source}</span><span>{totalMonthRevenue ? `${((row.monthRevenue / totalMonthRevenue) * 100).toFixed(1)}%` : "0%"}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-primary" style={{ width: `${totalMonthRevenue ? (row.monthRevenue / totalMonthRevenue) * 100 : 0}%` }} /></div></div>)}</div>
            </AdminPanel>
            <AdminPanel>
              <div className="border-b px-4 py-3 text-[10px] font-semibold">Monthly revenue trend</div>
              <div className="flex h-44 items-end gap-2 p-4">{monthly.map((value, index) => <div key={index} className="flex h-full flex-1 flex-col justify-end gap-1"><div title={money(value)} className="min-h-[2px] rounded-t bg-primary" style={{ height: `${(value / maxMonthly) * 100}%` }} /><span className="text-center text-[7px] text-slate-400">{new Date(Date.UTC(2026, index, 1)).toLocaleDateString("en-GB", { month: "short" })}</span></div>)}</div>
            </AdminPanel>
          </section>
        </div>

        <AdminPanel>
          {selected ? <div><div className="border-b p-4"><StatusPill tone="green">Selected source</StatusPill><h2 className="mt-2 text-[16px] font-semibold">{selected.source}</h2></div><dl className="grid grid-cols-2 gap-3 p-4 text-[9px]"><div><dt className="text-slate-400">Revenue this month</dt><dd className="mt-1 text-[14px] font-semibold">{money(selected.monthRevenue)}</dd></div><div><dt className="text-slate-400">YTD revenue</dt><dd className="mt-1 text-[14px] font-semibold">{money(selected.ytdRevenue)}</dd></div><div><dt className="text-slate-400">Gross profit this month</dt><dd className="mt-1 font-semibold text-emerald-700">{money(selected.monthProfit)}</dd></div><div><dt className="text-slate-400">YTD gross profit</dt><dd className="mt-1 font-semibold text-emerald-700">{money(selected.ytdProfit)}</dd></div><div><dt className="text-slate-400">Deals</dt><dd className="mt-1 font-semibold">{selected.rows.length}</dd></div><div><dt className="text-slate-400">Average order</dt><dd className="mt-1 font-semibold">{money(selected.rows.length ? selected.ytdRevenue / selected.rows.length : 0)}</dd></div></dl><div className="border-t p-4"><h3 className="text-[10px] font-semibold">Top events sold</h3><div className="mt-2 divide-y">{topEvents.map(([event, value]) => <div key={event} className="flex gap-3 py-2 text-[9px]"><span className="flex-1 truncate">{event}</span><span className="font-semibold">{money(value)}</span></div>)}</div></div></div> : <p className="p-8 text-center text-[9px] text-slate-400">No sales in this period.</p>}
        </AdminPanel>
      </div>
    </div>
  )
}

