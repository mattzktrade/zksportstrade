"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckCircle2, Download, Package, Plus, Search, Sparkles, UsersRound } from "lucide-react"
import { toast } from "sonner"
import { ensureSupplier } from "@/app/(admin)/actions"
import { AdminPageHeader, AdminPanel, AdminStatCard, AdminStats, AdminDesktopTable, AdminMobileList, StatusPill } from "@/components/admin/admin-page-kit"
import { AdminListPreview } from "@/components/admin/admin-list-preview"
import { adminSupplierPath } from "@/lib/crm/profile-links"
import { cn } from "@/lib/utils"
import { usePersistedAdminFilters } from "@/lib/admin/use-persisted-admin-filters"
import { pageSearchProps } from "@/lib/browser/laptop-qol"
import { useAdminListSelection } from "@/lib/admin/use-admin-list-selection"

export type SupplierDirectoryRow = {
  id: string
  name: string
  code: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  notes: string | null
  active: boolean
  purchaseOrders: number
  packages: string[]
  spend: number
  currency: string
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

export function SuppliersClient({ rows }: { rows: SupplierDirectoryRow[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [listState, setListState] = usePersistedAdminFilters("zk-admin-suppliers-filters-v1", { search: "" })
  const { search } = listState
  const {
    isDesktop,
    selectedId,
    selectRow,
    closePreview,
    showPreview,
  } = useAdminListSelection({ firstId: rows[0]?.id ?? null })
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [contactName, setContactName] = useState("")
  const [contactEmail, setContactEmail] = useState("")

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return rows
    return rows.filter((row) =>
      [row.name, row.code, row.contactName, row.contactEmail, ...row.packages]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    )
  }, [rows, search])

  const selected = selectedId ? rows.find((row) => row.id === selectedId) ?? null : null
  const totalSpend = rows.reduce((sum, row) => sum + row.spend, 0)
  const top = [...rows].sort((a, b) => b.spend - a.spend)[0]

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
        title="Inventory / Suppliers"
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
              value={search}
              onChange={(event) => setListState((current) => ({ ...current, search: event.target.value }))}
              placeholder="Search supplier, event or location..."
              className="h-8 w-full rounded-md border border-[#e4e6ea] bg-white pl-9 pr-3 text-[10px] outline-none focus:border-primary/40"
            />
          </div>
          {["Sport", "Event", "Region", "Supplier type"].map((filter) => (
            <button key={filter} type="button" className="h-8 rounded-md border border-[#e4e6ea] px-3 text-[9px] text-[#62666e]">
              {filter}⌄
            </button>
          ))}
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

        <div className={cn(
          "grid md:min-h-[500px]",
          selected && "xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]",
        )}>
          <div className={cn("min-w-0", selected && "xl:border-r xl:border-[#eceef1]")}>
            <AdminDesktopTable>
            <table className="w-full min-w-[760px] text-left">
              <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-[#92969e]">
                <tr>
                  <th className="px-3 py-2 font-medium">Supplier</th>
                  <th className="px-3 py-2 font-medium">Stock / packages</th>
                  <th className="px-3 py-2 font-medium">Orders with us</th>
                  <th className="px-3 py-2 font-medium">Spend</th>
                  <th className="px-3 py-2 font-medium">Contact</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f1f3] text-[9px]">
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => selectRow(row.id)}
                    className={cn("cursor-pointer hover:bg-slate-50", selected?.id === row.id && "bg-red-50/60")}
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-[8px] font-semibold text-white">
                          {(row.code || row.name).slice(0, 3).toUpperCase()}
                        </div>
                        <div>
                          <Link
                            href={adminSupplierPath(row.id)}
                            onClick={(event) => event.stopPropagation()}
                            className="font-semibold text-[#373a40] hover:text-primary hover:underline"
                          >
                            {row.name}
                          </Link>
                          <p className="text-[8px] text-[#9a9ea5]">{row.code || "Supplier"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[240px] px-3 py-3 text-[#62666e]">{row.packages.slice(0, 3).join(", ") || "No stock linked"}</td>
                    <td className="px-3 py-3 font-medium">{row.purchaseOrders}</td>
                    <td className="px-3 py-3 font-medium">{money(row.spend, row.currency)}</td>
                    <td className="px-3 py-3 text-[#62666e]">{row.contactName || row.contactEmail || "—"}</td>
                    <td className="px-3 py-3"><StatusPill tone={row.active ? "green" : "gray"}>{row.active ? "Active" : "Inactive"}</StatusPill></td>
                    <td className="px-3 py-3"><Link href={adminSupplierPath(row.id)} onClick={(event) => event.stopPropagation()} className="rounded-md border px-2 py-1.5 text-[8px] hover:border-primary/30 hover:text-primary">View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </AdminDesktopTable>
            <AdminMobileList>
              {filtered.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  onClick={() => selectRow(row.id)}
                  className={cn(
                    "flex w-full items-start justify-between gap-3 px-4 py-3 text-left",
                    selected?.id === row.id && "bg-red-50/60",
                  )}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-primary">{row.name}</p>
                    <p className="mt-0.5 text-[10px] text-slate-600">{row.contactName || row.contactEmail || "No contact"}</p>
                    <p className="mt-0.5 text-[8px] text-slate-400">{row.purchaseOrders} orders</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold">{money(row.spend, row.currency)}</p>
                    <div className="mt-1"><StatusPill tone={row.active ? "green" : "gray"}>{row.active ? "Active" : "Inactive"}</StatusPill></div>
                  </div>
                </button>
              ))}
              {filtered.length === 0 ? (
                <p className="px-4 py-12 text-center text-[10px] text-slate-400">No suppliers match this view.</p>
              ) : null}
            </AdminMobileList>
          </div>

          {selected && showPreview ? (
            <AdminListPreview isDesktop={isDesktop} onClose={closePreview} className="p-4">
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-[13px] font-semibold text-[#2d3035]">{selected.name}</h2>
                      <StatusPill tone={selected.active ? "green" : "gray"}>{selected.active ? "Active" : "Inactive"}</StatusPill>
                    </div>
                    <p className="mt-1 text-[9px] text-[#8e9299]">{selected.code || "Structured supplier"}</p>
                  </div>
                  <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-xl text-slate-400 md:h-auto md:w-auto md:text-base" onClick={closePreview}>×</button>
                </div>

                <dl className="grid grid-cols-[95px_1fr] gap-y-2 border-y border-[#eceef1] py-3 text-[9px]">
                  <dt className="text-[#93979f]">Main contact</dt><dd className="font-medium">{selected.contactName || "Not set"}</dd>
                  <dt className="text-[#93979f]">Email</dt><dd className="font-medium">{selected.contactEmail || "Not set"}</dd>
                  <dt className="text-[#93979f]">Phone</dt><dd className="font-medium">{selected.contactPhone || "Not set"}</dd>
                  <dt className="text-[#93979f]">Orders with us</dt><dd className="font-medium">{selected.purchaseOrders}</dd>
                  <dt className="text-[#93979f]">Tracked spend</dt><dd className="font-medium text-emerald-600">{money(selected.spend, selected.currency)}</dd>
                </dl>

                <div>
                  <h3 className="text-[9px] font-semibold text-[#555961]">Products this supplier can provide</h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selected.packages.map((pkg) => (
                      <span key={pkg} className="rounded-md border border-[#e5e7eb] bg-[#fafbfc] px-2 py-1.5 text-[8px] text-[#656970]">{pkg}</span>
                    ))}
                    {selected.packages.length === 0 ? <p className="text-[9px] text-slate-400">No products linked yet.</p> : null}
                  </div>
                </div>

                {selected.notes ? (
                  <div className="rounded-md bg-[#fafbfc] p-3">
                    <p className="text-[8px] uppercase tracking-wide text-[#9a9ea5]">Internal notes</p>
                    <p className="mt-1 text-[9px] text-[#62666e]">{selected.notes}</p>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2 pt-2">
                  <Link href={adminSupplierPath(selected.id)} className="flex h-9 items-center justify-center rounded-md border border-[#e5e7eb] text-[9px] font-medium hover:border-primary/30 hover:text-primary">View supplier</Link>
                  <button type="button" className="h-9 rounded-md bg-primary text-[9px] font-semibold text-white">Create sourcing request</button>
                </div>
              </div>
            </AdminListPreview>
          ) : null}
        </div>

        <div className="flex justify-end border-t border-[#eceef1] p-3">
          <button type="button" onClick={() => setShowAdd(true)} className="flex h-8 items-center gap-1.5 rounded-md border border-[#e4e6ea] px-3 text-[9px] font-medium">
            <Plus className="h-3.5 w-3.5" /> Add supplier
          </button>
        </div>
      </AdminPanel>
    </div>
  )
}
