"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, CircleDollarSign, Download, Inbox, Target, Trophy, Users } from "lucide-react"
import { AdminPageHeader, AdminPanel, AdminStatCard, AdminStats, AdminDesktopTable } from "@/components/admin/admin-page-kit"
import { SalesTrackerNav } from "@/components/admin/sales-tracker-nav"
import { usePersistedAdminFilters } from "@/lib/admin/use-persisted-admin-filters"
import {
  DEMAND_AGENT_KINDS,
  aggregateDemand,
  demandClientFilterOptions,
  demandConversionRate,
  demandWinRate,
  type DemandCounts,
  type DemandEventRow,
  type DemandPlanningLine,
} from "@/lib/crm/demand-planning"
import type { AccountKind } from "@/lib/crm/account-kinds"
import { cn } from "@/lib/utils"

type ClientFilterId = AccountKind | "unspecified" | "agents"

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function CountsCells({ row }: { row: DemandCounts }) {
  return (
    <>
      <td className="px-3 py-2.5 text-right tabular-nums">{row.enquiries}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{row.open}</td>
      <td className="px-3 py-2.5 text-right tabular-nums font-medium">{row.converted}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{row.won}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{row.lost}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{row.unitsAsked}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{row.unitsWon}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{percent(demandConversionRate(row))}</td>
    </>
  )
}

