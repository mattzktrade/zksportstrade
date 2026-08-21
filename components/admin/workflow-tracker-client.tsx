"use client"

import { useMemo, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CircleDollarSign,
  Search,
  Target,
  TrendingUp,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import { isCancelledWorkflowRow } from "@/lib/admin/workflow-status"
import type { WorkflowOrderRow } from "@/lib/admin/workflow-views"
import {
  compareUpcomingEvent,
  eventFilterKey,
  eventTime,
  formatEventDate,
  startOfToday,
  uniqueEventOptions,
} from "@/lib/admin/workflow-event-filter"
import {
  AdminPageHeader,
  AdminPanel,
  AdminStatCard,
  AdminStats,
  AdminDesktopTable,
  AdminMobileList,
  StatusPill,
} from "@/components/admin/admin-page-kit"
import { AccountNameLink, ContactNameLink } from "@/components/admin/profile-name-link"
import { markFinanceRowPaid, markFinanceRowUnpaid, replaceFinanceInvoice } from "@/app/(admin)/admin/deals/deal-finance-actions"
import { dealSourceLabel } from "@/lib/crm/deal-types"
import { usePersistedAdminFilters } from "@/lib/admin/use-persisted-admin-filters"

type SortKey = "eventDate" | "reference" | "client" | "event"

function sourceMatches(row: WorkflowOrderRow, filter: string): boolean {
  if (filter === "all") return true
  const values = [row.channel, row.dealSource].filter(Boolean) as string[]
  if (filter === "offline") {
    return values.some((value) => ["offline", "native_deal", "admin", "other"].includes(value))
  }
  if (filter === "trade_portal") {
    return values.some((value) => ["trade_portal", "portal"].includes(value))
  }
  if (filter === "wix") {
    return values.some((value) => ["wix", "website"].includes(value))
  }
  return values.includes(filter)
}

function money(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

function date(value: string | null): string {
  if (!value) return "—"
  return new Date(value.includes("T") ? value : `${value}T00:00:00Z`).toLocaleDateString(
    "en-GB",
    { day: "2-digit", month: "short", year: "numeric" },
  )
}

function tone(status: string | null): "green" | "amber" | "red" | "blue" | "gray" {
  if (status === "paid" || status === "delivered" || status === "confirmed" || status === "completed" || status === "checkout_terms") return "green"
  if (status === "cancelled" || status === "failed" || status === "issue") return "red"
  if (status === "awaiting_payment" || status === "overdue") return "amber"
  if (status === "pending") return "blue"
  return "gray"
}

function label(value: string): string {
  return value.replaceAll("_", " ")
}

function SortTh({
  heading,
  column,
  sortKey,
  sortDir,
  onSort,
}: {
  heading: string
  column: SortKey
  sortKey: SortKey
  sortDir: "asc" | "desc"
  onSort: (key: SortKey) => void
}) {
  const active = sortKey === column
  return (
    <th className="px-4 py-2.5 font-medium">
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-600"
      >
        {heading}
        {active ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
          ) : (
            <ArrowDown className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" aria-hidden />
        )}
      </button>
    </th>
  )
}

function isPaid(row: WorkflowOrderRow): boolean {
  return ["paid", "delivered"].includes(row.invoiceStatus ?? "")
}

function financeOrderId(row: WorkflowOrderRow): string | null {
  if (!row.id || row.id.startsWith("deal:")) return null
  return row.id
}

export function WorkflowTrackerClient({
  rows,
  mode,
  canManage = false,
}: {
  rows: WorkflowOrderRow[]
  mode: "finance" | "sales"
  canManage?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [listState, setListState] = usePersistedAdminFilters(`zk-admin-${mode}-tracker-filters-v1`, {
    search: "",
    status: "all",
    channel: "all",
    owner: "all",
    period: "all",
    eventScope: "future" as "future" | "all",
    eventKey: "all",
    sortKey: "eventDate" as SortKey,
    sortDir: "asc" as "asc" | "desc",
  })
  const { search, status, channel, owner, period, eventScope, eventKey, sortKey, sortDir } = listState
  const owners = useMemo(
    () => [...new Set(rows.map((row) => row.ownerName).filter(Boolean))].sort() as string[],
    [rows],
  )
  const eventOptions = useMemo(
    () => uniqueEventOptions(rows, eventScope),
    [rows, eventScope],
  )
  const activeEventKey = eventOptions.some((option) => option.key === eventKey) ? eventKey : "all"

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const now = new Date()
    const today = startOfToday()
    const periodStart =
      period === "month"
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime()
        : period === "quarter"
          ? new Date(
              Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1),
            ).getTime()
          : null
    const scoped = rows.filter((row) => {
      if (channel !== "all" && !sourceMatches(row, channel)) return false
      if (owner !== "all" && row.ownerName !== owner) return false
      if (periodStart && new Date(row.createdAt).getTime() < periodStart) return false
      if (activeEventKey !== "all") {
        if (eventFilterKey(row) !== activeEventKey) return false
      } else if (eventScope === "future") {
        const time = eventTime(row)
        if (time != null && time < today) return false
      }
      if (q) {
        const haystack = [
          row.reference,
          row.dealReference,
          row.accountName,
          row.contactName,
          row.contactEmail,
          row.eventPackage,
          row.ownerName,
          row.xeroInvoiceNumber,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
    return scoped.filter((row) => {
      const invoiceStatus =
        row.overdueSince && row.invoiceStatus === "awaiting_payment"
          ? "overdue"
          : row.invoiceStatus
      const statusValue = mode === "finance" ? invoiceStatus : row.orderStatus
      if (mode === "finance" && status !== "all" && isCancelledWorkflowRow(row)) return false
      if (
        status === "awaiting_booking_form" &&
        row.bookingFormStatus &&
        !["draft", "created"].includes(row.bookingFormStatus)
      ) return false
      if (
        status !== "all" &&
        status !== "awaiting_booking_form" &&
        statusValue !== status &&
        !(status === "paid" && statusValue === "delivered")
      ) return false
      return true
    })
  }, [rows, search, status, channel, owner, period, mode, activeEventKey, eventScope])

  const sorted = useMemo(() => {
    const next = [...filtered]
    next.sort((a, b) => {
      const direction = sortDir === "asc" ? 1 : -1
      if (sortKey === "reference") {
        return direction * (a.dealReference || a.reference).localeCompare(b.dealReference || b.reference)
      }
      if (sortKey === "client") {
        return direction * a.accountName.localeCompare(b.accountName)
      }
      if (sortKey === "event") {
        return direction * a.eventPackage.localeCompare(b.eventPackage)
      }
      return compareUpcomingEvent(a, b, direction)
    })
    return next
  }, [filtered, sortDir, sortKey])

  function toggleSort(column: SortKey) {
    setListState((current) => {
      if (current.sortKey === column) {
        return { ...current, sortDir: current.sortDir === "asc" ? "desc" : "asc" }
      }
      return { ...current, sortKey: column, sortDir: "asc" }
    })
  }

  const activeRows = sorted.filter((row) =>
    mode === "finance" ? !isCancelledWorkflowRow(row) : row.orderStatus !== "cancelled",
  )
  const revenue = activeRows.reduce((sum, row) => sum + row.total, 0)
  const knownProfitRows = activeRows.filter((row) => row.costKnown && row.grossProfit != null)
  const grossProfit = knownProfitRows.reduce((sum, row) => sum + Number(row.grossProfit), 0)
  const margin = revenue > 0 ? grossProfit / revenue : 0
  const overdue = activeRows.filter(
    (row) => row.invoiceStatus === "awaiting_payment" && row.overdueSince,
  )
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const collectedThisMonth = activeRows
    .filter((row) => row.paidAt && new Date(row.paidAt).getTime() >= monthStart.getTime())
    .reduce((sum, row) => sum + row.amountPaid, 0)
  const awaitingBookingForm = activeRows.filter(
    (row) => !row.bookingFormStatus || ["draft", "created"].includes(row.bookingFormStatus),
  ).length
  const openFinanceDeals = activeRows.filter(
    (row) => !["paid", "delivered", "cancelled"].includes(row.invoiceStatus ?? ""),
  ).length

  const scopedForTabs = useMemo(() => {
    const q = search.trim().toLowerCase()
    const now = new Date()
    const today = startOfToday()
    const periodStart =
      period === "month"
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime()
        : period === "quarter"
          ? new Date(
              Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1),
            ).getTime()
          : null
    return rows.filter((row) => {
      if (channel !== "all" && !sourceMatches(row, channel)) return false
      if (owner !== "all" && row.ownerName !== owner) return false
      if (periodStart && new Date(row.createdAt).getTime() < periodStart) return false
      if (activeEventKey !== "all") {
        if (eventFilterKey(row) !== activeEventKey) return false
      } else if (eventScope === "future") {
        const time = eventTime(row)
        if (time != null && time < today) return false
      }
      if (!q) return true
      return [
        row.reference,
        row.dealReference,
        row.accountName,
        row.contactName,
        row.contactEmail,
        row.eventPackage,
        row.ownerName,
        row.xeroInvoiceNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    })
  }, [rows, search, channel, owner, period, activeEventKey, eventScope])

  const liveForTabs = scopedForTabs.filter((row) => !isCancelledWorkflowRow(row))
  const tabs = [
    ["all", "All deals", scopedForTabs.length],
    ["awaiting_booking_form", "Awaiting booking form", liveForTabs.filter((row) => !row.bookingFormStatus || ["draft", "created"].includes(row.bookingFormStatus)).length],
    ["awaiting_invoice", "Awaiting invoice", liveForTabs.filter((row) => row.invoiceStatus === "awaiting_invoice").length],
    ["awaiting_payment", "Awaiting payment", liveForTabs.filter((row) => row.invoiceStatus === "awaiting_payment" && !row.overdueSince).length],
    ["overdue", "Overdue", liveForTabs.filter((row) => row.invoiceStatus === "awaiting_payment" && row.overdueSince).length],
    ["paid", "Paid", liveForTabs.filter((row) => ["paid", "delivered"].includes(row.invoiceStatus ?? "")).length],
  ] as const

  function markPaid(row: WorkflowOrderRow) {
    startTransition(async () => {
      const result = await markFinanceRowPaid({ invoiceId: row.invoiceId, dealId: row.dealId })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  function markUnpaid(row: WorkflowOrderRow) {
    if (!window.confirm("Mark this invoice as unpaid? Use this only if it was marked paid by mistake.")) return
    startTransition(async () => {
      const result = await markFinanceRowUnpaid({ invoiceId: row.invoiceId, dealId: row.dealId })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  function replaceInvoice(row: WorkflowOrderRow) {
    const orderId = financeOrderId(row)
    if (!orderId) return
    if (
      !window.confirm(
        "Void the current Xero invoice and create a replacement from this order? The old invoice number will no longer apply.",
      )
    ) {
      return
    }
    startTransition(async () => {
      const result = await replaceFinanceInvoice(orderId)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-5">
      <AdminPageHeader
        title={mode === "finance" ? "Finance Deals Tracker" : "Sales Tracker"}
        description={
          mode === "finance"
            ? "Invoice and payment status across every sales source. Sort by upcoming event and mark deals paid in the table."
            : "Revenue, cost, gross profit and ownership across every confirmed sales channel."
        }
      />

      <AdminStats className="sm:grid-cols-2 xl:grid-cols-5">
        {mode === "finance" ? (
          <>
            <AdminStatCard icon={Users} value={openFinanceDeals} label="Open finance deals" tone="blue" />
            <AdminStatCard icon={Target} value={awaitingBookingForm} label="Awaiting booking form" tone="amber" />
            <AdminStatCard icon={CircleDollarSign} value={activeRows.filter((row) => row.invoiceStatus === "awaiting_payment" && !row.overdueSince).length} label="Awaiting payment" tone="amber" />
            <AdminStatCard icon={AlertTriangle} value={overdue.length} label="Overdue invoices" tone="red" />
            <AdminStatCard icon={TrendingUp} value={money(collectedThisMonth)} label="Collected this month" tone="green" />
          </>
        ) : (
          <>
            <AdminStatCard icon={CircleDollarSign} value={money(revenue)} label="Revenue" tone="blue" />
            <AdminStatCard icon={TrendingUp} value={money(grossProfit)} label="Gross profit" tone="green" />
            <AdminStatCard icon={Target} value={`${(margin * 100).toFixed(1)}%`} label="Gross margin" />
            <AdminStatCard icon={Users} value={activeRows.reduce((s, r) => s + r.quantity, 0)} label="Units sold" />
            <AdminStatCard icon={AlertTriangle} value={activeRows.length - knownProfitRows.length} label="Missing cost" tone="amber" />
          </>
        )}
      </AdminStats>

      <AdminPanel>
        {mode === "finance" ? (
          <div className="no-scrollbar flex overflow-x-auto border-b px-3">
            {tabs.map(([value, text, count]) => (
              <button
                key={value}
                type="button"
                onClick={() => setListState((current) => ({ ...current, status: value }))}
                className={`whitespace-nowrap border-b-2 px-3 py-3 text-[10px] font-semibold ${
                  status === value ? "border-primary text-primary" : "border-transparent text-slate-500"
                }`}
              >
                {text} · {count}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-b border-[#eceef1] p-3">
          <label className="relative min-w-0 w-full flex-1 sm:min-w-[240px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setListState((current) => ({ ...current, search: event.target.value }))}
              placeholder="Search order, account, event, owner or invoice..."
              className="h-9 w-full rounded-md border border-[#e2e4e8] bg-white pl-9 pr-3 text-[10px] outline-none focus:border-primary"
            />
          </label>
          <select
            value={eventScope}
            onChange={(event) =>
              setListState((current) => ({ ...current, eventScope: event.target.value as "future" | "all" }))
            }
            className="h-9 w-full rounded-md border bg-white px-3 text-[10px] sm:w-auto"
          >
            <option value="future">Future events</option>
            <option value="all">All dates</option>
          </select>
          <select
            value={activeEventKey}
            onChange={(event) => setListState((current) => ({ ...current, eventKey: event.target.value }))}
            className="h-9 w-full max-w-none rounded-md border bg-white px-3 text-[10px] sm:w-auto sm:max-w-[280px]"
          >
            <option value="all">Any event</option>
            {eventOptions.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
          <select value={period} onChange={(event) => setListState((current) => ({ ...current, period: event.target.value }))} className="h-9 w-full rounded-md border bg-white px-3 text-[10px] sm:w-auto">
            <option value="all">All time</option>
            <option value="month">This month</option>
            <option value="quarter">This quarter</option>
          </select>
          <select value={channel} onChange={(event) => setListState((current) => ({ ...current, channel: event.target.value }))} className="h-9 w-full rounded-md border bg-white px-3 text-[10px] sm:w-auto">
            <option value="all">All sources</option>
            <option value="offline">Offline</option>
            <option value="trade_portal">Portal</option>
            <option value="website">Website</option>
            <option value="referral">Referral</option>
            <option value="wix">Wix</option>
            <option value="admin">Admin</option>
            <option value="salesforce_import">Salesforce</option>
          </select>
          <select value={owner} onChange={(event) => setListState((current) => ({ ...current, owner: event.target.value }))} className="h-9 w-full rounded-md border bg-white px-3 text-[10px] sm:w-auto">
            <option value="all">All owners</option>
            {owners.map((name) => <option key={name}>{name}</option>)}
          </select>
        </div>

        <AdminDesktopTable>
          <table className="w-full text-left">
            <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-[#92969e]">
              <tr>
                <SortTh heading="Deal" column="reference" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh heading="Account" column="client" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh heading="Event" column="event" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh heading="Event date" column="eventDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <th className="px-4 py-2.5 font-medium">Owner / source</th>
                {mode === "finance" ? (
                  <>
                    <th className="px-4 py-2.5 font-medium">Booking form</th>
                    <th className="px-4 py-2.5 font-medium">Payment</th>
                    <th className="px-4 py-2.5 font-medium">Due / Xero</th>
                  </>
                ) : (
                  <>
                    <th className="px-4 py-2.5 text-right font-medium">Revenue</th>
                    <th className="px-4 py-2.5 text-right font-medium">COGS</th>
                    <th className="px-4 py-2.5 text-right font-medium">Gross profit</th>
                    <th className="px-4 py-2.5 text-right font-medium">Margin</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f1f3] text-[10px]">
              {sorted.map((row) => {
                const invoiceStatus =
                  row.overdueSince && row.invoiceStatus === "awaiting_payment"
                    ? "overdue"
                    : row.invoiceStatus
                const paid = isPaid(row)
                return (
                  <tr key={row.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-3">
                      {row.dealId ? (
                        <a href={`/admin/deals/${row.dealId}`} className="font-semibold text-primary hover:underline">
                          {row.dealReference || row.reference}
                        </a>
                      ) : (
                        <p className="font-semibold">{row.dealReference || row.reference}</p>
                      )}
                      {row.dealReference && row.reference !== row.dealReference ? (
                        <p className="mt-0.5 text-[8px] text-slate-400">{row.reference}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <AccountNameLink accountId={row.accountId} name={row.accountName} className="font-medium" />
                      <ContactNameLink accountId={row.accountId} contactId={row.contactId} name={row.contactName} className="mt-0.5 block text-[8px] text-slate-400" />
                    </td>
                    <td className="min-w-[240px] max-w-[420px] px-4 py-3">
                      <p className="whitespace-normal break-words font-medium leading-snug">{row.eventPackage}</p>
                      <p className="mt-0.5 text-[8px] text-slate-400">{row.quantity} unit{row.quantity === 1 ? "" : "s"}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">{formatEventDate(row.eventDate)}</td>
                    <td className="px-4 py-3">
                      <p>{row.ownerName || "Unassigned"}</p>
                      <p className="text-[8px] text-slate-400">{dealSourceLabel(row.dealSource || row.channel)}</p>
                    </td>
                    {mode === "finance" ? (
                      <>
                        <td className="px-4 py-3">
                          <StatusPill tone={tone(row.bookingFormStatus)}>
                            {label(row.bookingFormStatus || "Not created")}
                          </StatusPill>
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill tone={tone(invoiceStatus)}>{label(invoiceStatus || "No invoice")}</StatusPill>
                          <p className="mt-1 font-semibold">{money(row.amountDue, row.currency)} due</p>
                          <p className="text-[8px] text-slate-500">{money(row.total, row.currency)} value</p>
                          {canManage && !paid && row.invoiceStatus !== "cancelled" ? (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => markPaid(row)}
                              className="mt-1 text-[8px] font-semibold text-primary disabled:opacity-50"
                            >
                              Mark paid
                            </button>
                          ) : null}
                          {canManage &&
                          row.invoiceStatus === "paid" &&
                          !["in_fulfilment", "fulfilled"].includes(row.dealStage ?? "") ? (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => markUnpaid(row)}
                              className="mt-1 block text-[8px] font-semibold text-primary disabled:opacity-50"
                            >
                              Mark unpaid
                            </button>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <p>{date(row.invoiceDueDate)}</p>
                          <p className="mt-0.5 text-[8px] text-slate-400">{row.reminderCount} reminder{row.reminderCount === 1 ? "" : "s"}</p>
                          <StatusPill tone={tone(row.xeroSyncStatus)}>{row.xeroSyncStatus || "not queued"}</StatusPill>
                          <p className="mt-1 text-[8px] text-slate-400">{row.xeroInvoiceNumber || row.xeroSyncError || "—"}</p>
                          {row.xeroInvoiceNumber && !row.id.startsWith("deal:") ? (
                            <a href={`/api/invoices/${row.id}/pdf`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[8px] font-semibold text-primary">
                              View invoice
                            </a>
                          ) : null}
                          {canManage &&
                          financeOrderId(row) &&
                          row.channel !== "wix" &&
                          row.invoiceStatus !== "cancelled" &&
                          !paid ? (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => replaceInvoice(row)}
                              className="mt-1 block text-[8px] font-semibold text-primary disabled:opacity-50"
                            >
                              Replace invoice
                            </button>
                          ) : null}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-right font-semibold">{money(row.total, row.currency)}</td>
                        <td className="px-4 py-3 text-right">{row.cogs == null ? "—" : money(row.cogs, row.currency)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-emerald-700">{row.grossProfit == null ? "—" : money(row.grossProfit, row.currency)}</td>
                        <td className="px-4 py-3 text-right">{row.margin == null ? "—" : `${(row.margin * 100).toFixed(1)}%`}</td>
                      </>
                    )}
                  </tr>
                )
              })}
              {sorted.length === 0 ? (
                <tr><td colSpan={mode === "finance" ? 8 : 8} className="px-4 py-12 text-center text-slate-400">No matching deals.</td></tr>
              ) : null}
            </tbody>
          </table>
        </AdminDesktopTable>
        <AdminMobileList>
          {sorted.map((row) => {
            const invoiceStatus =
              row.overdueSince && row.invoiceStatus === "awaiting_payment"
                ? "overdue"
                : row.invoiceStatus
            const paid = isPaid(row)
            return (
              <article key={row.id} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {row.dealId ? (
                      <a href={`/admin/deals/${row.dealId}`} className="font-semibold text-primary">
                        {row.dealReference || row.reference}
                      </a>
                    ) : (
                      <p className="font-semibold">{row.dealReference || row.reference}</p>
                    )}
                    <AccountNameLink accountId={row.accountId} name={row.accountName} className="mt-0.5 block font-medium" />
                    <p className="mt-1 text-[10px] leading-snug text-slate-600">{row.eventPackage}</p>
                    <p className="mt-0.5 text-[8px] text-slate-400">
                      {formatEventDate(row.eventDate)} · {row.quantity} unit{row.quantity === 1 ? "" : "s"}
                    </p>
                  </div>
                  {mode === "finance" ? (
                    <StatusPill tone={tone(invoiceStatus)}>{label(invoiceStatus || "No invoice")}</StatusPill>
                  ) : (
                    <p className="shrink-0 font-semibold">{money(row.total, row.currency)}</p>
                  )}
                </div>
                {mode === "finance" ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[8px] text-slate-500">
                    <span>{money(row.amountDue, row.currency)} due</span>
                    <StatusPill tone={tone(row.bookingFormStatus)}>{label(row.bookingFormStatus || "Not created")}</StatusPill>
                    {row.xeroInvoiceNumber && !row.id.startsWith("deal:") ? (
                      <a href={`/api/invoices/${row.id}/pdf`} target="_blank" rel="noreferrer" className="font-semibold text-primary">
                        View invoice
                      </a>
                    ) : null}
                    {canManage && !paid && row.invoiceStatus !== "cancelled" ? (
                      <button type="button" disabled={pending} onClick={() => markPaid(row)} className="font-semibold text-primary disabled:opacity-50">
                        Mark paid
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-[8px] text-slate-500">
                    {row.grossProfit == null ? "Profit not costed" : `${money(row.grossProfit, row.currency)} GP`}
                    {row.margin == null ? "" : ` · ${(row.margin * 100).toFixed(1)}%`}
                  </p>
                )}
              </article>
            )
          })}
          {sorted.length === 0 ? (
            <p className="px-4 py-12 text-center text-[10px] text-slate-400">No matching deals.</p>
          ) : null}
        </AdminMobileList>
      </AdminPanel>
    </div>
  )
}
