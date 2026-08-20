"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowUpDown, Upload } from "lucide-react"
import { toast } from "sonner"
import {
  createPurchaseOrder,
  deletePurchaseOrder,
  deletePurchaseOrderDocument,
  getPurchaseOrderDocumentDownloadUrl,
  updatePurchaseOrder,
  uploadPurchaseOrderDocument,
} from "@/app/(admin)/actions"
import { PurchaseBulkUploadModal } from "@/app/(admin)/admin/purchase-orders/bulk-upload-modal"
import { adminPackagePath } from "@/lib/admin/package-link"
import type { PurchaseOrderProductOption, PurchaseOrderStockLine, PurchaseOrderWithMeta } from "@/lib/admin/purchase-orders"
import { PurchaseOrderStockEditor, PurchaseOrderDraftLines, emptyDraftPurchaseLine } from "@/app/(admin)/admin/purchase-orders/purchase-order-stock-editor"
import { adminSupplierPath } from "@/lib/crm/profile-links"
import { CompanySupplierSelect } from "@/components/admin/company-supplier-select"
import { AdminDesktopTable, AdminMobileList } from "@/components/admin/admin-page-kit"
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
  products,
  initialPo = null,
}: {
  orders: PurchaseOrderWithMeta[]
  companies: CrmCompanyOption[]
  products: PurchaseOrderProductOption[]
  initialPo?: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [showCreate, setShowCreate] = useState(false)
  const [showBulkUpload, setShowBulkUpload] = useState(false)
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
  const [newSupplierReference, setNewSupplierReference] = useState("")
  const [newIssuedAt, setNewIssuedAt] = useState("")
  const [newNote, setNewNote] = useState("")
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [newLines, setNewLines] = useState(() => [emptyDraftPurchaseLine()])
  const createFileInputRef = useRef<HTMLInputElement>(null)

  // Edit form state (mirrored per-row)
  const [editPoNumber, setEditPoNumber] = useState("")
  const [editSupplierAccountId, setEditSupplierAccountId] = useState("")
  const [editSupplierReference, setEditSupplierReference] = useState("")
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
      const previewLines = matchingStockLines(o.usage.lines, filters)
      if ((filters.event || filters.product) && previewLines.length === 0) return false
      if (!q) return true
      const hay = [
        o.po_number,
        o.supplier_reference ?? "",
        o.supplier,
        o.note ?? "",
        ...previewLines.map((line) => line.packageName),
        ...previewLines.map((line) => line.eventName),
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
    setNewSupplierReference("")
    setNewIssuedAt("")
    setNewNote("")
    setNewFiles([])
    setNewLines([emptyDraftPurchaseLine()])
    if (createFileInputRef.current) createFileInputRef.current.value = ""
  }

  function submitCreate() {
    if (!newSupplierAccountId) {
      toast.error("Select a company as the supplier.")
      return
    }
    const lines = newLines
      .filter((line) => line.packageId && line.quantity.trim() !== "" && line.unitCost.trim() !== "")
      .map((line) => ({
        packageId: line.packageId,
        quantity: Math.floor(Number(line.quantity)),
        unitCost: Number(line.unitCost),
      }))
    if (lines.length === 0) {
      toast.error("Add at least one product with quantity and buy price.")
      return
    }
    if (lines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0)) {
      toast.error("Each product needs a positive whole-number quantity.")
      return
    }
    if (lines.some((line) => !Number.isFinite(line.unitCost) || line.unitCost < 0)) {
      toast.error("Each product needs a non-negative buy price.")
      return
    }
    start(async () => {
      const res = await createPurchaseOrder({
        poNumber: newPoNumber.trim() || null,
        supplierAccountId: newSupplierAccountId,
        supplierReference: newSupplierReference.trim() || null,
        issuedAt: newIssuedAt.trim() || null,
        note: newNote.trim() || null,
        lines,
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
    setEditSupplierReference(po.supplier_reference ?? "")
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
        supplierReference: editSupplierReference.trim() || null,
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
    const sold = po.usage.quantity_purchased - po.usage.quantity_remaining
    if (sold > 0) {
      toast.error(
        `Cannot delete this purchase order because ${sold} unit${sold === 1 ? "" : "s"} from it ${sold === 1 ? "has" : "have"} already been sold.`,
      )
      return
    }
    const units = po.usage.quantity_purchased
    const stockNote =
      units > 0
        ? ` This will also remove its stock (${units} unit${units === 1 ? "" : "s"}).`
        : ""
    if (!window.confirm(`Delete PO "${po.po_number}"?${stockNote} Attachments will be removed as well.`)) return
    start(async () => {
      const res = await deletePurchaseOrder(po.id)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(units > 0 ? "Purchase order and stock removed." : "Purchase order deleted.")
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
          placeholder="Search internal PO, contract/invoice, supplier, product…"
          value={filters.search}
          onChange={(e) => setFilters((current) => ({ ...current, search: e.target.value }))}
          className="h-8 w-full min-w-0 flex-1 sm:min-w-[240px] max-w-md px-3 rounded-md border border-[#e4e6ea] bg-white text-[10px] outline-none focus:border-primary/40"
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
          <option value="poNumber">Sort: Internal PO #</option>
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
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowBulkUpload(true)}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[#e4e6ea] px-3 text-[9px] font-semibold text-[#62666e]"
          >
            <Upload className="h-3.5 w-3.5" /> Bulk upload
          </button>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="h-8 px-3 rounded-md bg-primary text-white text-[9px] font-semibold"
          >
            {showCreate ? "Cancel" : "New purchase order"}
          </button>
        </div>
      </div>

      {showCreate ? (
        <div className="space-y-4 border-b border-[#eceef1] bg-[#fafbfc] p-4">
          <div>
            <p className="text-sm font-semibold text-foreground">New purchase order</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Internal PO # is ours. Put the supplier contract or invoice number in its own field, then add the products you are buying.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="block text-xs text-muted-foreground">
              Internal PO #
              <input
                value={newPoNumber}
                onChange={(e) => setNewPoNumber(e.target.value)}
                placeholder="Leave blank to auto-assign"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
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
              Contract / invoice
              <input
                value={newSupplierReference}
                onChange={(e) => setNewSupplierReference(e.target.value)}
                placeholder="Supplier invoice or contract no."
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Issued date
              <input
                type="date"
                value={newIssuedAt}
                onChange={(e) => setNewIssuedAt(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs text-muted-foreground sm:col-span-2 xl:col-span-4">
              Note
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="mt-1 min-h-[60px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder="Payment terms, contact, anything you need to remember."
              />
            </label>
          </div>
          <PurchaseOrderDraftLines products={products} lines={newLines} onChange={setNewLines} />
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Attachments</p>
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
              <p className="text-xs italic text-muted-foreground">Attach the signed contract or supplier invoice if you have it.</p>
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
          <div className="flex justify-end">
            <button
              type="button"
              disabled={pending}
              onClick={() => submitCreate()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Create purchase order
            </button>
          </div>
        </div>
      ) : null}

      <AdminDesktopTable>
        <table className="w-full min-w-[1100px] text-[9px]">
          <thead className="bg-[#fafbfc] text-left text-[8px] uppercase tracking-wide text-[#92969e]">
            <tr>
              <th className="px-3 py-2 font-medium">
                <button
                  type="button"
                  onClick={() => toggleSort("poNumber")}
                  className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-[#62666e]"
                >
                  Internal PO #
                  {sortKey === "poNumber" ? <span>{sortDescending ? "↓" : "↑"}</span> : null}
                </button>
              </th>
              <th className="px-3 py-2 font-medium">Supplier</th>
              <th className="px-3 py-2 font-medium min-w-[8rem]">Contract / invoice</th>
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
                <td colSpan={9} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {orders.length === 0
                    ? "No purchase orders yet. Create one with the products you are buying."
                    : "No matching purchase orders."}
                </td>
              </tr>
            ) : (
              filteredOrders.map((po) => (
                <PurchaseOrderRow
                  key={po.id}
                  po={po}
                  previewLines={matchingStockLines(po.usage.lines, filters)}
                  expanded={expandedId === po.id}
                  onToggle={() => setExpandedId((cur) => (cur === po.id ? null : po.id))}
                  editing={editingId === po.id}
                  editState={{
                    poNumber: editPoNumber,
                    supplierAccountId: editSupplierAccountId,
                    supplierReference: editSupplierReference,
                    issuedAt: editIssuedAt,
                    note: editNote,
                    setPoNumber: setEditPoNumber,
                    setSupplierAccountId: setEditSupplierAccountId,
                    setSupplierReference: setEditSupplierReference,
                    setIssuedAt: setEditIssuedAt,
                    setNote: setEditNote,
                  }}
                  companies={companies}
                  products={products}
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
      </AdminDesktopTable>
      <AdminMobileList>
        {filteredOrders.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {orders.length === 0
              ? "No purchase orders yet. Create one with the products you are buying."
              : "No matching purchase orders."}
          </p>
        ) : (
          filteredOrders.map((po) => {
            const previewLines = matchingStockLines(po.usage.lines, filters)
            const groupedPreview = groupedStockLines(previewLines)
            return (
            <div key={`mobile-${po.id}`} className="space-y-2 px-4 py-3">
              <button type="button" onClick={() => setExpandedId((cur) => (cur === po.id ? null : po.id))} className="flex w-full items-start justify-between gap-3 text-left">
                <div className="min-w-0">
                  <p className="font-semibold text-primary">{po.po_number}</p>
                  <p className="mt-0.5 text-[10px] text-slate-600">{po.supplier}</p>
                  <p className="mt-0.5 text-[8px] text-slate-400">
                    {po.supplier_reference ? `${po.supplier_reference} · ` : ""}
                    {formatDate(po.issued_at)}
                  </p>
                </div>
                <p className="shrink-0 text-[10px] font-semibold">{stockQuantityTotals(previewLines).remaining} remaining</p>
              </button>
              <p className="text-[10px] text-slate-600">
                {groupedPreview.slice(0, 2).map((line) => line.packageName).join(", ") || "Not linked"}
                {groupedPreview.length > 2 ? ` +${groupedPreview.length - 2} more` : ""}
              </p>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => startEdit(po)} disabled={pending} className="text-[11px] font-medium text-primary disabled:opacity-50">Edit</button>
                <button type="button" onClick={() => confirmDelete(po)} disabled={pending} className="text-[11px] font-medium text-destructive disabled:opacity-50">Delete</button>
              </div>
              {expandedId === po.id || editingId === po.id ? (
                <div className="space-y-3 rounded-md border border-[#eceef1] bg-[#fafbfc] p-3 text-[10px] text-slate-600">
                  <p>
                    <span className="font-medium text-slate-800">Contract / invoice:</span>{" "}
                    {po.supplier_reference || "—"}
                  </p>
                  <p><span className="font-medium text-slate-800">Note:</span> {po.note || "No note"}</p>
                  <PurchaseOrderStockEditor
                    purchaseOrderId={po.id}
                    lines={po.usage.lines}
                    products={products}
                    onChanged={() => router.refresh()}
                  />
                </div>
              ) : null}
            </div>
            )
          })
        )}
      </AdminMobileList>
      {showBulkUpload ? (
        <PurchaseBulkUploadModal
          onClose={() => setShowBulkUpload(false)}
          onImported={() => {
            setShowBulkUpload(false)
            router.refresh()
          }}
        />
      ) : null}
    </div>
  )
}

type EditState = {
  poNumber: string
  supplierAccountId: string
  supplierReference: string
  issuedAt: string
  note: string
  setPoNumber: (v: string) => void
  setSupplierAccountId: (v: string) => void
  setSupplierReference: (v: string) => void
  setIssuedAt: (v: string) => void
  setNote: (v: string) => void
}

function matchingStockLines(
  lines: PurchaseOrderStockLine[],
  filters: Pick<PoFilters, "event" | "product">,
): PurchaseOrderStockLine[] {
  if (!filters.event && !filters.product) return lines
  return lines.filter((line) => {
    if (filters.event && line.eventName !== filters.event) return false
    if (filters.product && line.packageName !== filters.product) return false
    return true
  })
}

function stockQuantityTotals(lines: PurchaseOrderStockLine[]): { purchased: number; remaining: number } {
  let purchased = 0
  let remaining = 0
  for (const line of lines) {
    purchased += line.quantityPurchased
    remaining += line.quantityRemaining
  }
  return { purchased, remaining }
}

function groupedStockLines(lines: PurchaseOrderStockLine[]): PurchaseOrderStockLine[] {
  const byPackage = new Map<string, PurchaseOrderStockLine>()
  for (const line of lines) {
    const existing = byPackage.get(line.packageId)
    if (!existing) {
      byPackage.set(line.packageId, { ...line })
      continue
    }
    existing.quantityPurchased += line.quantityPurchased
    existing.quantityRemaining += line.quantityRemaining
  }
  return [...byPackage.values()]
}

function PurchaseOrderStockCells({
  lines,
  preview = false,
}: {
  lines: PurchaseOrderStockLine[]
  preview?: boolean
}) {
  const display = preview ? groupedStockLines(lines) : lines
  if (display.length === 0) {
    return (
      <>
        <td className="px-3 py-2 italic text-muted-foreground">Not linked</td>
        <td className="px-3 py-2 text-muted-foreground">—</td>
      </>
    )
  }

  const visible =
    preview && display.length > STOCK_PREVIEW_LIMIT ? display.slice(0, STOCK_PREVIEW_LIMIT) : display
  const extra = display.length - visible.length
  const showQty = display.length > 1
  const singleEvent = new Set(display.map((line) => line.eventName)).size === 1

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
          display[0]?.eventName ?? "—"
        ) : (
          <ul className="space-y-0.5">
            {visible.map((line) => (
              <li key={`${line.layerId}-event`} className="leading-snug">
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
  previewLines,
  expanded,
  onToggle,
  editing,
  editState,
  companies,
  products,
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
  previewLines: PurchaseOrderStockLine[]
  expanded: boolean
  onToggle: () => void
  editing: boolean
  editState: EditState
  companies: CrmCompanyOption[]
  products: PurchaseOrderProductOption[]
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
  const previewTotals = stockQuantityTotals(previewLines)

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
            title="Show products, attachments, and details"
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
        <td className="px-3 py-2 text-muted-foreground">{po.supplier_reference || "—"}</td>
        <td className="px-3 py-2 text-muted-foreground">{formatDate(po.issued_at)}</td>
        <PurchaseOrderStockCells lines={previewLines} preview />
        <td className="px-3 py-2 text-right tabular-nums">{previewTotals.purchased}</td>
        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
          {previewTotals.remaining}
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
        <tr className="border-t border-border bg-[#fafbfc]">
          <td colSpan={9} className="px-4 py-4">
            <div className="space-y-4">
              <PurchaseOrderStockEditor
                purchaseOrderId={po.id}
                lines={po.usage.lines}
                products={products}
                onChanged={onRefresh}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Details
                  </p>
                  {editing ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="block text-xs text-muted-foreground">
                        Internal PO #
                        <input
                          value={editState.poNumber}
                          onChange={(e) => editState.setPoNumber(e.target.value)}
                          className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
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
                            className="rounded px-2 py-1 text-sm"
                          />
                        </div>
                      </label>
                      <label className="block text-xs text-muted-foreground">
                        Contract / invoice
                        <input
                          value={editState.supplierReference}
                          onChange={(e) => editState.setSupplierReference(e.target.value)}
                          placeholder="Supplier invoice or contract no."
                          className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-muted-foreground">
                        Issued date
                        <input
                          type="date"
                          value={editState.issuedAt}
                          onChange={(e) => editState.setIssuedAt(e.target.value)}
                          className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-muted-foreground sm:col-span-2">
                        Note
                        <textarea
                          value={editState.note}
                          onChange={(e) => editState.setNote(e.target.value)}
                          className="mt-1 min-h-[60px] w-full rounded border border-border bg-background px-2 py-1 text-sm"
                        />
                      </label>
                      <div className="flex gap-2 sm:col-span-2">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={onEditSubmit}
                          className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={onEditCancel}
                          className="rounded border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">Internal PO #</dt>
                        <dd className="font-medium text-foreground">{po.po_number}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Contract / invoice</dt>
                        <dd className="font-medium text-foreground">{po.supplier_reference || "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Issued</dt>
                        <dd>{formatDate(po.issued_at)}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-muted-foreground">Note</dt>
                        <dd>{po.note ? po.note : <span className="italic">No note</span>}</dd>
                      </div>
                    </dl>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Attachments
                  </p>
                  {po.documents.length === 0 ? (
                    <p className="text-xs italic text-muted-foreground">
                      No signed contract or invoice attached yet.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {po.documents.map((doc) => (
                        <li
                          key={doc.id}
                          className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1 text-xs"
                        >
                          <button
                            type="button"
                            onClick={() => onOpenDocument(doc.id)}
                            className="flex-1 truncate text-left text-primary hover:underline"
                            title={doc.file_name}
                          >
                            {doc.file_name}
                          </button>
                          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
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
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