export function DemandPlanningClient({ lines }: { lines: DemandPlanningLine[] }) {
  const seasons = useMemo(() => {
    const values = [...new Set(lines.map((line) => line.eventSeason).filter((value): value is number => value != null))]
    return values.sort((a, b) => b - a)
  }, [lines])
  const [listState, setListState] = usePersistedAdminFilters("zk-admin-demand-filters-v2", {
    season: 0,
    eventId: "",
    query: "",
    clientFilters: [] as ClientFilterId[],
  })
  const { season, eventId, query, clientFilters } = listState
  const [expanded, setExpanded] = useState<string | null>(null)

  const selectedKinds = useMemo(() => {
    const kinds: Array<AccountKind | "unspecified"> = []
    for (const id of clientFilters) {
      if (id === "agents") {
        for (const kind of DEMAND_AGENT_KINDS) {
          if (!kinds.includes(kind)) kinds.push(kind)
        }
        continue
      }
      if (!kinds.includes(id)) kinds.push(id)
    }
    return kinds
  }, [clientFilters])

  const scopedLines = useMemo(() => {
    const q = query.trim().toLowerCase()
    return lines.filter((line) => {
      if (season && line.eventSeason != null && line.eventSeason !== season) return false
      if (eventId && line.eventId !== eventId) return false
      if (
        q &&
        !line.eventName.toLowerCase().includes(q) &&
        !line.packageName.toLowerCase().includes(q)
      ) {
        return false
      }
      return true
    })
  }, [lines, season, eventId, query])

  const { totals, events } = useMemo(
    () => aggregateDemand(scopedLines, selectedKinds),
    [scopedLines, selectedKinds],
  )
  const selectedEvent = events.find((event) => event.eventId === expanded) ?? events[0] ?? null
  const eventOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const line of lines) {
      if (season && line.eventSeason != null && line.eventSeason !== season) continue
      map.set(line.eventId, line.eventName)
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [lines, season])

  function toggleClient(id: ClientFilterId) {
    setListState((current) => {
      const has = current.clientFilters.includes(id)
      return {
        ...current,
        clientFilters: has
          ? current.clientFilters.filter((item) => item !== id)
          : [...current.clientFilters, id],
      }
    })
  }

  function exportCsv() {
    const header = [
      "Event",
      "Product",
      "Total",
      "Enquiries",
      "Deals",
      "Won",
      "Lost",
      "Units asked",
      "Units won",
      "Conversion %",
    ]
    const rows: Array<Array<string | number>> = [header]
    for (const event of events) {
      rows.push([
        event.eventName,
        "",
        event.enquiries,
        event.open,
        event.converted,
        event.won,
        event.lost,
        event.unitsAsked,
        event.unitsWon,
        Math.round(demandConversionRate(event) * 100),
      ])
      for (const product of event.products) {
        rows.push([
          event.eventName,
          product.packageName,
          product.enquiries,
          product.open,
          product.converted,
          product.won,
          product.lost,
          product.unitsAsked,
          product.unitsWon,
          Math.round(demandConversionRate(product) * 100),
        ])
      }
    }
    const blob = new Blob([rows.map((row) => row.join(",")).join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `demand-by-event${season ? `-${season}` : ""}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-[1540px] space-y-3 p-3 sm:p-4 lg:p-5">
      <AdminPageHeader
        title="Sales Tracker"
        description="Enquiries and Deals together, plus portal and website sales that are not already on a deal. Use this when deciding what to buy for next year."
        action={
          <button
            type="button"
            onClick={exportCsv}
            className="flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-[9px] font-semibold"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        }
      />
      <SalesTrackerNav tab="demand" />

      <AdminStats className="sm:grid-cols-2 xl:grid-cols-5">
        <AdminStatCard icon={Inbox} value={totals.enquiries} label="Total records" tone="purple" />
        <AdminStatCard icon={Users} value={totals.open} label="Enquiries" tone="blue" />
        <AdminStatCard icon={Target} value={totals.converted} label="Deals" tone="amber" />
        <AdminStatCard icon={Trophy} value={totals.won} label="Won" tone="green" />
        <AdminStatCard icon={CircleDollarSign} value={totals.unitsWon} label="Units won" />
      </AdminStats>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={season || ""}
          onChange={(event) =>
            setListState((current) => ({
              ...current,
              season: Number(event.target.value) || 0,
              eventId: "",
            }))
          }
          className="h-9 rounded-md border bg-white px-3 text-[10px]"
        >
          <option value="">All seasons</option>
          {seasons.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          value={eventId}
          onChange={(event) => setListState((current) => ({ ...current, eventId: event.target.value }))}
          className="h-9 min-w-40 rounded-md border bg-white px-3 text-[10px]"
        >
          <option value="">All events</option>
          {eventOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <input
          value={query}
          onChange={(event) => setListState((current) => ({ ...current, query: event.target.value }))}
          placeholder="Search event or product"
          className="h-9 min-w-48 flex-1 rounded-md border bg-white px-3 text-[10px]"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {demandClientFilterOptions().map((option) => {
          const active = clientFilters.includes(option.id)
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => toggleClient(option.id)}
              className={cn(
                "h-8 rounded-md border px-2.5 text-[9px] font-semibold",
                active ? "border-primary bg-red-50 text-primary" : "bg-white text-slate-600",
              )}
            >
              {option.label}
            </button>
          )
        })}
        {clientFilters.length > 0 ? (
          <button
            type="button"
            onClick={() => setListState((current) => ({ ...current, clientFilters: [] }))}
            className="h-8 px-2 text-[9px] font-semibold text-slate-500 hover:text-slate-800"
          >
            Clear client filter
          </button>
        ) : null}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_340px]">
        <AdminPanel>
          <AdminDesktopTable>
            <table className="w-full min-w-[920px] text-left">
              <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2.5">Event / product</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                  <th className="px-3 py-2.5 text-right">Enquiries</th>
                  <th className="px-3 py-2.5 text-right">Deals</th>
                  <th className="px-3 py-2.5 text-right">Won</th>
                  <th className="px-3 py-2.5 text-right">Lost</th>
                  <th className="px-3 py-2.5 text-right">Units asked</th>
                  <th className="px-3 py-2.5 text-right">Units won</th>
                  <th className="px-3 py-2.5 text-right">Conv.</th>
                </tr>
              </thead>
              <tbody className="divide-y text-[10px]">
                {events.map((event) => (
                  <EventBlock
                    key={event.eventId}
                    event={event}
                    open={expanded === event.eventId}
                    onToggle={() => setExpanded((current) => (current === event.eventId ? null : event.eventId))}
                  />
                ))}
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-14 text-center text-[10px] text-slate-400">
                      No enquiries match these filters.
                    </td>
                  </tr>
                ) : (
                  <tr className="bg-slate-50 font-semibold">
                    <td className="px-3 py-2.5">Total</td>
                    <CountsCells row={totals} />
                  </tr>
                )}
              </tbody>
            </table>
          </AdminDesktopTable>
        </AdminPanel>

        <AdminPanel>
          {selectedEvent ? (
            <div>
              <div className="border-b p-4">
                <p className="text-[8px] font-semibold uppercase tracking-wide text-slate-400">Selected event</p>
                <h2 className="mt-1 text-[15px] font-semibold">{selectedEvent.eventName}</h2>
                <p className="mt-1 text-[9px] text-slate-500">
                      Converted means it is on Deals (booking form onwards). Won is signed or paid. Portal and website
                      orders with no deal are counted as won.
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-3 p-4 text-[9px]">
                <div>
                  <dt className="text-slate-400">Enquiries</dt>
                  <dd className="mt-1 text-[14px] font-semibold">{selectedEvent.enquiries}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Conversion</dt>
                  <dd className="mt-1 text-[14px] font-semibold">{percent(demandConversionRate(selectedEvent))}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Won</dt>
                  <dd className="mt-1 font-semibold text-emerald-700">{selectedEvent.won}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Win rate</dt>
                  <dd className="mt-1 font-semibold">{percent(demandWinRate(selectedEvent))}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Units asked</dt>
                  <dd className="mt-1 font-semibold">{selectedEvent.unitsAsked}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Units won</dt>
                  <dd className="mt-1 font-semibold text-emerald-700">{selectedEvent.unitsWon}</dd>
                </div>
              </dl>
              <div className="border-t p-4">
                <h3 className="text-[10px] font-semibold">By client type</h3>
                <div className="mt-2 divide-y">
                  {selectedEvent.kinds.map((kind) => (
                    <div key={kind.kind} className="flex items-start justify-between gap-3 py-2 text-[9px]">
                      <div className="min-w-0">
                        <p className="font-medium">{kind.label}</p>
                        <p className="text-slate-400">
                          {kind.converted} converted · {kind.won} won · {kind.lost} lost
                        </p>
                      </div>
                      <span className="shrink-0 font-semibold">{kind.enquiries}</span>
                    </div>
                  ))}
                  {selectedEvent.kinds.length === 0 ? (
                    <p className="py-3 text-slate-400">No client types recorded.</p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <p className="p-8 text-center text-[9px] text-slate-400">No events in this view.</p>
          )}
        </AdminPanel>
      </div>
    </div>
  )
}

function EventBlock({
  event,
  open,
  onToggle,
}: {
  event: DemandEventRow
  open: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr
        className={cn("cursor-pointer hover:bg-slate-50", open && "bg-red-50/40")}
        onClick={onToggle}
      >
        <td className="px-3 py-2.5">
          <span className="inline-flex items-center gap-1.5 font-semibold">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {event.eventName}
          </span>
        </td>
        <CountsCells row={event} />
      </tr>
      {open
        ? event.products.map((product) => (
            <tr key={product.packageId} className="bg-[#fafbfc] text-slate-600">
              <td className="px-3 py-2 pl-10">{product.packageName}</td>
              <CountsCells row={product} />
            </tr>
          ))
        : null}
    </>
  )
}
