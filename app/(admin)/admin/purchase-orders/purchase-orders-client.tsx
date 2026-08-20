"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowUpDown } from "lucide-react"
import { toast } from "sonner"
import {
  createPurchaseOrder,
  deletePurchaseOrder,
  deletePurchaseOrderDocument,
  getPurchaseOrderDocumentDownloadUrl,
  updatePurchaseOrder,
  uploadPurchaseOrderDocument,
} from "@/app/(admin)/actions"
import { adminPackagePath } from "@/lib/admin/package-link"
import type { PurchaseOrderStockLine, PurchaseOrderWithMeta } from "@/lib/admin/purchase-orders"
import { adminSupplierPath } from "@/lib/crm/profile-links"
import { CompanySupplierSelect } from "@/components/admin/company-supplier-select"
import type { CrmCompanyOption } from "@/lib/crm/deals"

const STOCK_PREVIEW_LIMIT = 3

type SortKey = "poNumber" | "issuedAt"

type PoFilters = {
  search: string
  supplier: string
  event: string
  product: string
}

const EMPTY_FILTERS: PoFilters = {
  search: "",
  supplier: "",
  event: "",
  product: "",
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  )
}

function comparePoNumber(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
}

function resolveInitialExpandedId(
  orders: PurchaseOrderWithMeta[],
  initialPo: string | null,
): string | null {
  const key = initialPo?.trim()
  if (!key) return null
  const match = orders.find((o) => o.id === key || o.po_number === key)
  return match?.id ?? null
}

