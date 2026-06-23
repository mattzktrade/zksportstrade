"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  addDeliveryProofAndMarkDelivered,
  getDeliveryProofDownloadUrl,
  updateInvoiceStatus,
} from "@/app/(admin)/actions"
import {
  INVOICE_UI_STATUSES,
  invoiceDisplayStatus,
  invoiceWorkflowStatusLabels,
  type InvoiceUiStatus,
  type InvoiceWorkflowStatus,
} from "@/lib/invoices/status"

export function AdminInvoiceStatusSelect({
  invoiceId,
  initialStatus,
  className,
  deliveryProofs,
}: {
  invoiceId: string | null
  initialStatus: string | null
  className?: string
  deliveryProofs?: Array<{
    id: string
    note: string | null
    fileName: string | null
    createdAt: string
  }>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [localStatus, setLocalStatus] = useState<InvoiceWorkflowStatus>(() =>
    invoiceDisplayStatus(initialStatus),
  )
  const [proofOpen, setProofOpen] = useState(false)
  const [proofNote, setProofNote] = useState("")
  const [proofFile, setProofFile] = useState<File | null>(null)
  const proofs = deliveryProofs ?? []
  const latestProof = proofs[0]

  if (!invoiceId) {
    return <span className="text-muted-foreground">—</span>
  }
  const activeInvoiceId = invoiceId

  function changeStatus(next: InvoiceUiStatus) {
    if (!INVOICE_UI_STATUSES.includes(next)) return
    if (next === "delivered" && deliveryProofs && deliveryProofs.length === 0) {
      setProofOpen(true)
      return
    }
    const prev = localStatus
    setLocalStatus(next)
    start(async () => {
      const res = await updateInvoiceStatus(activeInvoiceId, next)
      if (!res.ok) {
        setLocalStatus(prev)
        if (next === "delivered" && res.message.toLowerCase().includes("proof")) {
          setProofOpen(true)
          return
        }
        window.alert(res.message)
        return
      }
      router.refresh()
    })
  }

  function submitProof() {
    if (!proofNote.trim() && !proofFile) {
      window.alert("Add a delivery note or upload proof before marking as delivered.")
      return
    }
    const prev = localStatus
    start(async () => {
      const fd = new FormData()
      fd.set("invoiceId", activeInvoiceId)
      fd.set("note", proofNote)
      if (proofFile) fd.set("file", proofFile)
      const res = await addDeliveryProofAndMarkDelivered(fd)
      if (!res.ok) {
        setLocalStatus(prev)
        window.alert(res.message)
        return
      }
      setProofOpen(false)
      setProofNote("")
      setProofFile(null)
      setLocalStatus("delivered")
      router.refresh()
    })
  }

  function openProof(proofId: string) {
    start(async () => {
      const res = await getDeliveryProofDownloadUrl(proofId)
      if (!res.ok) {
        window.alert(res.message)
        return
      }
      window.open(res.url, "_blank", "noopener,noreferrer")
    })
  }

  return (
    <div className="space-y-1">
      <select
        aria-label="Payment status"
        className={cn(
          "w-full min-w-[140px] max-w-[180px] rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground",
          pending && "opacity-60 pointer-events-none",
          className,
        )}
        value={localStatus}
        disabled={pending}
        onChange={(e) => changeStatus(e.target.value as InvoiceUiStatus)}
      >
        {INVOICE_UI_STATUSES.map((s) => (
          <option key={s} value={s}>
            {invoiceWorkflowStatusLabels[s]}
          </option>
        ))}
      </select>
      {latestProof ? (
        <p className="text-[10px] leading-snug text-muted-foreground">
          Proof: {latestProof.fileName || latestProof.note || "internal note"}
          {latestProof.fileName ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => openProof(latestProof.id)}
              className="ml-1 text-primary hover:underline disabled:opacity-50"
            >
              Open
            </button>
          ) : null}
        </p>
      ) : null}
      {proofOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl space-y-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Proof of delivery</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Add an internal note or upload a screenshot/PDF before marking this order delivered.
              </p>
            </div>
            <label className="block text-sm">
              <span className="text-xs font-medium text-muted-foreground">Internal note</span>
              <textarea
                value={proofNote}
                onChange={(e) => setProofNote(e.target.value)}
                rows={3}
                placeholder="e.g. Tickets handed to client in person on 23 Jun 2026"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-muted-foreground">Upload proof</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm"
              />
              <span className="mt-1 block text-[11px] text-muted-foreground">JPG, PNG, WebP, or PDF up to 10MB.</span>
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setProofOpen(false)
                  setProofNote("")
                  setProofFile(null)
                }}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={submitProof}
                className="rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
              >
                Save and mark delivered
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
