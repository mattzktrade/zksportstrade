"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckCircle2, Download, Package, Plus, Search, Sparkles, UsersRound } from "lucide-react"
import { toast } from "sonner"
import { ensureSupplier } from "@/app/(admin)/actions"
import { AdminPageHeader, AdminPanel, AdminStatCard, AdminStats, AdminDesktopTable, AdminMobileList, StatusPill } from "@/components/admin/admin-page-kit"
import { EventFilter, uniqueEventFilterOptions } from "@/components/admin/event-filter"
import { adminSupplierPath } from "@/lib/crm/profile-links"
import { EVENT_CATEGORIES, EVENT_CATEGORY_LABELS } from "@/lib/catalog/event-categories"
import {
  coverageForFilters,
  EMPTY_SUPPLIER_DIRECTORY_FILTERS,
  supplierDirectoryEventOptions,
  supplierMatchesDirectoryFilters,
  supplierTierLabel,
  supplierTierTone,
  type SupplierDirectoryFilters,
  type SupplierDirectoryRow,
} from "@/lib/admin/supplier-directory"
import { usePersistedAdminFilters } from "@/lib/admin/use-persisted-admin-filters"
import { pageSearchProps } from "@/lib/browser/laptop-qol"

export type { SupplierDirectoryRow }

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

const FILTER_SELECT_CLASS =
  "h-8 max-w-[170px] rounded-md border border-[#e4e6ea] bg-white px-2 text-[9px] text-[#62666e]"

