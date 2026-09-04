import Link from "next/link"
import { Suspense } from "react"
import {
  AlertTriangle,
  Boxes,
  CircleDollarSign,
  FileSignature,
  Mail,
  PackageCheck,
  UserRoundPlus,
  UsersRound,
  CircleHelp,
  type LucideIcon,
} from "lucide-react"
import { requireAdmin } from "@/lib/admin/require-admin"
import { createClient } from "@/lib/supabase/server"
import { countPendingBookingApprovalRequests } from "@/lib/booking-approval/queries"
import { bookingFormsAwaitingApprovalHref } from "@/lib/admin/deal-link"
import {
  countNativeBookingFormsReadyToSend,
  listNativeBookingFormsAwaitingApprovalDealIds,
} from "@/lib/booking-forms/queries"
import { getDashboardActionCounts } from "@/lib/admin/dashboard-stats"
import { getNegativeStockRows } from "@/lib/admin/negative-stock-query"
import { getSalesTrackerRows } from "@/lib/admin/workflow-views"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import { DEAL_STAGE_LABELS, dealSourceLabel, type DealStage } from "@/lib/crm/deal-types"
import { orderSaleChannelLabel } from "@/lib/orders/channel"
import {
  AdminPageHeader,
  AdminPanel,
  AdminStatCard,
  AdminStats,
  AdminDesktopTable,
  AdminMobileList,
  SectionTitle,
  StatusPill,
} from "@/components/admin/admin-page-kit"

export const dynamic = "force-dynamic"

function AdminDashboardFallback() {
  return (
    <div className="mx-auto max-w-[1540px] space-y-3 p-3 sm:p-4 lg:p-5 animate-pulse">
      <div className="h-8 w-48 rounded-md bg-muted" />
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-24 rounded-xl bg-muted" />
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="h-64 rounded-xl bg-muted" />
        <div className="h-64 rounded-xl bg-muted" />
      </div>
    </div>
  )
}

export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<AdminDashboardFallback />}>
      <AdminDashboard />
    </Suspense>
  )
}

