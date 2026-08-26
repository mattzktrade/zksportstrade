"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowUpDown, CalendarClock, CircleDollarSign, Download, PackageSearch, Search } from "lucide-react"
import { AdminPageHeader, AdminPanel, AdminStatCard, AdminStats, AdminDesktopTable, AdminMobileList, StatusPill } from "@/components/admin/admin-page-kit"
import { EventFilter, uniqueEventFilterOptions } from "@/components/admin/event-filter"
import { AccountNameLink, SupplierNameLink } from "@/components/admin/profile-name-link"
import {
  filterNegativeStockRows,
  formatDate,
  hasActiveNegativeStockFilters,
  money,
  reasonLabel,
  sortNegativeStockRows,
  statusLabel,
  summarizeNegativeStock,
  urgencyForEvent,
  type NegativeStockFilters,
  type NegativeStockReason,
  type NegativeStockRow,
  type NegativeStockSortKey,
  type NegativeStockStatus,
  type NegativeStockUrgency,
} from "@/lib/admin/negative-stock"
import { cn } from "@/lib/utils"
import { usePersistedAdminFilters } from "@/lib/admin/use-persisted-admin-filters"
import { toast } from "sonner"
import {
  reconcileHistoricalInventory,
  type HistoricalInventoryReconciliationResult,
} from "./actions"

const EMPTY_FILTERS: NegativeStockFilters = {
  search: "",
  eventNames: [],
  supplierName: "",
  reason: "",
  urgency: "",
  assignedTo: "",
  status: "",
}

const DEFAULT_NEGATIVE_STOCK_LIST = {
  ...EMPTY_FILTERS,
  sortKey: "eventDate" as NegativeStockSortKey,
  sortDescending: false,
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b))
}

function statusTone(status: NegativeStockStatus): "red" | "blue" | "amber" {
  if (status === "confirmed") return "amber"
  if (status === "quoted") return "blue"
  return "red"
}

