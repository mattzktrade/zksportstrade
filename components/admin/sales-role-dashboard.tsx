import type { ReactNode } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  Briefcase,
  ChevronRight,
  CircleCheck,
  CircleDollarSign,
  Clock,
  FileSignature,
  FileText,
  Mail,
  MessageSquare,
  Percent,
  Phone,
  Search,
  Send,
  TrendingUp,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getSalesDashboardModel } from "@/lib/admin/sales-dashboard-model"
import {
  chartTicks,
  formatCompactAxis,
  niceChartMax,
} from "@/lib/admin/admin-dashboard-metrics"
import {
  salesChartHasValues,
  type SalesActivityKind,
  type SalesDashboardModel,
  type SalesMonthBucket,
  type SalesPipelineRowId,
} from "@/lib/admin/sales-dashboard-metrics"
import { relativeActivityTime } from "@/lib/crm/deal-pipeline"
import { formatMoneyCompact } from "@/lib/format/money"
import { cn } from "@/lib/utils"

function money(value: number, currency: string): string {
  return formatMoneyCompact(currency, value, 0)
}

function receivedDate(value: string): string {
  const date = value.includes("T") ? new Date(value) : new Date(`${value.slice(0, 10)}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
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
  if (change == null) return null
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
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">
        {Math.abs(change)}% vs {previousLabel}
      </span>
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

const PIPELINE_ICONS: Record<SalesPipelineRowId, LucideIcon> = {
  new: UserPlus,
  contacted: Phone,
  responded: MessageSquare,
  sourcing_required: Search,
  sourcing_complete: CircleCheck,
  price_sent: Send,
  follow_up: Clock,
  not_interested: Ban,
  ready_to_send: FileSignature,
  booking_form: FileText,
  form_expired: AlertTriangle,
  awaiting_payment: CircleDollarSign,
  won: CircleCheck,
  lost: X,
}

const ACTIVITY_ICONS: Record<SalesActivityKind, LucideIcon> = {
  email: Mail,
  call: Phone,
  proposal: Send,
  booking_form: FileSignature,
  assigned: UserPlus,
  won: CircleCheck,
  lost: X,
  note: FileText,
}

function monthShortLabel(label: string): string {
  return label.split(" ")[0] ?? label
}

function SalesTrendChart({ months, currency }: { months: SalesMonthBucket[]; currency: string }) {
  if (!salesChartHasValues(months)) {
    return (
      <div className="mt-4 min-w-0">
        <div className="flex min-h-[8.5rem] items-center justify-center rounded-lg bg-[#fafbfc] px-4 py-6">
          <p className="max-w-[280px] text-center text-[12px] leading-relaxed text-[#8b9198]">
            No confirmed sales or new pipeline in the last 6 months.
          </p>
        </div>
        <div className="mt-2 flex justify-between gap-1 text-center text-[10px] text-[#c5c9ce]">
          {months.map((month) => (
            <span key={month.key} className="min-w-0 flex-1 truncate">
              {monthShortLabel(month.label)}
            </span>
          ))}
        </div>
      </div>
    )
  }

  const peak = Math.max(0, ...months.flatMap((month) => [month.sales, month.pipeline]))
  const max = niceChartMax(peak)
  const ticks = [...chartTicks(max)].reverse()
  return (
    <div className="mt-4 min-w-0">
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="grid min-w-[280px] grid-cols-[auto_minmax(0,1fr)] gap-x-2 sm:min-w-0">
          <div className="flex h-32 min-w-[2.5rem] flex-col justify-between py-0.5 text-right text-[9px] leading-none tabular-nums text-[#9aa0a6]">
            {ticks.map((tick) => (
              <span key={tick}>{formatCompactAxis(tick, currency)}</span>
            ))}
          </div>
          <div className="relative min-w-0">
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
              {ticks.map((tick) => (
                <div key={tick} className="border-t border-[#f1f3f5]" />
              ))}
            </div>
            <div className="relative flex h-32 items-end justify-between gap-1 px-0.5 sm:gap-1.5">
              {months.map((month) => (
                <div key={month.key} className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5">
                  <div
                    className="w-1.5 rounded-t-[2px] bg-[#e10600] sm:w-2.5"
                    style={{ height: `${max > 0 ? (month.sales / max) * 100 : 0}%` }}
                    title={`${month.label} sales ${money(month.sales, currency)}`}
                  />
                  <div
                    className="w-1.5 rounded-t-[2px] bg-[#f6c1c1] sm:w-2.5"
                    style={{ height: `${max > 0 ? (month.pipeline / max) * 100 : 0}%` }}
                    title={`${month.label} new pipeline ${money(month.pipeline, currency)}`}
                  />
                </div>
              ))}
            </div>
          </div>
          <div />
          <div className="mt-2 flex justify-between gap-1 text-center text-[10px] text-[#8b9198]">
            {months.map((month) => (
              <span key={month.key} className="min-w-0 flex-1 truncate">
                {monthShortLabel(month.label)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px] text-[#6b7077]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#e10600]" />
          Sales value
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#f6c1c1]" />
          New pipeline
        </span>
      </div>
    </div>
  )
}

function SalesDashboardView({ data }: { data: SalesDashboardModel }) {
  const glance = [
    {
      icon: UserPlus,
      iconClass: "bg-red-50 text-primary",
      value: data.unassignedCount,
      label: "New unassigned enquiries",
      hint: "Awaiting assignment",
      href: data.unassignedHref,
      trend: null as number | null,
    },
    {
      icon: TrendingUp,
      iconClass: "bg-emerald-50 text-emerald-600",
      value: money(data.revenue, data.currency),
      label: "Your sales this month",
      hint: null,
      href: "/admin/sales-tracker",
      trend: data.revenueChange,
    },
    {
      icon: Briefcase,
      iconClass: "bg-violet-50 text-violet-600",
      value: money(data.pipelineValue, data.currency),
      label: "Pipeline value",
      hint: `Across ${data.opportunityCount} ${data.opportunityCount === 1 ? "opportunity" : "opportunities"}`,
      href: "/admin/deals",
      trend: null,
    },
    {
      icon: Percent,
      iconClass: "bg-orange-50 text-orange-600",
      value: data.conversionRate == null ? "—" : `${data.conversionRate}%`,
      label: "Conversion rate",
      hint: "Won vs closed lost",
      href: "/admin/deals?pipeline=won",
      trend: null,
    },
  ] as const

  return (
    <div className="mx-auto max-w-[1540px] min-w-0 space-y-3 p-3 sm:p-4 lg:p-5">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#17181b]">{data.title}</h1>
          <p className="mt-0.5 text-[11px] text-[#80858d]">{data.description}</p>
        </div>
        <p className="text-[11px] text-[#9aa0a6] sm:pt-1.5">{data.generatedAtLabel}</p>
      </header>

      <section className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {glance.map((card) => {
          const Icon = card.icon
          return (
            <Link
              key={card.label}
              href={card.href}
              className="flex min-w-0 items-center gap-3 rounded-xl border border-[#eceff3] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:bg-slate-50"
            >
              <span className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full", card.iconClass)}>
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[20px] font-semibold leading-none tracking-tight text-[#17181b] tabular-nums">
                  {card.value}
                </span>
                <span className="mt-1 block text-[12px] font-medium text-[#2c3036]">{card.label}</span>
                {card.hint ? (
                  <span className="mt-0.5 block text-[10px] text-[#8b9198]">{card.hint}</span>
                ) : (
                  <Trend change={card.trend} previousLabel={data.previousMonthLabel} />
                )}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-[#c5c9ce]" aria-hidden />
            </Link>
          )
        })}
      </section>

      <section className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.9fr)]">
        <Card className="min-w-0 p-4">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <h2 className="text-[13px] font-semibold text-[#1b1c1f]">Your monthly performance</h2>
              <p className="mt-0.5 text-[11px] text-[#8b9198]">
                Confirmed sales and new pipeline opened over the last 6 months.
              </p>
            </div>
            <SectionLink href="/admin/sales-tracker">View sales tracker</SectionLink>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 min-[480px]:grid-cols-3">
            <div className="min-w-0">
              <p className="truncate text-[18px] font-semibold leading-none tracking-tight text-[#17181b] tabular-nums sm:text-[20px]">
                {money(data.revenue, data.currency)}
              </p>
              <p className="mt-1.5 text-[11px] leading-snug text-[#6b7077]">Sales value ({data.monthLabel})</p>
              <Trend change={data.revenueChange} previousLabel={data.previousMonthLabel} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[18px] font-semibold leading-none tracking-tight text-[#17181b] tabular-nums sm:text-[20px]">
                {data.confirmedDeals}
              </p>
              <p className="mt-1.5 text-[11px] leading-snug text-[#6b7077]">Confirmed deals ({data.monthLabel})</p>
              <Trend change={data.dealsChange} previousLabel={data.previousMonthLabel} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[18px] font-semibold leading-none tracking-tight text-[#17181b] tabular-nums sm:text-[20px]">
                {money(data.newPipeline, data.currency)}
              </p>
              <p className="mt-1.5 text-[11px] leading-snug text-[#6b7077]">New pipeline ({data.monthLabel})</p>
              <Trend change={data.newPipelineChange} previousLabel={data.previousMonthLabel} />
            </div>
          </div>
          <SalesTrendChart months={data.months} currency={data.currency} />
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <h2 className="text-[13px] font-semibold text-[#1b1c1f]">Sales pipeline</h2>
            <SectionLink href="/admin/deals">View all opportunities</SectionLink>
          </div>
          <div className="divide-y divide-[#f2f4f6]">
            {data.pipelineRows.map((row, index) => {
              const Icon = PIPELINE_ICONS[row.id]
              const showGroup = row.group !== data.pipelineRows[index - 1]?.group
              return (
                <div key={row.id}>
                  {showGroup ? (
                    <p className="px-4 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-wide text-[#8b9198]">
                      {row.group === "enquiry" ? "Enquiries" : "Deals"}
                    </p>
                  ) : null}
                  <Link href={row.href} className="flex items-center gap-2.5 px-4 py-2 hover:bg-slate-50">
                    <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
                    <span className="flex-1 text-[12px] font-medium text-[#3d4148]">{row.label}</span>
                    <span className="text-[12px] font-semibold tabular-nums text-[#1b1c1f]">{row.count}</span>
                  </Link>
                </div>
              )
            })}
          </div>
        </Card>
      </section>

      <section className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
        <Card>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <h2 className="text-[13px] font-semibold text-[#1b1c1f]">Unassigned new enquiries</h2>
            <SectionLink href={data.unassignedHref}>View all enquiries</SectionLink>
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[520px] text-left">
              <thead className="text-[10px] font-medium text-[#8b9198]">
                <tr className="border-y border-[#f0f2f4]">
                  <th className="px-4 py-2 font-medium">Enquiry</th>
                  <th className="px-4 py-2 font-medium">Event / interest</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Date received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f2f4f6] text-[12px]">
                {data.unassigned.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium">
                      <Link href={row.href} className="text-primary hover:underline">
                        {row.reference}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-[#5c6168]">
                      <span className="whitespace-normal break-words">{row.interest}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[#2c3036]">{row.source}</td>
                    <td className="px-4 py-2.5 text-[#8b9198]">{receivedDate(row.receivedAt)}</td>
                  </tr>
                ))}
                {data.unassigned.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-[12px] text-[#9aa0a6]">
                      No unassigned new enquiries.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-[#f2f4f6] md:hidden">
            {data.unassigned.map((row) => (
              <Link key={row.id} href={row.href} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-primary">{row.reference}</span>
                  <span className="mt-0.5 block text-[12px] font-medium text-[#2c3036]">{row.interest}</span>
                  <span className="mt-0.5 block text-[11px] text-[#5c6168]">{row.source}</span>
                </span>
                <span className="shrink-0 text-[11px] text-[#8b9198]">{receivedDate(row.receivedAt)}</span>
              </Link>
            ))}
            {data.unassigned.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12px] text-[#9aa0a6]">No unassigned new enquiries.</p>
            ) : null}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <h2 className="text-[13px] font-semibold text-[#1b1c1f]">Recent activity</h2>
            <SectionLink href="/admin/enquiries">View enquiries</SectionLink>
          </div>
          <div className="divide-y divide-[#f2f4f6]">
            {data.recentActivity.map((row) => {
              const Icon = ACTIVITY_ICONS[row.kind]
              return (
                <Link key={row.id} href={row.href} className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-slate-50">
                  <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-50 text-primary">
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium leading-snug text-[#2c3036]">{row.summary}</span>
                    <span className="mt-0.5 block text-[10px] text-[#8b9198]">{relativeActivityTime(row.createdAt)}</span>
                  </span>
                </Link>
              )
            })}
            {data.recentActivity.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12px] text-[#9aa0a6]">No recent activity on your records.</p>
            ) : null}
          </div>
        </Card>
      </section>
    </div>
  )
}

export async function SalesRoleDashboard() {
  const profile = await requireAdmin()
  const data = await getSalesDashboardModel(profile)
  return <SalesDashboardView data={data} />
}