function money(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function dashboardSalesSource(row: { channel: string; dealSource: string | null }): string {
  if (row.dealSource === "referral") return "Referral"
  const label = orderSaleChannelLabel({ channel: row.channel, dealSource: row.dealSource })
  if (label === "Website") return "Website"
  if (label === "Portal") return "Portal"
  return "Offline"
}

function dashboardDealSource(source: string | null | undefined): string {
  return dealSourceLabel(source)
}

function dealIdNumber(reference: string | null | undefined): number {
  const match = /^DL(\d+)$/i.exec((reference ?? "").trim())
  return match ? Number(match[1]) : -1
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

async function AdminDashboard() {
  const profile = await requireAdmin()
  const supabase = await createClient()

  const [
    { count: pending },
    { count: activeHolds },
    paddockRequests,
    bookingFormsAwaitingDealIds,
    bookingFormsReadyToSend,
    actions,
    { data: inventory },
    negativeStockRows,
    salesRows,
    { data: newestDealRows },
    { data: myDeals },
  ] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
    supabase.from("inventory_holds").select("*", { count: "exact", head: true }).is("released_at", null),
    countPendingBookingApprovalRequests(),
    listNativeBookingFormsAwaitingApprovalDealIds(),
    countNativeBookingFormsReadyToSend(),
    getDashboardActionCounts(),
    supabase.from("package_inventory").select("qty_available"),
    getNegativeStockRows(),
    getSalesTrackerRows(),
    supabase
      .from("deals")
      .select(
        `
        id, reference, source, stage, currency, total_amount, created_at,
        crm_accounts(name),
        deal_line_items(
          sort_order,
          packages(name, races(name, season))
        )
      `,
      )
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("deals")
      .select("id, reference, next_action, next_action_due_at, stage")
      .eq("owner_profile_id", profile.id)
      .not("next_action", "is", null)
      .not("stage", "in", "(fulfilled,closed_lost,cancelled)")
      .order("next_action_due_at", { ascending: true })
      .limit(5),
  ])

  const negativeStock = negativeStockRows.length
  const totalAvailable = (inventory ?? []).reduce(
    (sum, row) => sum + Number(row.qty_available ?? 0),
    0,
  )
  const confirmedSales = salesRows.filter(
    (row) => row.orderStatus !== "cancelled" && row.currency === "USD",
  )
  const workflowRows = salesRows.filter((row) => row.channel !== "salesforce_import")
  const recentDeals = [...(newestDealRows ?? [])]
    .sort((a, b) => dealIdNumber(String(b.reference ?? "")) - dealIdNumber(String(a.reference ?? "")))
    .slice(0, 5)
    .map((deal) => {
      const account = one(deal.crm_accounts as { name: string } | { name: string }[] | null)
      const lines = [...((deal.deal_line_items as Array<{
        sort_order: number
        packages:
          | { name: string; races: { name: string; season: number | null } | { name: string; season: number | null }[] | null }
          | Array<{ name: string; races: { name: string; season: number | null } | { name: string; season: number | null }[] | null }>
          | null
      }> | null) ?? [])].sort((a, b) => a.sort_order - b.sort_order)
      const eventPackage =
        lines
          .map((line) => {
            const pkg = one(line.packages)
            const race = one(pkg?.races)
            const event = race ? eventSeasonLabel(race.name, race.season) : null
            return [event, pkg?.name].filter(Boolean).join(" · ")
          })
          .filter(Boolean)
          .join(", ") || "Product not mapped"
      return {
        id: String(deal.id),
        reference: String(deal.reference ?? ""),
        accountName: account?.name ?? "—",
        eventPackage,
        source: dashboardDealSource(typeof deal.source === "string" ? deal.source : null),
        createdAt: String(deal.created_at),
        total: Number(deal.total_amount ?? 0),
        currency: String(deal.currency || "USD"),
        status: String(deal.stage ?? "open"),
        statusLabel: DEAL_STAGE_LABELS[(deal.stage as DealStage)] ?? String(deal.stage ?? "open").replaceAll("_", " "),
      }
    })
  const currentMonth = new Date().toISOString().slice(0, 7)
  const pipeline = confirmedSales.reduce((sum, row) => sum + row.total, 0)
  const monthSales = confirmedSales.filter((row) => row.createdAt.startsWith(currentMonth))
  const monthRevenue = monthSales.reduce((sum, row) => sum + row.total, 0)
  const monthProfit = monthSales.reduce((sum, row) => sum + (row.grossProfit ?? 0), 0)
  const salesMix = [
    { label: "Portal", colour: "bg-primary" },
    { label: "Offline", colour: "bg-slate-800" },
    { label: "Website", colour: "bg-blue-500" },
    { label: "Referral", colour: "bg-slate-300" },
  ].map((item) => {
    const value = confirmedSales
      .filter((row) => dashboardSalesSource(row) === item.label)
      .reduce((sum, row) => sum + row.total, 0)
    return { ...item, value, percentage: pipeline > 0 ? (value / pipeline) * 100 : 0 }
  })
  const activeWorkflow = workflowRows.filter(
    (row) => !["cancelled", "delivered"].includes(row.fulfilmentStatus),
  )
  const overdueInvoices = activeWorkflow.filter(
    (row) => row.invoiceStatus === "awaiting_payment" && row.overdueSince,
  ).length
  const myOperations = activeWorkflow.filter(
    (row) => row.operationsOwnerId === profile.id || row.ownerId === profile.id,
  )
  const myTaskRows = [
    ...(myDeals ?? []).map((deal) => ({
      label: `${deal.reference}: ${deal.next_action}`,
      href: `/admin/deals/${deal.id}`,
      tag: "Sales",
      due: deal.next_action_due_at,
    })),
    ...myOperations.slice(0, 5).map((order) => ({
      label: `${order.reference}: ${order.eventPackage}`,
      href: "/admin/operations",
      tag: "Operations",
      due: order.guestDetailsDueAt || order.supplierDueAt || order.deliveryDueAt,
    })),
  ].slice(0, 7)
  const approvalRows: Array<{
    icon: LucideIcon
    label: string
    value: number
    href: string
  }> = [
    { icon: UsersRound, label: "Pending users", value: pending ?? 0, href: "/admin/pending-users" },
    { icon: Mail, label: "Booking forms ready to send", value: bookingFormsReadyToSend, href: "/admin/deals?pipeline=ready_to_send" },
    {
      icon: FileSignature,
      label: "Booking forms awaiting approval",
      value: bookingFormsAwaitingDealIds.length,
      href: bookingFormsAwaitingApprovalHref(bookingFormsAwaitingDealIds),
    },
    { icon: AlertTriangle, label: "Negative stock items to purchase", value: negativeStock ?? 0, href: "/admin/inventory/negative-stock" },
    { icon: Boxes, label: "Tickets awaiting delivery", value: actions.awaitingDelivery, href: "/admin/operations" },
    { icon: CircleDollarSign, label: "Overdue invoices", value: overdueInvoices, href: "/admin/finance" },
  ]

  return (
    <div className="mx-auto max-w-[1540px] space-y-3 p-3 sm:p-4 lg:p-5">
      <AdminPageHeader
        title="Dashboard"
        description="Overview of approvals, sales, operations and finance across ZK Sports."
        action={
          <Link
            href="/admin/help"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#e5e7eb] bg-white px-3 text-[11px] font-semibold text-[#3c4043] hover:bg-slate-50"
          >
            <CircleHelp className="h-3.5 w-3.5" />
            Getting started
          </Link>
        }
      />

      <AdminStats className="grid-cols-2 lg:grid-cols-3">
        <AdminStatCard icon={UsersRound} value={pending ?? 0} label="Pending user approvals" hint="Requires admin review" />
        <AdminStatCard
          icon={FileSignature}
          value={paddockRequests}
          label="Paddock Club requests"
          hint="Awaiting a decision"
          tone="red"
        />
        <AdminStatCard
          icon={Mail}
          value={bookingFormsReadyToSend}
          label="Booking forms ready to send"
          hint="Waiting for an admin to send"
          tone="amber"
          href="/admin/deals?pipeline=ready_to_send"
        />
        <AdminStatCard
          icon={UserRoundPlus}
          value={activeHolds ?? 0}
          label="Active stock holds"
          hint="Across portal and sales"
          tone="purple"
        />
        <AdminStatCard
          icon={PackageCheck}
          value={actions.awaitingDelivery}
          label="Orders awaiting fulfilment"
          hint="Paid and ready"
          tone="green"
        />
        <AdminStatCard
          icon={CircleDollarSign}
          value={actions.awaitingPayment}
          label="Outstanding invoices"
          hint="Awaiting payment"
          tone="amber"
        />
      </AdminStats>

      <section className="grid gap-3 xl:grid-cols-2">
        <AdminPanel>
          <SectionTitle title="My tasks" href="/admin/operations" hrefLabel="View all tasks" />
          <div className="divide-y divide-[#f0f1f3]">
            {myTaskRows.map((task) => (
              <Link
                href={task.href}
                key={`${task.href}:${task.label}`}
                className="flex min-w-0 items-center gap-3 px-4 py-3 text-[10px] hover:bg-slate-50"
              >
                <span className="h-3.5 w-3.5 shrink-0 rounded border border-[#d8dbe0]" />
                <span className="min-w-0 flex-1 font-medium text-[#44474d]">{task.label}</span>
                <StatusPill tone="gray">{task.tag}</StatusPill>
                <span className="hidden shrink-0 text-[8px] text-slate-400 sm:inline">{task.due ? shortDate(task.due) : "No due date"}</span>
              </Link>
            ))}
            {myTaskRows.length === 0 ? (
              <p className="px-4 py-8 text-center text-[10px] text-slate-400">No tasks assigned to you.</p>
            ) : null}
          </div>
        </AdminPanel>

        <AdminPanel>
          <SectionTitle title="Approvals & action needed" href="/admin/operations" />
          <div className="divide-y divide-[#f0f1f3]">
            {approvalRows.map((row) => {
              const Icon = row.icon
              return (
              <Link
                href={row.href}
                key={row.label}
                className="flex items-center gap-3 px-4 py-2.5 text-[10px] hover:bg-slate-50"
              >
                <Icon className="h-4 w-4 text-primary" />
                <span className="flex-1 font-medium text-[#44474d]">{row.label}</span>
                <span className="font-semibold text-[#222428]">{row.value}</span>
                <span className="text-slate-300">›</span>
              </Link>
              )
            })}
          </div>
        </AdminPanel>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <AdminPanel>
          <SectionTitle title="Sales overview" href="/admin/sales-tracker" hrefLabel="View tracker" />
          <div className="grid grid-cols-2 divide-x divide-[#eceef1] p-4">
            <div>
              <p className="text-[9px] text-[#8a8e96]">Pipeline value</p>
              <p className="mt-1 text-[18px] font-semibold">{money(pipeline)}</p>
              <p className="mt-1 text-[9px] text-emerald-600">{confirmedSales.length} confirmed sales</p>
            </div>
            <div className="pl-4">
              <p className="text-[9px] text-[#8a8e96]">Available inventory</p>
              <p className="mt-1 text-[18px] font-semibold">{totalAvailable.toLocaleString()}</p>
              <p className="mt-1 text-[9px] text-emerald-600">Live sellable units</p>
            </div>
          </div>
          <div className="border-t border-[#eceef1] px-4 py-3">
            <p className="mb-2 text-[9px] font-medium text-[#6e727a]">Sales mix</p>
            <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
              {salesMix.map((item) => (
                <span
                  key={item.label}
                  className={item.colour}
                  style={{ width: `${item.percentage}%` }}
                  title={`${item.label}: ${item.percentage.toFixed(1)}%`}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-[8px] text-[#8a8e96]">
              {salesMix.map((item) => (
                <span key={item.label}>{item.label} {item.percentage.toFixed(0)}%</span>
              ))}
            </div>
          </div>
        </AdminPanel>

        <AdminPanel>
          <SectionTitle title="Operations & fulfilment" href="/admin/operations" hrefLabel="View orders" />
          <div className="space-y-3 p-4">
            {[
              ["Tickets pending", actions.awaitingDelivery, "bg-blue-500"],
              ["Supplier confirmation needed", negativeStock ?? 0, "bg-amber-500"],
              ["Active stock holds", activeHolds ?? 0, "bg-violet-500"],
            ].map(([label, value, colour]) => (
              <div key={String(label)} className="flex items-center gap-3">
                <span className={`h-2 w-2 rounded-full ${colour}`} />
                <span className="flex-1 text-[10px] text-[#5c6068]">{label}</span>
                <span className="text-[12px] font-semibold">{value}</span>
              </div>
            ))}
          </div>
        </AdminPanel>

        <AdminPanel>
          <SectionTitle title="Finance snapshot" href="/admin/finance" hrefLabel="View finance" />
          <div className="grid grid-cols-2 gap-4 p-4">
            <div>
              <p className="text-[9px] text-[#8a8e96]">Revenue this month</p>
              <p className="mt-1 text-[18px] font-semibold">{money(monthRevenue)}</p>
            </div>
            <div>
              <p className="text-[9px] text-[#8a8e96]">Gross profit</p>
              <p className="mt-1 text-[18px] font-semibold">{money(monthProfit)}</p>
            </div>
          </div>
          <div className="px-4 pb-4">
            <svg viewBox="0 0 260 70" className="h-[70px] w-full" aria-label="Revenue trend">
              <path d="M4 57 L48 39 L91 51 L134 24 L178 42 L220 16 L256 31" fill="none" stroke="#f90202" strokeWidth="2" />
              {[4, 48, 91, 134, 178, 220, 256].map((x, index) => (
                <circle key={x} cx={x} cy={[57, 39, 51, 24, 42, 16, 31][index]} r="2.5" fill="#f90202" />
              ))}
            </svg>
          </div>
        </AdminPanel>
      </section>

      <AdminPanel>
        <SectionTitle title="Recent deals" href="/admin/deals" hrefLabel="View deal pipeline" />
        <AdminDesktopTable>
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-[#92969e]">
              <tr>
                <th className="px-4 py-2 font-medium">Deal</th>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Event / package</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Value</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f1f3] text-[10px]">
              {recentDeals.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-[#34373c]">
                      <Link href={`/admin/deals/${row.id}`} className="text-primary hover:underline">
                        {row.reference}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[#62666e]">{row.accountName}</td>
                    <td className="max-w-[280px] px-4 py-3 text-[#62666e]">
                      <span className="whitespace-normal break-words">{row.eventPackage}</span>
                    </td>
                    <td className="px-4 py-3 text-[#62666e]">{row.source}</td>
                    <td className="px-4 py-3 text-[#8b8f97]">{shortDate(row.createdAt)}</td>
                    <td className="px-4 py-3 font-medium">{money(row.total, row.currency)}</td>
                    <td className="px-4 py-3">
                      <StatusPill
                        tone={
                          row.status === "paid" ||
                          row.status === "paid_confirmed" ||
                          row.status === "confirmed" ||
                          row.status === "fulfilled"
                            ? "green"
                            : row.status === "cancelled" || row.status === "closed_lost"
                              ? "red"
                              : "amber"
                        }
                      >
                        {row.statusLabel}
                      </StatusPill>
                    </td>
                  </tr>
                ))}
              {recentDeals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[10px] text-slate-400">No deals yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </AdminDesktopTable>
        <AdminMobileList>
          {recentDeals.map((row) => (
            <Link key={row.id} href={`/admin/deals/${row.id}`} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold text-primary">{row.reference}</p>
                <p className="mt-0.5 font-medium text-slate-700">{row.accountName}</p>
                <p className="mt-1 text-[10px] leading-snug text-slate-600">{row.eventPackage}</p>
                <p className="mt-0.5 text-[8px] text-slate-400">{row.source} · {shortDate(row.createdAt)}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold">{money(row.total, row.currency)}</p>
                <div className="mt-1">
                  <StatusPill
                    tone={
                      row.status === "paid" ||
                      row.status === "paid_confirmed" ||
                      row.status === "confirmed" ||
                      row.status === "fulfilled"
                        ? "green"
                        : row.status === "cancelled" || row.status === "closed_lost"
                          ? "red"
                          : "amber"
                    }
                  >
                    {row.status.replaceAll("_", " ")}
                  </StatusPill>
                </div>
              </div>
            </Link>
          ))}
          {recentDeals.length === 0 ? (
            <p className="px-4 py-8 text-center text-[10px] text-slate-400">No deals yet.</p>
          ) : null}
        </AdminMobileList>
      </AdminPanel>
    </div>
  )
}