export function PurchaseOrdersClient({
  orders,
  companies,
  initialPo = null,
}: {
  orders: PurchaseOrderWithMeta[]
  companies: CrmCompanyOption[]
  initialPo?: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [showCreate, setShowCreate] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(() =>
    resolveInitialExpandedId(orders, initialPo),
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filters, setFilters] = useState<PoFilters>(EMPTY_FILTERS)
  const [sortKey, setSortKey] = useState<SortKey>("issuedAt")
  const [sortDescending, setSortDescending] = useState(true)

  // Create form state
  const [newPoNumber, setNewPoNumber] = useState("")
  const [newSupplierAccountId, setNewSupplierAccountId] = useState("")
  const [newIssuedAt, setNewIssuedAt] = useState("")
  const [newNote, setNewNote] = useState("")
  const [newFiles, setNewFiles] = useState<File[]>([])
  const createFileInputRef = useRef<HTMLInputElement>(null)

  // Edit form state (mirrored per-row)
  const [editPoNumber, setEditPoNumber] = useState("")
  const [editSupplierAccountId, setEditSupplierAccountId] = useState("")
  const [editIssuedAt, setEditIssuedAt] = useState("")
  const [editNote, setEditNote] = useState("")
  const scrolledToPo = useRef(false)

  useEffect(() => {
    const next = resolveInitialExpandedId(orders, initialPo)
    if (next) setExpandedId(next)
  }, [initialPo, orders])

  useEffect(() => {
    if (!expandedId || !initialPo || scrolledToPo.current) return
    const el = document.getElementById(`po-${expandedId}`)
    if (!el) return
    scrolledToPo.current = true
    el.scrollIntoView({ block: "center" })
  }, [expandedId, initialPo])

  const supplierOptions = useMemo(() => uniqueSorted(orders.map((o) => o.supplier)), [orders])
  const eventOptions = useMemo(
    () => uniqueSorted(orders.flatMap((o) => o.usage.lines.map((line) => line.eventName))),
    [orders],
  )
  const productOptions = useMemo(
    () => uniqueSorted(orders.flatMap((o) => o.usage.lines.map((line) => line.packageName))),
    [orders],
  )
  const filtersActive =
    Boolean(filters.search.trim()) || Boolean(filters.supplier) || Boolean(filters.event) || Boolean(filters.product)

  const filteredOrders = useMemo(() => {
    const q = filters.search.trim().toLowerCase()
    const matched = orders.filter((o) => {
      if (filters.supplier && o.supplier !== filters.supplier) return false
      if (filters.event && !o.usage.lines.some((line) => line.eventName === filters.event)) return false
      if (filters.product && !o.usage.lines.some((line) => line.packageName === filters.product)) return false
      if (!q) return true
      const hay = [
        o.po_number,
        o.supplier,
        o.note ?? "",
        ...o.usage.lines.map((line) => line.packageName),
        ...o.usage.lines.map((line) => line.eventName),
      ]
        .join(" ")
        .toLowerCase()
      return hay.includes(q)
    })
    const dir = sortDescending ? -1 : 1
    return [...matched].sort((a, b) => {
      if (sortKey === "poNumber") return dir * comparePoNumber(a.po_number, b.po_number)
      const aDate = a.issued_at ?? ""
      const bDate = b.issued_at ?? ""
      if (!aDate && !bDate) return dir * comparePoNumber(a.po_number, b.po_number)
      if (!aDate) return 1
      if (!bDate) return -1
      return dir * aDate.localeCompare(bDate)
    })
  }, [filters, orders, sortDescending, sortKey])

  function toggleSort(next: SortKey) {
    if (sortKey === next) {
      setSortDescending((value) => !value)
      return
    }
    setSortKey(next)
    setSortDescending(next === "issuedAt")
  }

  function resetCreate() {
    setNewPoNumber("")
    setNewSupplierAccountId("")
    setNewIssuedAt("")
    setNewNote("")
    setNewFiles([])
    if (createFileInputRef.current) createFileInputRef.current.value = ""
  }

  function submitCreate() {
    if (!newPoNumber.trim()) {
      toast.error("PO number is required.")
      return
    }
    if (!newSupplierAccountId) {
      toast.error("Select a company as the supplier.")
      return
    }
    start(async () => {
      const res = await createPurchaseOrder({
        poNumber: newPoNumber.trim(),
        supplierAccountId: newSupplierAccountId,
        issuedAt: newIssuedAt.trim() || null,
        note: newNote.trim() || null,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      const files = [...newFiles]
      let uploadFailed = 0
      for (const file of files) {
        const fd = new FormData()
        fd.set("purchaseOrderId", res.id)
        fd.set("file", file)
        const uploaded = await uploadPurchaseOrderDocument(fd)
        if (!uploaded.ok) uploadFailed += 1
      }
      if (uploadFailed > 0) {
        toast.success("Purchase order created, but some attachments failed to upload.")
      } else {
        toast.success(files.length > 0 ? "Purchase order created with attachments." : "Purchase order created.")
      }
      resetCreate()
      setShowCreate(false)
      router.refresh()
    })
  }

  function startEdit(po: PurchaseOrderWithMeta) {
    setEditingId(po.id)
    setEditPoNumber(po.po_number)
    setEditSupplierAccountId(po.supplier_account_id ?? "")
    setEditIssuedAt(po.issued_at ?? "")
    setEditNote(po.note ?? "")
    setExpandedId(po.id)
  }

  function submitEdit(po: PurchaseOrderWithMeta) {
    if (!editSupplierAccountId) {
      toast.error("Select a company as the supplier.")
      return
    }
    const clearIssuedAt = !editIssuedAt.trim()
    start(async () => {
      const res = await updatePurchaseOrder({
        id: po.id,
        poNumber: editPoNumber.trim(),
        supplierAccountId: editSupplierAccountId,
        issuedAt: editIssuedAt.trim() || null,
        clearIssuedAt,
        note: editNote,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Purchase order updated.")
      setEditingId(null)
      router.refresh()
    })
  }

  function confirmDelete(po: PurchaseOrderWithMeta) {
    if (po.usage.layer_count > 0) {
      toast.error(
        `Cannot delete: this PO is linked to ${po.usage.layer_count} cost layer${po.usage.layer_count === 1 ? "" : "s"}. Unlink them first.`,
      )
      return
    }
    if (!window.confirm(`Delete PO "${po.po_number}"? Attachments will be removed as well.`)) return
    start(async () => {
      const res = await deletePurchaseOrder(po.id)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Purchase order deleted.")
      router.refresh()
    })
  }

  async function openDocument(documentId: string) {
    const res = await getPurchaseOrderDocumentDownloadUrl(documentId)
    if (!res.ok) {
      toast.error(res.message)
      return
    }
    window.open(res.url, "_blank", "noopener,noreferrer")
  }

  function removeDocument(documentId: string) {
    if (!window.confirm("Remove this attachment?")) return
    start(async () => {
      const res = await deletePurchaseOrderDocument(documentId)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Attachment removed.")
      router.refresh()
    })
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#eceef1] bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#eceef1] p-3">
        <input
          type="search"
          placeholder="Search PO number, supplier, product, event…"
          value={filters.search}
          onChange={(e) => setFilters((current) => ({ ...current, search: e.target.value }))}
          className="h-8 flex-1 min-w-[240px] max-w-md px-3 rounded-md border border-[#e4e6ea] bg-white text-[10px] outline-none focus:border-primary/40"
        />
        <select
          value={filters.supplier}
          onChange={(e) => setFilters((current) => ({ ...current, supplier: e.target.value }))}
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
          value={filters.event}
          onChange={(e) => setFilters((current) => ({ ...current, event: e.target.value }))}
          className="h-8 max-w-[190px] rounded-md border border-[#e4e6ea] bg-white px-2 text-[9px] text-[#62666e]"
        >
          <option value="">All events</option>
          {eventOptions.map((event) => (
            <option key={event} value={event}>
              {event}
            </option>
          ))}
        </select>
        <select
          value={filters.product}
          onChange={(e) => setFilters((current) => ({ ...current, product: e.target.value }))}
          className="h-8 max-w-[190px] rounded-md border border-[#e4e6ea] bg-white px-2 text-[9px] text-[#62666e]"
        >
          <option value="">All products</option>
          {productOptions.map((product) => (
            <option key={product} value={product}>
              {product}
            </option>
          ))}
        </select>
        <select
          value={sortKey}
          onChange={(e) => {
            const next = e.target.value as SortKey
            setSortKey(next)
            setSortDescending(next === "issuedAt")
          }}
          className="h-8 rounded-md border border-[#e4e6ea] bg-white px-2 text-[9px] text-[#62666e]"
        >
          <option value="issuedAt">Sort: Issue date</option>
          <option value="poNumber">Sort: PO #</option>
        </select>
        <button
          type="button"
          onClick={() => setSortDescending((value) => !value)}
          title={sortDescending ? "Descending" : "Ascending"}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-[#e4e6ea] text-[#62666e]"
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
        </button>
        {filtersActive ? (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="h-8 rounded-md border border-[#e4e6ea] px-3 text-[9px] text-[#62666e]"
          >
            Clear filters
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="ml-auto h-8 px-3 rounded-md bg-primary text-white text-[9px] font-semibold"
        >
          {showCreate ? "Cancel" : "New purchase order"}
        </button>
      </div>

      {showCreate ? (
        <div className="border-b border-[#eceef1] bg-[#fafbfc] p-4 space-y-3">
          <p className="text-sm font-semibold text-foreground">New purchase order</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-muted-foreground">
              PO number
              <input
                value={newPoNumber}
                onChange={(e) => setNewPoNumber(e.target.value)}
                placeholder="e.g. F1D-2026-042"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Supplier
              <div className="mt-1">
                <CompanySupplierSelect
                  companies={companies}
                  value={newSupplierAccountId}
                  onChange={setNewSupplierAccountId}
                  disabled={pending}
                />
              </div>
            </label>
            <label className="block text-xs text-muted-foreground">
              Issued date (optional)
              <input
                type="date"
                value={newIssuedAt}
                onChange={(e) => setNewIssuedAt(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </label>
            <label className="block text-xs text-muted-foreground sm:col-span-2">
              Note (optional)
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="mt-1 w-full min-h-[60px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
                placeholder="Payment terms, contact, anything you need to remember."
              />
            </label>
            <div className="sm:col-span-2 space-y-2">
              <p className="text-xs text-muted-foreground">Attachments (optional)</p>
              {newFiles.length > 0 ? (
                <ul className="space-y-1">
                  {newFiles.map((file, index) => (
                    <li
                      key={`${file.name}-${file.size}-${index}`}
                      className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1 text-xs"
                    >
                      <span className="truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setNewFiles((files) => files.filter((_, i) => i !== index))}
                        className="text-[10px] font-medium text-destructive hover:underline"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs italic text-muted-foreground">No invoice or signed contract attached yet.</p>
              )}
              <input
                ref={createFileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  setNewFiles((files) => [...files, file])
                  event.target.value = ""
                }}
                className="text-xs"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={pending}
              onClick={() => submitCreate()}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              Create purchase order
            </button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-[9px]">
          <thead className="bg-[#fafbfc] text-left text-[8px] uppercase tracking-wide text-[#92969e]">
            <tr>
              <th className="px-3 py-2 font-medium">
                <button
                  type="button"
                  onClick={() => toggleSort("poNumber")}
                  className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-[#62666e]"
                >
                  PO #
                  {sortKey === "poNumber" ? <span>{sortDescending ? "↓" : "↑"}</span> : null}
                </button>
              </th>
              <th className="px-3 py-2 font-medium">Supplier</th>
              <th className="px-3 py-2 font-medium">
                <button
                  type="button"
                  onClick={() => toggleSort("issuedAt")}
                  className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-[#62666e]"
                >
                  Issued
                  {sortKey === "issuedAt" ? <span>{sortDescending ? "↓" : "↑"}</span> : null}
                </button>
              </th>
              <th className="px-3 py-2 font-medium min-w-[10rem]">Product</th>
              <th className="px-3 py-2 font-medium min-w-[9rem]">Event</th>
              <th className="px-3 py-2 font-medium text-right">Qty bought</th>
              <th className="px-3 py-2 font-medium text-right">Remaining</th>
              <th className="px-3 py-2 font-medium min-w-[8rem]" />
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {orders.length === 0
                    ? "No purchase orders yet. Create one to start attaching contracts."
                    : "No matching purchase orders."}
                </td>
              </tr>
            ) : (
              filteredOrders.map((po) => (
                <PurchaseOrderRow
                  key={po.id}
                  po={po}
                  expanded={expandedId === po.id}
                  onToggle={() => setExpandedId((cur) => (cur === po.id ? null : po.id))}
                  editing={editingId === po.id}
                  editState={{
                    poNumber: editPoNumber,
                    supplierAccountId: editSupplierAccountId,
                    issuedAt: editIssuedAt,
                    note: editNote,
                    setPoNumber: setEditPoNumber,
                    setSupplierAccountId: setEditSupplierAccountId,
                    setIssuedAt: setEditIssuedAt,
                    setNote: setEditNote,
                  }}
                  companies={companies}
                  pending={pending}
                  onEdit={() => startEdit(po)}
                  onEditCancel={() => setEditingId(null)}
                  onEditSubmit={() => submitEdit(po)}
                  onDelete={() => confirmDelete(po)}
                  onOpenDocument={openDocument}
                  onRemoveDocument={removeDocument}
                  onRefresh={() => router.refresh()}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type EditState = {
  poNumber: string
  supplierAccountId: string
  issuedAt: string
  note: string
  setPoNumber: (v: string) => void
  setSupplierAccountId: (v: string) => void
  setIssuedAt: (v: string) => void
  setNote: (v: string) => void
}

function PurchaseOrderStockCells({
  lines,
  preview = false,
}: {
  lines: PurchaseOrderStockLine[]
  preview?: boolean
}) {
  if (lines.length === 0) {
    return (
      <>
        <td className="px-3 py-2 italic text-muted-foreground">Not linked</td>
        <td className="px-3 py-2 text-muted-foreground">—</td>
      </>
    )
  }

  const visible =
    preview && lines.length > STOCK_PREVIEW_LIMIT ? lines.slice(0, STOCK_PREVIEW_LIMIT) : lines
  const extra = lines.length - visible.length
  const showQty = lines.length > 1
  const singleEvent = new Set(lines.map((line) => line.eventName)).size === 1

  return (
    <>
      <td className="px-3 py-2">
        <ul className="space-y-0.5">
          {visible.map((line) => (
            <li key={line.packageId} className="leading-snug">
              <Link
                href={adminPackagePath(line.packageId)}
                onClick={(event) => event.stopPropagation()}
                className="text-primary hover:underline"
              >
                {line.packageName}
              </Link>
              {showQty ? <span className="text-muted-foreground"> · {line.quantityPurchased}</span> : null}
            </li>
          ))}
          {extra > 0 ? (
            <li className="text-[8px] uppercase tracking-wide text-muted-foreground">+{extra} more</li>
          ) : null}
        </ul>
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {singleEvent ? (
          lines[0]?.eventName ?? "—"
        ) : (
          <ul className="space-y-0.5">
            {visible.map((line) => (
              <li key={line.packageId} className="leading-snug">
                {line.eventName}
              </li>
            ))}
            {extra > 0 ? (
              <li className="text-[8px] uppercase tracking-wide">+{extra} more</li>
            ) : null}
          </ul>
        )}
      </td>
    </>
  )
}

function PurchaseOrderRow({
  po,
  expanded,
  onToggle,
  editing,
  editState,
  companies,
  pending,
  onEdit,
  onEditCancel,
  onEditSubmit,
  onDelete,
  onOpenDocument,
  onRemoveDocument,
  onRefresh,
}: {
  po: PurchaseOrderWithMeta
  expanded: boolean
  onToggle: () => void
  editing: boolean
  editState: EditState
  companies: CrmCompanyOption[]
  pending: boolean
  onEdit: () => void
  onEditCancel: () => void
  onEditSubmit: () => void
  onDelete: () => void
  onOpenDocument: (documentId: string) => void
  onRemoveDocument: (documentId: string) => void
  onRefresh: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)

  async function handleFileChosen(file: File) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.set("purchaseOrderId", po.id)
      fd.set("file", file)
      const res = await uploadPurchaseOrderDocument(fd)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Attachment uploaded.")
      onRefresh()
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  return (
    <>
      <tr id={`po-${po.id}`} className="border-t border-border align-top">
        <td className="px-3 py-2 font-medium">
          <button
            type="button"
            onClick={onToggle}
            className="text-left hover:text-primary"
            title="Show attachments and layer usage"
          >
            {po.po_number}
          </button>
        </td>
        <td className="px-3 py-2 text-muted-foreground">
          {po.supplier_id ? (
            <Link href={adminSupplierPath(po.supplier_id)} className="hover:text-primary hover:underline">
              {po.supplier}
            </Link>
          ) : po.supplier}
        </td>
        <td className="px-3 py-2 text-muted-foreground">{formatDate(po.issued_at)}</td>
        <PurchaseOrderStockCells lines={po.usage.lines} preview />
        <td className="px-3 py-2 text-right tabular-nums">{po.usage.quantity_purchased}</td>
        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
          {po.usage.quantity_remaining}
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          <button
            type="button"
            onClick={onEdit}
            disabled={pending || editing}
            className="text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            className="ml-3 text-[11px] font-medium text-destructive hover:underline disabled:opacity-50"
          >
            Delete
          </button>
        </td>
      </tr>
      {(expanded || editing) && (
        <tr className="border-t border-border bg-muted/20">
          <td colSpan={8} className="px-4 py-3">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Details
                </p>
                {editing ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block text-xs text-muted-foreground">
                      PO number
                      <input
                        value={editState.poNumber}
                        onChange={(e) => editState.setPoNumber(e.target.value)}
                        className="mt-1 w-full px-2 py-1 rounded border border-border bg-background text-sm"
                      />
                    </label>
                    <label className="block text-xs text-muted-foreground">
                      Supplier
                      <div className="mt-1">
                        <CompanySupplierSelect
                          companies={companies}
                          value={editState.supplierAccountId}
                          onChange={editState.setSupplierAccountId}
                          disabled={pending}
                          typedName={po.supplier_account_id ? null : po.supplier}
                          className="px-2 py-1 rounded text-sm"
                        />
                      </div>
                    </label>
                    <label className="block text-xs text-muted-foreground">
                      Issued date
                      <input
                        type="date"
                        value={editState.issuedAt}
                        onChange={(e) => editState.setIssuedAt(e.target.value)}
                        className="mt-1 w-full px-2 py-1 rounded border border-border bg-background text-sm"
                      />
                    </label>
                    <label className="block text-xs text-muted-foreground sm:col-span-2">
                      Note
                      <textarea
                        value={editState.note}
                        onChange={(e) => editState.setNote(e.target.value)}
                        className="mt-1 w-full min-h-[60px] px-2 py-1 rounded border border-border bg-background text-sm"
                      />
                    </label>
                    <div className="sm:col-span-2 flex gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={onEditSubmit}
                        className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={onEditCancel}
                        className="px-3 py-1.5 rounded border border-border text-xs font-medium hover:bg-muted disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>
                      <span className="font-medium text-foreground">Note:</span>{" "}
                      {po.note ? po.note : <span className="italic">no note</span>}
                    </p>
                    <p>
                      <span className="font-medium text-foreground">Stock:</span>{" "}
                      {po.usage.lines.length === 0 ? (
                        <span className="italic">not linked to any product yet</span>
                      ) : (
                        `${po.usage.lines.length} product${po.usage.lines.length === 1 ? "" : "s"}`
                      )}
                    </p>
                    {po.usage.lines.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {po.usage.lines.map((line) => (
                          <li key={line.packageId}>
                            <Link
                              href={adminPackagePath(line.packageId)}
                              className="font-medium text-primary hover:underline"
                            >
                              {line.packageName}
                            </Link>
                            <span>
                              {" "}
                              · {line.eventName} · {line.quantityPurchased} bought
                              {line.quantityRemaining !== line.quantityPurchased
                                ? `, ${line.quantityRemaining} remaining`
                                : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Attachments
                </p>
                {po.documents.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    No signed contract or invoice attached yet.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {po.documents.map((doc) => (
                      <li
                        key={doc.id}
                        className="flex items-center justify-between gap-2 text-xs border border-border rounded px-2 py-1 bg-background"
                      >
                        <button
                          type="button"
                          onClick={() => onOpenDocument(doc.id)}
                          className="text-primary hover:underline text-left flex-1 truncate"
                          title={doc.file_name}
                        >
                          {doc.file_name}
                        </button>
                        <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                          {formatBytes(doc.file_size)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onRemoveDocument(doc.id)}
                          className="text-[10px] font-medium text-destructive hover:underline"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void handleFileChosen(f)
                    }}
                    className="text-xs"
                  />
                  {uploading ? (
                    <span className="text-[11px] text-muted-foreground">Uploading…</span>
                  ) : null}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