export function SuppliersClient({ rows }: { rows: SupplierDirectoryRow[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [listState, setListState] = usePersistedAdminFilters("zk-admin-suppliers-filters-v3", {
    ...EMPTY_SUPPLIER_DIRECTORY_FILTERS,
  })
  const filters = listState
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [contactName, setContactName] = useState("")
  const [contactEmail, setContactEmail] = useState("")

  const eventOptions = useMemo(
    () => uniqueEventFilterOptions(supplierDirectoryEventOptions(rows)),
    [rows],
  )

  const filtered = useMemo(
    () => rows.filter((row) => supplierMatchesDirectoryFilters(row, filters)),
    [filters, rows],
  )

  const filtersActive =
    Boolean(filters.search.trim()) || Boolean(filters.sport) || filters.eventIds.length > 0

  const totalSpend = rows.reduce((sum, row) => sum + row.spend, 0)
  const top = [...rows].sort((a, b) => b.spend - a.spend)[0]

  function updateFilters(patch: Partial<SupplierDirectoryFilters>) {
    setListState((current) => ({ ...current, ...patch }))
  }

  function submit() {
    if (!name.trim()) {
      toast.error("Supplier name is required.")
      return
    }
    startTransition(async () => {
      const result = await ensureSupplier({
        name,
        code: code || null,
        contactName: contactName || null,
        contactEmail: contactEmail || null,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success("Supplier added.")
      setShowAdd(false)
      setName("")
      setCode("")
      setContactName("")
      setContactEmail("")
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <AdminPageHeader
        title="Suppliers"
        description="Supplier analysis, event coverage and sourcing options."
      />

      <AdminStats className="sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard icon={UsersRound} value={rows.filter((row) => row.active).length} label="Active suppliers" tone="blue" />
        <AdminStatCard icon={CheckCircle2} value={rows.filter((row) => row.purchaseOrders > 0).length} label="Used this month" tone="green" />
        <AdminStatCard icon={Sparkles} value={top?.name ?? "—"} label="Top supplier by order value" tone="purple" />
        <AdminStatCard icon={Package} value={money(totalSpend, "USD")} label="Tracked purchases" tone="amber" />
      </AdminStats>

      <AdminPanel>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#eceef1] p-3">
          <div className="relative min-w-0 w-full flex-1 sm:min-w-[250px] sm:max-w-[380px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              {...pageSearchProps}
              value={filters.search}
              onChange={(event) => updateFilters({ search: event.target.value })}
              placeholder="Search supplier, event or location..."
              className="h-8 w-full rounded-md border border-[#e4e6ea] bg-white pl-9 pr-3 text-[10px] outline-none focus:border-primary/40"
            />
          </div>
          <select
            aria-label="Sport"
            value={filters.sport}
            onChange={(event) => updateFilters({ sport: event.target.value })}
            className={FILTER_SELECT_CLASS}
          >
            <option value="">Sport</option>
            {EVENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {EVENT_CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
          <EventFilter
            options={eventOptions}
            selectedIds={filters.eventIds}
            onChange={(eventIds) => updateFilters({ eventIds })}
            className="sm:min-w-[180px] sm:max-w-[220px]"
            inputClassName="h-8 border-[#e4e6ea] text-[#62666e]"
          />
          {filtersActive ? (
            <button
              type="button"
              onClick={() => setListState({ ...EMPTY_SUPPLIER_DIRECTORY_FILTERS })}
              className="h-8 rounded-md px-2 text-[9px] text-primary hover:underline"
            >
              Clear
            </button>
          ) : null}
          <button type="button" className="ml-auto flex h-8 items-center gap-1.5 rounded-md border border-[#e4e6ea] px-3 text-[9px] text-[#62666e]">
            <Download className="h-3.5 w-3.5" /> Export list
          </button>
        </div>

        {showAdd ? (
          <div className="grid gap-2 border-b border-[#eceef1] bg-[#fafbfc] p-3 sm:grid-cols-4">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Supplier name" className="h-9 rounded-md border bg-white px-3 text-[10px]" />
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Supplier code" className="h-9 rounded-md border bg-white px-3 text-[10px]" />
            <input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Contact name" className="h-9 rounded-md border bg-white px-3 text-[10px]" />
            <input value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="Contact email" className="h-9 rounded-md border bg-white px-3 text-[10px]" />
            <div className="flex gap-2 sm:col-span-4 sm:justify-end">
              <button type="button" onClick={() => setShowAdd(false)} className="h-8 rounded-md border bg-white px-3 text-[9px]">Cancel</button>
              <button type="button" disabled={pending} onClick={submit} className="h-8 rounded-md bg-primary px-3 text-[9px] font-semibold text-white disabled:opacity-50">
                Save supplier
              </button>
            </div>
          </div>
        ) : null}

        <AdminDesktopTable>
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-[#92969e]">
              <tr>
                <th className="px-3 py-2 font-medium">Supplier</th>
                <th className="px-3 py-2 font-medium">Priority</th>
                <th className="px-3 py-2 font-medium">Best coverage</th>
                <th className="px-3 py-2 font-medium">Orders with us</th>
                <th className="px-3 py-2 font-medium">Spend</th>
                <th className="px-3 py-2 font-medium">Contact</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f1f3] text-[9px]">
              {filtered.map((row) => {
                const coverage = coverageForFilters(row.events, filters)
                return (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-[8px] font-semibold text-white">
                          {(row.code || row.name).slice(0, 3).toUpperCase()}
                        </div>
                        <div>
                          <Link
                            href={adminSupplierPath(row.id)}
                            className="font-semibold text-[#373a40] hover:text-primary hover:underline"
                          >
                            {row.name}
                          </Link>
                          <p className="text-[8px] text-[#9a9ea5]">
                            {row.accountKinds.length > 0 ? row.accountKindLabel : row.code || "Supplier"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill tone={supplierTierTone(row.tier)}>{supplierTierLabel(row.tier)}</StatusPill>
                    </td>
                    <td className="max-w-[260px] px-3 py-3">
                      <p className="font-semibold text-[#373a40]">{coverage.headline}</p>
                      {coverage.detail ? <p className="mt-0.5 text-[8px] text-[#9a9ea5]">{coverage.detail}</p> : null}
                    </td>
                    <td className="px-3 py-3 font-medium">{row.purchaseOrders}</td>
                    <td className="px-3 py-3 font-medium">{money(row.spend, row.currency)}</td>
                    <td className="px-3 py-3 text-[#62666e]">{row.contactName || row.contactEmail || "—"}</td>
                    <td className="px-3 py-3"><StatusPill tone={row.active ? "green" : "gray"}>{row.active ? "Active" : "Inactive"}</StatusPill></td>
                  </tr>
                )
              })}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-[10px] text-slate-400">
                    No suppliers match this view.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </AdminDesktopTable>
        <AdminMobileList>
          {filtered.map((row) => {
            const coverage = coverageForFilters(row.events, filters)
            return (
              <Link
                key={row.id}
                href={adminSupplierPath(row.id)}
                className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-primary">{row.name}</p>
                  <p className="mt-0.5 text-[10px] text-slate-600">{coverage.headline}</p>
                  <p className="mt-0.5 text-[8px] text-slate-400">{coverage.detail || `${row.purchaseOrders} orders`}</p>
                </div>
                <div className="shrink-0 text-right">
                  <StatusPill tone={supplierTierTone(row.tier)}>{supplierTierLabel(row.tier)}</StatusPill>
                  <p className="mt-1 font-semibold">{money(row.spend, row.currency)}</p>
                </div>
              </Link>
            )
          })}
          {filtered.length === 0 ? (
            <p className="px-4 py-12 text-center text-[10px] text-slate-400">No suppliers match this view.</p>
          ) : null}
        </AdminMobileList>

        <div className="flex justify-end border-t border-[#eceef1] p-3">
          <button type="button" onClick={() => setShowAdd(true)} className="flex h-8 items-center gap-1.5 rounded-md border border-[#e4e6ea] px-3 text-[9px] font-medium">
            <Plus className="h-3.5 w-3.5" /> Add supplier
          </button>
        </div>
      </AdminPanel>
    </div>
  )
}
