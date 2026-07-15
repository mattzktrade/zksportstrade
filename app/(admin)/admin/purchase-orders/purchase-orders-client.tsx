"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  createPurchaseOrder,
  deletePurchaseOrder,
  deletePurchaseOrderDocument,
  getPurchaseOrderDocumentDownloadUrl,
  updatePurchaseOrder,
  uploadPurchaseOrderDocument,
} from "@/app/(admin)/actions"
import type { PurchaseOrderWithMeta } from "@/lib/admin/purchase-orders"

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

export function PurchaseOrdersClient({ orders }: { orders: PurchaseOrderWithMeta[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [showCreate, setShowCreate] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  // Create form state
  const [newPoNumber, setNewPoNumber] = useState("")
  const [newSupplier, setNewSupplier] = useState("")
  const [newIssuedAt, setNewIssuedAt] = useState("")
  const [newNote, setNewNote] = useState("")

  // Edit form state (mirrored per-row)
  const [editPoNumber, setEditPoNumber] = useState("")
  const [editSupplier, setEditSupplier] = useState("")
  const [editIssuedAt, setEditIssuedAt] = useState("")
  const [editNote, setEditNote] = useState("")

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return orders
    return orders.filter((o) => {
      const hay = [o.po_number, o.supplier, o.note ?? "", ...o.usage.package_ids].join(" ").toLowerCase()
      return hay.includes(q)
    })
  }, [orders, search])

  function resetCreate() {
    setNewPoNumber("")
    setNewSupplier("")
    setNewIssuedAt("")
    setNewNote("")
  }

  function submitCreate() {
    if (!newPoNumber.trim()) {
      toast.error("PO number is required.")
      return
    }
    if (!newSupplier.trim()) {
      toast.error("Supplier is required.")
      return
    }
    start(async () => {
      const res = await createPurchaseOrder({
        poNumber: newPoNumber.trim(),
        supplier: newSupplier.trim(),
        issuedAt: newIssuedAt.trim() || null,
        note: newNote.trim() || null,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Purchase order created.")
      resetCreate()
      setShowCreate(false)
      router.refresh()
    })
  }

  function startEdit(po: PurchaseOrderWithMeta) {
    setEditingId(po.id)
    setEditPoNumber(po.po_number)
    setEditSupplier(po.supplier)
    setEditIssuedAt(po.issued_at ?? "")
    setEditNote(po.note ?? "")
    setExpandedId(po.id)
  }

  function submitEdit(po: PurchaseOrderWithMeta) {
    const clearIssuedAt = !editIssuedAt.trim()
    start(async () => {
      const res = await updatePurchaseOrder({
        id: po.id,
        poNumber: editPoNumber.trim(),
        supplier: editSupplier.trim(),
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search PO number, supplier, package…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[220px] max-w-md px-3 py-2 rounded-lg border border-border bg-background text-sm"
        />
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
        >
          {showCreate ? "Cancel" : "New purchase order"}
        </button>
      </div>

      {showCreate ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
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
              <input
                value={newSupplier}
                onChange={(e) => setNewSupplier(e.target.value)}
                placeholder="e.g. F1 Direct"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
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

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">PO number</th>
              <th className="px-3 py-2 font-medium">Supplier</th>
              <th className="px-3 py-2 font-medium">Issued</th>
              <th className="px-3 py-2 font-medium text-right">Layers</th>
              <th className="px-3 py-2 font-medium text-right">Qty bought</th>
              <th className="px-3 py-2 font-medium text-right">Remaining</th>
              <th className="px-3 py-2 font-medium text-right">Docs</th>
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
                    supplier: editSupplier,
                    issuedAt: editIssuedAt,
                    note: editNote,
                    setPoNumber: setEditPoNumber,
                    setSupplier: setEditSupplier,
                    setIssuedAt: setEditIssuedAt,
                    setNote: setEditNote,
                  }}
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
  supplier: string
  issuedAt: string
  note: string
  setPoNumber: (v: string) => void
  setSupplier: (v: string) => void
  setIssuedAt: (v: string) => void
  setNote: (v: string) => void
}

function PurchaseOrderRow({
  po,
  expanded,
  onToggle,
  editing,
  editState,
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
      <tr className="border-t border-border align-top">
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
        <td className="px-3 py-2 text-muted-foreground">{po.supplier}</td>
        <td className="px-3 py-2 text-muted-foreground">{formatDate(po.issued_at)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
          {po.usage.layer_count}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{po.usage.quantity_purchased}</td>
        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
          {po.usage.quantity_remaining}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{po.documents.length}</td>
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
                      <input
                        value={editState.supplier}
                        onChange={(e) => editState.setSupplier(e.target.value)}
                        className="mt-1 w-full px-2 py-1 rounded border border-border bg-background text-sm"
                      />
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
                      <span className="font-medium text-foreground">Packages:</span>{" "}
                      {po.usage.package_ids.length === 0 ? (
                        <span className="italic">not linked to any cost layer yet</span>
                      ) : (
                        po.usage.package_ids.join(", ")
                      )}
                    </p>
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
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Attach the signed contract, invoice, or PO. Salesforce Stock Sources will list each file
                  name on the next product sync — hosted here in the portal.
                </p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
