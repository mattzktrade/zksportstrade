import type { ReactNode } from "react"
import Link from "next/link"
import { AlertTriangle, Banknote, ChevronRight, CircleDollarSign, Truck } from "lucide-react"
import { OperationsDashboardCalendar } from "@/components/admin/operations-dashboard-calendar"
import { getOperationsDashboardModel } from "@/lib/admin/operations-dashboard-model"
import type { OperationsDashboardModel } from "@/lib/admin/operations-dashboard-metrics"
import { formatMoneyCompact } from "@/lib/format/money"
import { cn } from "@/lib/utils"

function money(value: number, currency: string): string {
  return formatMoneyCompact(currency, value, 0)
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  const date = value.includes("T") ? new Date(value) : new Date(`${value.slice(0, 10)}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
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

function paymentStatusLabel(status: "overdue" | "due_soon" | "due"): string {
  if (status === "overdue") return "Overdue"
  if (status === "due_soon") return "Due soon"
  return "Due"
}

function OperationsDashboardView({ data }: { data: OperationsDashboardModel }) {
  const glance = [
    {
      icon: Truck,
      value: data.supplierDeadlinesDue,
      label: "Supplier deadlines due",
      hint: "Upcoming this month",
      href: "/admin/operations?tab=calendar",
    },
    {
      icon: CircleDollarSign,
      value: data.overdueInvoiceCount,
      label: "Overdue invoices",
      hint: "Client invoices past due",
      href: "/admin/finance?status=overdue",
    },
    {
      icon: AlertTriangle,
      value: data.negativeStock,
      label: "Negative stock items",
      hint: "Need purchasing",
      href: "/admin/inventory/negative-stock",
    },
    {
      icon: Banknote,
      value: data.overdueSupplierPayments,
      label: "Overdue supplier payments",
      hint: "Require attention",
      href: "/admin/purchase-orders?payment=overdue",
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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {glance.map((card) => {
          const Icon = card.icon
          return (
            <Link
              key={card.label}
              href={card.href}
              className="flex items-center gap-3 rounded-xl border border-[#eceff3] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:bg-slate-50"
            >
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-primary">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[20px] font-semibold leading-none tracking-tight text-[#17181b] tabular-nums">
                  {card.value}
                </span>
                <span className="mt-1 block text-[12px] font-medium text-[#2c3036]">{card.label}</span>
                <span className="mt-0.5 block text-[10px] text-[#8b9198]">{card.hint}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-[#c5c9ce]" aria-hidden />
            </Link>
          )
        })}
      </section>

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="space-y-3">
          <Card className="p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[13px] font-semibold text-[#1b1c1f]">Operations calendar</h2>
                <p className="mt-0.5 text-[11px] text-[#8b9198]">Upcoming deadlines, deliveries and event dates.</p>
              </div>
              <SectionLink href="/admin/operations?tab=calendar">View full calendar</SectionLink>
            </div>
            <OperationsDashboardCalendar items={data.calendarItems} todayIso={data.todayIso} />
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <h2 className="text-[13px] font-semibold text-[#1b1c1f]">Overdue invoices</h2>
                <p className="text-[11px] text-[#8b9198]">Client invoices past due date.</p>
              </div>
              <SectionLink href="/admin/finance?status=overdue">View all invoices</SectionLink>
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left">
                <thead className="text-[10px] font-medium text-[#8b9198]">
                  <tr className="border-y border-[#f0f2f4]">
                    <th className="px-4 py-2 font-medium">Client</th>
                    <th className="px-4 py-2 font-medium">Invoice #</th>
                    <th className="px-4 py-2 font-medium">Amount</th>
                    <th className="px-4 py-2 font-medium">Days overdue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f2f4f6] text-[12px]">
                  {data.overdueInvoices.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <Link href={row.href} className="font-medium text-[#2c3036] hover:text-primary hover:underline">
                          {row.client}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-[#5c6168]">{row.invoiceNumber}</td>
                      <td className="px-4 py-2.5 font-medium tabular-nums">{money(row.amount, row.currency)}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            "font-medium tabular-nums",
                            row.daysOverdue >= 14 ? "text-red-600" : row.daysOverdue >= 7 ? "text-orange-600" : "text-amber-600",
                          )}
                        >
                          {row.daysOverdue} {row.daysOverdue === 1 ? "day" : "days"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {data.overdueInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-[12px] text-[#9aa0a6]">
                        No overdue client invoices.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-[#f2f4f6] md:hidden">
              {data.overdueInvoices.map((row) => (
                <Link key={row.id} href={row.href} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-[#2c3036]">{row.client}</span>
                    <span className="mt-0.5 block text-[11px] text-[#5c6168]">{row.invoiceNumber}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[12px] font-semibold tabular-nums">{money(row.amount, row.currency)}</span>
                    <span className="mt-0.5 block text-[10px] font-medium text-red-600">{row.daysOverdue}d overdue</span>
                  </span>
                </Link>
              ))}
              {data.overdueInvoices.length === 0 ? (
                <p className="px-4 py-8 text-center text-[12px] text-[#9aa0a6]">No overdue client invoices.</p>
              ) : null}
            </div>
          </Card>
        </div>

        <div className="space-y-3">
          <Card>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <h2 className="text-[13px] font-semibold text-[#1b1c1f]">Stock items to purchase</h2>
                <p className="text-[11px] text-[#8b9198]">Items we still need to buy.</p>
              </div>
              <SectionLink href="/admin/inventory/negative-stock">View all stock items</SectionLink>
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left">
                <thead className="text-[10px] font-medium text-[#8b9198]">
                  <tr className="border-y border-[#f0f2f4]">
                    <th className="px-4 py-2 font-medium">Item</th>
                    <th className="px-4 py-2 font-medium">Current</th>
                    <th className="px-4 py-2 font-medium">Need</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f2f4f6] text-[12px]">
                  {data.stockToBuy.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-[#2c3036]">{row.name}</td>
                      <td className="px-4 py-2.5 font-semibold tabular-nums text-red-600">{row.current}</td>
                      <td className="px-4 py-2.5 font-semibold tabular-nums">{row.need}</td>
                      <td className="px-4 py-2.5">
                        <Link href={row.href} className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline">
                          Order now
                          <ChevronRight className="h-3 w-3" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {data.stockToBuy.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-[12px] text-[#9aa0a6]">
                        Nothing waiting to purchase.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-[#f2f4f6] sm:hidden">
              {data.stockToBuy.map((row) => (
                <Link key={row.id} href={row.href} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-[#2c3036]">{row.name}</span>
                    <span className="mt-0.5 block text-[11px] text-red-600">Current {row.current} · Need {row.need}</span>
                  </span>
                  <span className="text-[11px] font-medium text-primary">Order now</span>
                </Link>
              ))}
              {data.stockToBuy.length === 0 ? (
                <p className="px-4 py-8 text-center text-[12px] text-[#9aa0a6]">Nothing waiting to purchase.</p>
              ) : null}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <h2 className="text-[13px] font-semibold text-[#1b1c1f]">Finance & payments</h2>
                <p className="text-[11px] text-[#8b9198]">Supplier payments and upcoming purchase commitments.</p>
              </div>
              <SectionLink href="/admin/purchase-orders">View all payments</SectionLink>
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left">
                <thead className="text-[10px] font-medium text-[#8b9198]">
                  <tr className="border-y border-[#f0f2f4]">
                    <th className="px-4 py-2 font-medium">Supplier / Description</th>
                    <th className="px-4 py-2 font-medium">Amount</th>
                    <th className="px-4 py-2 font-medium">Due date</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f2f4f6] text-[12px]">
                  {data.supplierPayments.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <Link href={row.href} className="block hover:text-primary">
                          <span className="block font-medium text-[#2c3036]">{row.supplier}</span>
                          <span className="mt-0.5 block text-[11px] text-[#8b9198]">{row.description}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 font-medium tabular-nums">{money(row.amount, row.currency)}</td>
                      <td className="px-4 py-2.5 text-[#5c6168]">{formatDate(row.dueDate)}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            "text-[11px] font-medium",
                            row.status === "overdue" ? "text-red-600" : "text-amber-600",
                          )}
                        >
                          {paymentStatusLabel(row.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {data.supplierPayments.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-[12px] text-[#9aa0a6]">
                        No supplier payments due.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-[#f2f4f6] sm:hidden">
              {data.supplierPayments.map((row) => (
                <Link key={row.id} href={row.href} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-[#2c3036]">{row.supplier}</span>
                    <span className="mt-0.5 block text-[11px] text-[#8b9198]">{row.description}</span>
                    <span className="mt-0.5 block text-[10px] text-[#9aa0a6]">{formatDate(row.dueDate)}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[12px] font-semibold tabular-nums">{money(row.amount, row.currency)}</span>
                    <span className={cn("mt-0.5 block text-[10px] font-medium", row.status === "overdue" ? "text-red-600" : "text-amber-600")}>
                      {paymentStatusLabel(row.status)}
                    </span>
                  </span>
                </Link>
              ))}
              {data.supplierPayments.length === 0 ? (
                <p className="px-4 py-8 text-center text-[12px] text-[#9aa0a6]">No supplier payments due.</p>
              ) : null}
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[13px] font-semibold text-[#1b1c1f]">Upcoming races</h2>
                <p className="mt-0.5 text-[11px] text-[#8b9198]">Next 3 race weekends.</p>
              </div>
              <SectionLink href="/admin/catalog/events">View full race calendar</SectionLink>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {data.upcomingRaces.map((race) => (
                <Link
                  key={race.id}
                  href={race.href}
                  className="rounded-lg border border-[#f0f2f4] px-3 py-2.5 hover:bg-slate-50"
                >
                  <span className="flex items-start gap-2">
                    {race.flagUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={race.flagUrl}
                        alt=""
                        width={20}
                        height={14}
                        className="mt-0.5 h-3.5 w-5 rounded-[2px] object-cover"
                      />
                    ) : (
                      <span className="mt-0.5 text-[10px] font-semibold text-[#8b9198]">{race.countryCode || "—"}</span>
                    )}
                    <span className="min-w-0">
                      <span className="block text-[12px] font-semibold text-[#1b1c1f]">{race.name}</span>
                      <span className="mt-0.5 block text-[10px] text-[#5c6168]">{race.dateRange}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-[#8b9198]">{race.circuit}</span>
                    </span>
                  </span>
                </Link>
              ))}
              {data.upcomingRaces.length === 0 ? (
                <p className="col-span-full py-6 text-center text-[12px] text-[#9aa0a6]">No upcoming races on the calendar.</p>
              ) : null}
            </div>
          </Card>
        </div>
      </section>
    </div>
  )
}

export async function OperationsRoleDashboard() {
  const data = await getOperationsDashboardModel()
  return <OperationsDashboardView data={data} />
}
