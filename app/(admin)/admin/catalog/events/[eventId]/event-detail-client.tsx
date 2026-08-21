"use client"

import { useMemo } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Boxes,
  CalendarDays,
  CircleDollarSign,
  MapPin,
  Package,
  Search,
  ShoppingCart,
} from "lucide-react"
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
import { adminPackagePath } from "@/lib/admin/package-link"
import type { NativeEventDetail } from "@/lib/admin/event-detail"
import { EVENT_CATEGORY_LABELS } from "@/lib/catalog/event-categories"
import { formatMoney } from "@/lib/format/money"
import { usePersistedAdminFilters } from "@/lib/admin/use-persisted-admin-filters"

function formatDate(value: string): string {
  if (!value) return "—"
  const date = value.length <= 10 ? `${value}T00:00:00.000Z` : value
  return new Date(date).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

function saleStatusTone(sale: NativeEventDetail["sales"][number]): "green" | "amber" | "blue" | "gray" {
  if (sale.kind === "order" || sale.confirmed) return "green"
  if (/awaiting|signed|booking/i.test(sale.status)) return "amber"
  if (/proposal|draft|sourcing/i.test(sale.status)) return "blue"
  return "gray"
}

export function EventDetailClient({ detail }: { detail: NativeEventDetail }) {
  const { event, products, sales, totals } = detail
  const [listState, setListState] = usePersistedAdminFilters(`zk-admin-event-detail-filters-v1:${event.id}`, {
    saleQuery: "",
    saleFilter: "all" as "all" | "confirmed" | "pipeline",
  })
  const { saleQuery, saleFilter } = listState

  const filteredSales = useMemo(() => {
    const q = saleQuery.trim().toLowerCase()
    return sales.filter((sale) => {
      if (saleFilter === "confirmed" && !sale.confirmed) return false
      if (saleFilter === "pipeline" && sale.confirmed) return false
      if (!q) return true
      return [
        sale.reference,
        sale.clientName,
        sale.contactName,
        sale.productName,
        sale.status,
        sale.source,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    })
  }, [saleFilter, saleQuery, sales])

  return (
    <div className="space-y-4">
      <Link
        href="/admin/catalog/events"
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All events
      </Link>

      <AdminPageHeader
        title={event.name}
        description={`${EVENT_CATEGORY_LABELS[event.category]} · ${event.season} · ${event.dateRange || formatDate(event.eventDate)}`}
      />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#eceef1] bg-white p-4">
        <div
          className="h-20 w-28 rounded-md bg-cover bg-center"
          style={{ backgroundImage: `url("${event.image.replaceAll('"', "%22")}")` }}
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{event.shortName || event.name}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
            <MapPin className="h-3.5 w-3.5" />
            {event.location}, {event.country}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
            <CalendarDays className="h-3.5 w-3.5" />
            {formatDate(event.eventDate)}
            {event.dateRange ? ` · ${event.dateRange}` : ""}
          </p>
        </div>
        <div className="ml-auto">
          <StatusPill tone={event.isArchived ? "gray" : "green"}>
            {event.isArchived ? "Archived" : "Active"}
          </StatusPill>
        </div>
      </div>

      <AdminStats className="sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard icon={Package} value={totals.productCount} label="Products" tone="blue" />
        <AdminStatCard icon={ShoppingCart} value={totals.sold} label="Units sold" tone="green" />
        <AdminStatCard icon={Boxes} value={totals.pipeline} label="In pipeline" tone="amber" />
        <AdminStatCard
          icon={CircleDollarSign}
          value={formatMoney(totals.currency, totals.revenue)}
          label="Confirmed sales value"
          hint={`${totals.remaining} remaining`}
          tone="purple"
        />
      </AdminStats>

      <AdminPanel>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-[13px] font-semibold">Products</h2>
          <p className="text-[10px] text-slate-500">{products.length} linked to this event</p>
        </div>
        <AdminDesktopTable>
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Bought</th>
                <th className="px-4 py-3 font-medium">Sold</th>
                <th className="px-4 py-3 font-medium">Pipeline</th>
                <th className="px-4 py-3 font-medium">Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.map((product) => (
                <tr key={product.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={adminPackagePath(product.id)}
                      className="font-semibold hover:text-primary hover:underline"
                    >
                      {product.name}
                    </Link>
                    {product.hidden ? (
                      <span className="ml-2">
                        <StatusPill tone="gray">Hidden</StatusPill>
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{product.durationLabel}</td>
                  <td className="px-4 py-3">{formatMoney(product.currency, product.price)}</td>
                  <td className="px-4 py-3 tabular-nums">{product.bought}</td>
                  <td className="px-4 py-3 tabular-nums font-semibold">{product.sold}</td>
                  <td className="px-4 py-3 tabular-nums text-amber-700">{product.pipeline || "—"}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {product.available}
                    {product.held > 0 ? (
                      <span className="ml-1 text-[10px] font-normal text-slate-400">({product.held} held)</span>
                    ) : null}
                  </td>
                </tr>
              ))}
              {products.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    No products are linked to this event yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </AdminDesktopTable>
        <AdminMobileList>
          {products.map((product) => (
            <Link key={product.id} href={adminPackagePath(product.id)} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold text-primary">{product.name}</p>
                <p className="mt-0.5 text-[10px] text-slate-600">{product.durationLabel}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold">{formatMoney(product.currency, product.price)}</p>
                <p className="mt-0.5 text-[8px] text-slate-500">{product.available} remaining</p>
              </div>
            </Link>
          ))}
          {products.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">No products are linked to this event yet.</p>
          ) : null}
        </AdminMobileList>
      </AdminPanel>

      <AdminPanel>
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <h2 className="text-[13px] font-semibold">Sales</h2>
          <div className="relative min-w-0 w-full flex-1 sm:min-w-[220px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={saleQuery}
              onChange={(event) => setListState((current) => ({ ...current, saleQuery: event.target.value }))}
              placeholder="Search client, product, reference..."
              className="h-9 w-full rounded-md border pl-9 pr-3 text-[11px] outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex rounded-md border bg-slate-50 p-0.5 text-[10px] font-medium">
            {([
              ["all", `All (${sales.length})`],
              ["confirmed", `Sold (${sales.filter((sale) => sale.confirmed).length})`],
              ["pipeline", `Pipeline (${sales.filter((sale) => !sale.confirmed).length})`],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setListState((current) => ({ ...current, saleFilter: value }))}
                className={`h-8 rounded px-3 ${saleFilter === value ? "bg-white shadow-sm" : "text-slate-500"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <AdminDesktopTable>
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Qty</th>
                <th className="px-4 py-3 font-medium">Value</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredSales.map((sale) => (
                <tr key={sale.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-[12px] text-slate-600">{formatDate(sale.date)}</td>
                  <td className="px-4 py-3">
                    <Link href={sale.href} className="font-semibold hover:text-primary hover:underline">
                      {sale.reference}
                    </Link>
                    <p className="text-[11px] text-slate-500">
                      <AccountNameLink accountId={sale.accountId} name={sale.clientName} />
                      {sale.contactName ? (
                        <>
                          {" · "}
                          <ContactNameLink
                            accountId={sale.accountId}
                            contactId={sale.contactId}
                            name={sale.contactName}
                          />
                        </>
                      ) : null}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-slate-700">{sale.productName}</td>
                  <td className="px-4 py-3 tabular-nums">{sale.quantity}</td>
                  <td className="px-4 py-3 tabular-nums font-semibold">
                    {formatMoney(sale.currency, sale.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill tone={saleStatusTone(sale)}>{sale.status}</StatusPill>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-slate-600">{sale.source}</td>
                </tr>
              ))}
              {filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    {sales.length === 0
                      ? "No sales recorded for this event yet."
                      : "No sales match this search."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </AdminDesktopTable>
        <AdminMobileList>
          {filteredSales.map((sale) => (
            <Link key={sale.id} href={sale.href} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold text-primary">{sale.reference}</p>
                <p className="mt-0.5 text-[10px] text-slate-600">{sale.clientName}</p>
                <p className="mt-0.5 text-[8px] text-slate-400">{sale.productName} · {sale.quantity}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold">{formatMoney(sale.currency, sale.amount)}</p>
                <div className="mt-1"><StatusPill tone={saleStatusTone(sale)}>{sale.status}</StatusPill></div>
              </div>
            </Link>
          ))}
          {filteredSales.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              {sales.length === 0 ? "No sales recorded for this event yet." : "No sales match this search."}
            </p>
          ) : null}
        </AdminMobileList>
      </AdminPanel>
    </div>
  )
}
