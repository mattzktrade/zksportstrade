import type { ReactNode } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Mail,
  PackageCheck,
  UserRound,
} from "lucide-react"
import { getAdminDashboardModel } from "@/lib/admin/admin-dashboard-model"
import {
  chartTicks,
  formatCompactAxis,
  niceChartMax,
  type AdminDashboardModel,
  type MonthBucket,
} from "@/lib/admin/admin-dashboard-metrics"
import { formatMoneyCompact } from "@/lib/format/money"
import { cn } from "@/lib/utils"

function money(value: number, currency: string): string {
  return formatMoneyCompact(currency, value, 0)
}

function confirmedDate(value: string): string {
  const date = value.includes("T") ? new Date(value) : new Date(`${value.slice(0, 10)}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

function Trend({
  change,
  previousLabel,
}: {
  change: number | null
  previousLabel: string
}) {
  if (change == null) {
    return <p className="mt-1 text-[10px] text-[#9aa0a6]">No prior month to compare</p>
  }
  const up = change > 0
  const down = change < 0
  const Icon = up ? ArrowUp : down ? ArrowDown : ArrowUp
  return (
    <p
      className={cn(
        "mt-1 flex items-center gap-0.5 text-[10px] font-medium",
        up ? "text-emerald-600" : down ? "text-red-600" : "text-[#9aa0a6]",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {Math.abs(change)}% vs {previousLabel}
    </p>
  )
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-[#eceff3] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]", className)}>
      {children}
    </section>
  )
}

function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline"
    >
      {children}
      <ChevronRight className="h-3 w-3" aria-hidden />
    </Link>
  )
}

function SalesTrendChart({ months, currency }: { months: MonthBucket[]; currency: string }) {
  const peak = Math.max(...months.flatMap((month) => [month.revenue, month.profit]), 0)
  const max = niceChartMax(peak)
  const ticks = [...chartTicks(max)].reverse()
  return (
    <div className="mt-4">
      <div className="flex gap-2.5">
        <div className="flex h-32 w-11 shrink-0 flex-col justify-between py-0.5 text-right text-[9px] tabular-nums text-[#9aa0a6]">
          {ticks.map((tick) => (
            <span key={tick}>{formatCompactAxis(tick, currency)}</span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
            {ticks.map((tick) => (
              <div key={tick} className="border-t border-[#f1f3f5]" />
            ))}
          </div>
          <div className="relative flex h-32 items-end justify-between gap-1.5 px-1">
            {months.map((month) => (
              <div key={month.key} className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5">
                <div
                  className="w-2 rounded-t-[2px] bg-[#e10600] sm:w-2.5"
                  style={{ height: `${max > 0 ? (month.revenue / max) * 100 : 0}%` }}
                  title={`${month.label} revenue ${money(month.revenue, currency)}`}
                />
                <div
                  className="w-2 rounded-t-[2px] bg-[#f6c1c1] sm:w-2.5"
                  style={{ height: `${max > 0 ? (Math.max(month.profit, 0) / max) * 100 : 0}%` }}
                  title={`${month.label} profit ${money(month.profit, currency)}`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex justify-between gap-1 pl-12 text-center text-[10px] text-[#8b9198]">
        {months.map((month) => (
          <span key={month.key} className="min-w-0 flex-1 truncate">
            {month.label.split(" ")[0]}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-center gap-4 text-[10px] text-[#6b7077]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#e10600]" />
          Revenue
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#f6c1c1]" />
          Profit
        </span>
      </div>
    </div>
  )
}

function AdminDashboardView({ data }: { data: AdminDashboardModel }) {
  const approvalRows = [
    {
      icon: UserRound,
      label: "Pending users",
      value: data.pendingUsers,
      href: "/admin/pending-users",
    },
    {
      icon: FileText,
      label: "Paddock Club requests",
      value: data.paddockRequests,
      href: "/admin/booking-requests",
    },
    {
      icon: Mail,
      label: "Booking forms awaiting approval",
      value: data.bookingFormsAwaiting,
      href: data.bookingFormsHref,
    },
    {
      icon: AlertTriangle,
      label: "Negative stock items to purchase",
      value: data.negativeStock,
      href: "/admin/inventory/negative-stock",
    },
    {
      icon: CircleDollarSign,
      label: "Overdue invoices",
      value: data.overdueInvoices,
      href: "/admin/finance?status=overdue",
    },
    {
      icon: PackageCheck,
      label: "Orders waiting fulfilment",
      value: data.awaitingFulfilment,
      href: "/admin/operations",
    },
  ] as const

  return (
    <div className="mx-auto max-w-[1540px] space-y-3 p-3 sm:p-4 lg:p-5">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#17181b]">{data.title}</h1>
          <p className="mt-0.5 text-[11px] text-[#80858d]">{data.description}</p>
        </div>
        <p className="text-[11px] text-[#9aa0a6] sm:pt-1.5">{data.generatedAtLabel}</p>
      </header>

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.9fr)]">
        <Card className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold text-[#1b1c1f]">Sales overview</h2>
              <p className="mt-0.5 text-[11px] text-[#8b9198]">Current month performance and last 6 months trend.</p>
            </div>
            <SectionLink href="/admin/sales-tracker">View sales tracker</SectionLink>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[20px] font-semibold leading-none tracking-tight text-[#17181b] tabular-nums">
                {money(data.revenue, data.currency)}
              </p>
              <p className="mt-1.5 text-[11px] text-[#6b7077]">Revenue ({data.monthLabel})</p>
              <Trend change={data.revenueChange} previousLabel={data.previousMonthLabel} />
            </div>
            <div>
              <p className="text-[20px] font-semibold leading-none tracking-tight text-[#17181b] tabular-nums">
                {money(data.profit, data.currency)}
              </p>
              <p className="mt-1.5 text-[11px] text-[#6b7077]">Profit ({data.monthLabel})</p>
              <Trend change={data.profitChange} previousLabel={data.previousMonthLabel} />
            </div>
            <div>
              <p className="text-[20px] font-semibold leading-none tracking-tight text-[#17181b] tabular-nums">
                {data.confirmedDeals}
              </p>
              <p className="mt-1.5 text-[11px] text-[#6b7077]">Confirmed deals ({data.monthLabel})</p>
              <Trend change={data.dealsChange} previousLabel={data.previousMonthLabel} />
            </div>
          </div>
          <SalesTrendChart months={data.months} currency={data.currency} />
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <h2 className="text-[13px] font-semibold text-[#1b1c1f]">Approvals & action needed</h2>
            <SectionLink href="/admin/operations">View all tasks</SectionLink>
          </div>
          <div className="divide-y divide-[#f2f4f6]">
            {approvalRows.map((row) => {
              const Icon = row.icon
              return (
                <Link
                  key={row.label}
                  href={row.href}
                  className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50"
                >
                  <Icon className="h-3.5 w-3.5 text-primary" />
                  <span className="flex-1 text-[12px] font-medium text-[#3d4148]">{row.label}</span>
                  <span className="text-[12px] font-semibold tabular-nums text-[#1b1c1f]">{row.value}</span>
                </Link>
              )
            })}
          </div>
        </Card>
      </section>

      <Card>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <h2 className="text-[13px] font-semibold text-[#1b1c1f]">Recent confirmed deals</h2>
          <SectionLink href="/admin/deals?pipeline=won">View all sales</SectionLink>
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[640px] text-left">
            <thead className="text-[10px] font-medium text-[#8b9198]">
              <tr className="border-y border-[#f0f2f4]">
                <th className="px-4 py-2 font-medium">Deal</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Event / Package</th>
                <th className="px-4 py-2 font-medium">Value</th>
                <th className="px-4 py-2 font-medium">Date confirmed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f2f4f6] text-[12px]">
              {data.recentDeals.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium">
                    <Link href={row.href} className="text-primary hover:underline">
                      {row.dealNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-[#2c3036]">{row.client}</td>
                  <td className="px-4 py-2.5 text-[#5c6168]">
                    <span className="whitespace-normal break-words">{row.eventPackage}</span>
                  </td>
                  <td className="px-4 py-2.5 font-medium tabular-nums text-[#2c3036]">
                    {money(row.value, row.currency)}
                  </td>
                  <td className="px-4 py-2.5 text-[#8b9198]">{confirmedDate(row.confirmedAt)}</td>
                </tr>
              ))}
              {data.recentDeals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[12px] text-[#9aa0a6]">
                    No confirmed deals yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-[#f2f4f6] md:hidden">
          {data.recentDeals.map((row) => (
            <Link key={row.id} href={row.href} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold text-primary">{row.dealNumber}</span>
                <span className="mt-0.5 block text-[12px] font-medium text-[#2c3036]">{row.client}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-[#5c6168]">{row.eventPackage}</span>
                <span className="mt-0.5 block text-[10px] text-[#9aa0a6]">{confirmedDate(row.confirmedAt)}</span>
              </span>
              <span className="shrink-0 text-[12px] font-semibold tabular-nums">{money(row.value, row.currency)}</span>
            </Link>
          ))}
          {data.recentDeals.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12px] text-[#9aa0a6]">No confirmed deals yet.</p>
          ) : null}
        </div>
      </Card>
    </div>
  )
}

export async function AdminRoleDashboard() {
  const data = await getAdminDashboardModel()
  return <AdminDashboardView data={data} />
}