function downloadCsv(rows: NegativeStockRow[]) {
  const header = [
    "Event",
    "Package",
    "Qty",
    "Supplier",
    "Agreed cost",
    "Sale price",
    "Gross profit",
    "Event date",
    "Deal ref",
    "Agent",
    "Assigned to",
    "Shortage type",
    "Status",
    "Quote at",
    "Quote fresh",
  ]
  const lines = rows.map((row) => {
    const cost = row.unitCost * row.quantity
    const sale = row.unitSale * row.quantity
    return [
      row.eventName,
      row.packageName,
      String(row.quantity),
      row.supplierName ?? "Not assigned",
      String(cost),
      String(sale),
      String(sale - cost),
      row.eventDate ?? "",
      row.dealReference ?? "",
      row.accountName ?? "",
      row.ownerName ?? "Unassigned",
      reasonLabel(row.reason),
      statusLabel(row.status),
      row.supplierQuoteAt ?? "",
      row.supplierQuoteAt ? (row.quoteFresh ? "Fresh" : "Stale") : "No quote",
    ]
  })
  const csv = [header, ...lines]
    .map((cols) => cols.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
    .join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `negative-stock-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export function NegativeStockClient({ rows }: { rows: NegativeStockRow[] }) {
  const [reconciling, startReconciliation] = useTransition()
  const [reconciliation, setReconciliation] = useState<HistoricalInventoryReconciliationResult | null>(null)
  const [listState, setListState] = usePersistedAdminFilters(
    "zk-admin-negative-stock-filters-v1",
    DEFAULT_NEGATIVE_STOCK_LIST,
  )
  const { sortKey, sortDescending, ...filters } = listState

  const eventOptions = useMemo(
    () =>
      uniqueEventFilterOptions(
        rows.map((row) => ({
          id: row.eventName,
          label: row.eventName,
          eventDate: row.eventDate,
        })),
      ),
    [rows],
  )
  const supplierOptions = useMemo(
    () => uniqueSorted(rows.map((row) => row.supplierName ?? "Not assigned")),
    [rows],
  )
  const ownerOptions = useMemo(
    () => uniqueSorted(rows.map((row) => row.ownerName ?? "Unassigned")),
    [rows],
  )
  const stats = useMemo(() => summarizeNegativeStock(rows), [rows])
  const visible = useMemo(
    () => sortNegativeStockRows(filterNegativeStockRows(rows, filters), sortKey, sortDescending),
    [filters, rows, sortDescending, sortKey],
  )
  const filtersActive = hasActiveNegativeStockFilters(filters)
  const canApplyReconciliation = Boolean(
    reconciliation?.ok && !reconciliation.applied,
  )

  function runHistoricalReconciliation(apply: boolean) {
    if (
      apply &&
      !window.confirm(
        "Apply the preview? Covered quantities will be assigned to recorded purchase layers and uncovered quantities will be flagged as historical shortages.",
      )
    ) return
    startReconciliation(async () => {
      const result = await reconcileHistoricalInventory(apply)
      setReconciliation(result)
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    })
  }

  return (
    <div className="mx-auto max-w-[1540px] space-y-3 p-3 sm:p-4 lg:p-5">
      <AdminPageHeader
        title="Inventory / Negative stock list"
        description="Uncovered sold stock. Brokered sales need purchasing; historical gaps need the missing purchase order added."
        action={
          <div className="flex gap-2">
            <button
              type="button"
              disabled={reconciling}
              onClick={() => runHistoricalReconciliation(false)}
              className="h-9 rounded-md border border-[#e4e6ea] bg-white px-3 text-[9px] font-medium disabled:opacity-50"
            >
              Preview historical reconciliation
            </button>
            <button
              type="button"
              disabled={reconciling || !canApplyReconciliation}
              onClick={() => runHistoricalReconciliation(true)}
              title={canApplyReconciliation ? "Apply the preview" : "Preview first"}
              className="h-9 rounded-md bg-primary px-3 text-[9px] font-semibold text-white disabled:opacity-50"
            >
              Apply reconciliation
            </button>
          </div>
        }
      />

      {reconciliation ? (
        <div className={cn(
          "rounded-md border px-3 py-2 text-[9px]",
          reconciliation.ok ? "border-blue-200 bg-blue-50 text-blue-800" : "border-red-200 bg-red-50 text-red-700",
        )}>
          {reconciliation.message}
        </div>
      ) : null}

      <AdminStats className="sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard icon={PackageSearch} value={stats.count} label="Deals to purchase" hint="Open sourcing shortages" />
        <AdminStatCard
          icon={CalendarClock}
          value={stats.urgent}
          label="Urgent"
          hint="Event within 45 days"
          tone="amber"
        />
        <AdminStatCard
          icon={CircleDollarSign}
          value={money(stats.purchaseValue)}
          label="Total purchase value"
          hint="Quoted cost to buy"
          tone="blue"
        />
        <AdminStatCard
          icon={CircleDollarSign}
          value={money(stats.saleValue)}
          label="Total sale value"
          hint="Revenue on sold deals"
          tone="purple"
        />
      </AdminStats>

      <AdminPanel>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#eceef1] p-3">
          <div className="relative min-w-0 w-full flex-1 sm:min-w-[250px] sm:max-w-[380px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={filters.search}
              onChange={(event) => setListState((current) => ({ ...current, search: event.target.value }))}
              placeholder="Search event, agent, supplier, ref..."
              className="h-8 w-full rounded-md border border-[#e4e6ea] bg-white pl-9 pr-3 text-[10px] outline-none focus:border-primary/40"
            />
          </div>
          <EventFilter
            options={eventOptions}
            selectedIds={filters.eventNames}
            onChange={(eventNames) => setListState((current) => ({ ...current, eventNames }))}
            inputClassName="h-8 border-[#e4e6ea] text-[#62666e] focus:border-primary/40"
          />
          <select
            value={filters.supplierName}
            onChange={(event) => setListState((current) => ({ ...current, supplierName: event.target.value }))}
            className="h-8 max-w-[170px] rounded-md border border-[#e4e6ea] bg-white px-2 text-[9px] text-[#62666e]"
          >
            <option value="">All suppliers</option>
            {supplierOptions.map((supplier) => (
              <option key={supplier} value={supplier}>
                {supplier}
              </option>
            ))}
          </select>
          <select
            value={filters.reason}
            onChange={(event) =>
              setListState((current) => ({
                ...current,
                reason: event.target.value as "" | NegativeStockReason,
              }))
            }
            className="h-8 rounded-md border border-[#e4e6ea] bg-white px-2 text-[9px] text-[#62666e]"
          >
            <option value="">All shortage types</option>
            <option value="historical_reconciliation">Missing historical purchase</option>
            <option value="brokered">Brokered stock</option>
          </select>
          <select
            value={filters.urgency}
            onChange={(event) =>
              setListState((current) => ({
                ...current,
                urgency: event.target.value as "" | NegativeStockUrgency,
              }))
            }
            className="h-8 rounded-md border border-[#e4e6ea] bg-white px-2 text-[9px] text-[#62666e]"
          >
            <option value="">All urgency</option>
            <option value="critical">Critical (7 days)</option>
            <option value="urgent">Urgent (45 days)</option>
            <option value="later">Later</option>
            <option value="unknown">No event date</option>
          </select>
          <select
            value={filters.assignedTo}
            onChange={(event) => setListState((current) => ({ ...current, assignedTo: event.target.value }))}
            className="h-8 max-w-[160px] rounded-md border border-[#e4e6ea] bg-white px-2 text-[9px] text-[#62666e]"
          >
            <option value="">Assigned to</option>
            {ownerOptions.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(event) =>
              setListState((current) => ({
                ...current,
                status: event.target.value as "" | NegativeStockStatus,
              }))
            }
            className="h-8 rounded-md border border-[#e4e6ea] bg-white px-2 text-[9px] text-[#62666e]"
          >
            <option value="">All statuses</option>
            <option value="open">Needs quote</option>
            <option value="quoted">Quoted</option>
            <option value="confirmed">Pending purchase</option>
          </select>
          <select
            value={sortKey}
            onChange={(event) =>
              setListState((current) => ({
                ...current,
                sortKey: event.target.value as NegativeStockSortKey,
              }))
            }
            className="h-8 rounded-md border border-[#e4e6ea] bg-white px-2 text-[9px] text-[#62666e]"
          >
            <option value="eventDate">Sort: Event date</option>
            <option value="event">Sort: Event</option>
            <option value="created">Sort: Created</option>
            <option value="cost">Sort: Purchase value</option>
            <option value="sale">Sort: Sale value</option>
            <option value="profit">Sort: Profit</option>
          </select>
          <button
            type="button"
            onClick={() => setListState((current) => ({ ...current, sortDescending: !current.sortDescending }))}
            title={sortDescending ? "Descending" : "Ascending"}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[#e4e6ea] text-[#62666e]"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
          {filtersActive ? (
            <button
              type="button"
              onClick={() => setListState((current) => ({ ...current, ...EMPTY_FILTERS }))}
              className="h-8 rounded-md border border-[#e4e6ea] px-3 text-[9px] text-[#62666e]"
            >
              Clear filters
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => downloadCsv(visible)}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-md border border-[#e4e6ea] px-3 text-[9px] text-[#62666e]"
          >
            <Download className="h-3.5 w-3.5" />
            Export list
          </button>
        </div>

        <div className="flex items-center justify-between border-b border-[#eceef1] px-3 py-2 text-[9px] text-[#8a8e96]">
          <p>
            Showing {visible.length} of {rows.length} shortage{rows.length === 1 ? "" : "s"}
          </p>
          {filtersActive ? <p>Filters applied</p> : null}
        </div>

        <AdminDesktopTable>
          <table className="w-full min-w-[1180px] text-left">
            <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-[#92969e]">
              <tr>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Package / ticket</th>
                <th className="px-3 py-2 font-medium">Qty</th>
                <th className="px-3 py-2 font-medium">Supplier (agreed)</th>
                <th className="px-3 py-2 font-medium">Agreed cost</th>
                <th className="px-3 py-2 font-medium">Sale price</th>
                <th className="px-3 py-2 font-medium">Gross profit</th>
                <th className="px-3 py-2 font-medium">Event date</th>
                <th className="px-3 py-2 font-medium">Ref / deal ID</th>
                <th className="px-3 py-2 font-medium">Assigned to</th>
                <th className="px-3 py-2 font-medium">Shortage type</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f1f3] text-[9px]">
              {visible.map((row) => {
                const cost = row.unitCost * row.quantity
                const sale = row.unitSale * row.quantity
                const profit = sale - cost
                const urgency = urgencyForEvent(row.eventDate)
                return (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-3 py-3">
                      <p className="font-semibold text-[#36393f]">{row.eventName}</p>
                      <p className="mt-0.5 text-[8px] text-[#9a9ea5]">{row.location || "—"}</p>
                    </td>
                    <td className="px-3 py-3 font-medium text-[#4a4e55]">{row.packageName}</td>
                    <td className="px-3 py-3 font-semibold">{row.quantity}</td>
                    <td className="px-3 py-3 text-[#5f636b]">
                      <p><SupplierNameLink supplierId={row.supplierId} name={row.supplierName ?? "Not assigned"} /></p>
                      <p
                        className={cn(
                          "mt-0.5 text-[8px]",
                          !row.supplierQuoteAt
                            ? "text-[#9a9ea5]"
                            : row.quoteFresh
                              ? "text-emerald-600"
                              : "text-red-600",
                        )}
                      >
                        {!row.supplierQuoteAt
                          ? "No quote"
                          : `${row.quoteFresh ? "Fresh quote" : "Stale quote"} · ${formatDate(row.supplierQuoteAt)}`}
                      </p>
                    </td>
                    <td className="px-3 py-3 font-medium">{money(cost, row.currency)}</td>
                    <td className="px-3 py-3 font-medium">{money(sale, row.currency)}</td>
                    <td className="px-3 py-3">
                      <p className={profit >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-red-600"}>
                        {money(profit, row.currency)}
                      </p>
                      <p className="text-[8px] text-[#9a9ea5]">
                        {sale > 0 ? `${Math.round((profit / sale) * 100)}%` : "—"}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-[#5f636b]">
                      <p>{formatDate(row.eventDate)}</p>
                      {urgency === "critical" ? (
                        <p className="mt-0.5 text-[8px] font-medium text-red-600">Critical</p>
                      ) : urgency === "urgent" ? (
                        <p className="mt-0.5 text-[8px] font-medium text-amber-600">Urgent</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-mono text-[8px] text-[#6e727a]">{row.dealReference ?? "—"}</p>
                      <p className="mt-0.5 text-[8px] text-[#9a9ea5]"><AccountNameLink accountId={row.accountId} name={row.accountName ?? "No account"} /></p>
                    </td>
                    <td className="px-3 py-3 text-[#5f636b]">{row.ownerName ?? "Unassigned"}</td>
                    <td className="px-3 py-3 text-[#5f636b]">{reasonLabel(row.reason)}</td>
                    <td className="px-3 py-3">
                      <StatusPill tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusPill>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.dealId ? (
                          <Link
                            href={`/admin/deals/${row.dealId}`}
                            className="rounded-md border border-[#e5e7eb] px-2 py-1.5 text-[8px] font-medium"
                          >
                            View deal
                          </Link>
                        ) : null}
                        <Link
                          href={row.packageId ? `/admin/catalog/${row.packageId}` : "/admin/catalog"}
                          className="rounded-md border border-[#e5e7eb] px-2 py-1.5 text-[8px] font-medium"
                        >
                          View product
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-14 text-center">
                    <AlertTriangle className="mx-auto h-6 w-6 text-slate-300" />
                    <p className="mt-2 text-[10px] text-slate-400">
                      {rows.length === 0
                        ? "No negative stock requires purchasing."
                        : "No shortages match the current filters."}
                    </p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </AdminDesktopTable>
        <AdminMobileList>
          {visible.map((row) => {
            const cost = row.unitCost * row.quantity
            const sale = row.unitSale * row.quantity
            const profit = sale - cost
            const urgency = urgencyForEvent(row.eventDate)
            return (
              <div key={row.id} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800">{row.eventName}</p>
                    <p className="mt-0.5 text-[10px] text-slate-600">{row.packageName}</p>
                    <p className="mt-0.5 text-[8px] text-slate-400">
                      {row.dealReference ?? "—"} · {row.quantity} units · {reasonLabel(row.reason)}
                    </p>
                  </div>
                  <StatusPill tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusPill>
                </div>
                <p className="text-[10px] text-slate-600">
                  {row.supplierName ?? "Not assigned"} · {money(cost, row.currency)}
                </p>
                <p className={profit >= 0 ? "text-[10px] font-semibold text-emerald-600" : "text-[10px] font-semibold text-red-600"}>
                  GP {money(profit, row.currency)}
                  {urgency === "critical" ? " · Critical" : urgency === "urgent" ? " · Urgent" : ""}
                </p>
                <div className="flex flex-wrap gap-1">
                  {row.dealId ? (
                    <Link href={`/admin/deals/${row.dealId}`} className="rounded-md border border-[#e5e7eb] px-2 py-1.5 text-[8px] font-medium">
                      View deal
                    </Link>
                  ) : null}
                  <Link
                    href={row.packageId ? `/admin/catalog/${row.packageId}` : "/admin/catalog"}
                    className="rounded-md border border-[#e5e7eb] px-2 py-1.5 text-[8px] font-medium"
                  >
                    View product
                  </Link>
                </div>
              </div>
            )
          })}
          {visible.length === 0 ? (
            <p className="px-4 py-14 text-center text-[10px] text-slate-400">
              {rows.length === 0 ? "No negative stock requires purchasing." : "No shortages match the current filters."}
            </p>
          ) : null}
        </AdminMobileList>
      </AdminPanel>
    </div>
  )
}
