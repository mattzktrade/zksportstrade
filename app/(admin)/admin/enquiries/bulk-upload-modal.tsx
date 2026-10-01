"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import { Download, Upload, X } from "lucide-react"
import { toast } from "sonner"
import {
  applyEnquiryBulkUpload,
  previewEnquiryBulkUpload,
} from "@/app/(admin)/admin/enquiries/bulk-upload-actions"
import { StatusPill } from "@/components/admin/admin-page-kit"
import type { DealBasketProduct } from "@/components/admin/deal-line-basket"
import {
  ENQUIRY_BULK_MAX_ROWS,
  ENQUIRY_BULK_TEMPLATE_CSV,
  type ParsedEnquiryBulkRow,
} from "@/lib/crm/enquiry-bulk-upload"

function downloadTemplate() {
  const blob = new Blob([ENQUIRY_BULK_TEMPLATE_CSV], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "enquiry-bulk-upload-template.csv"
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function ticketLabel(row: ParsedEnquiryBulkRow): string {
  if (row.quantity == null) return row.ticketText || "—"
  if (row.ticketText && row.ticketText.replace(/\s+/g, " ").trim() !== String(row.quantity)) {
    return `${row.quantity} (${row.ticketText})`
  }
  return String(row.quantity)
}

export function EnquiryBulkUploadModal({
  products,
  onClose,
  onImported,
}: {
  products: DealBasketProduct[]
  onClose: () => void
  onImported: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const applyLock = useRef(false)
  const [pending, startTransition] = useTransition()
  const [fileName, setFileName] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [packageQuery, setPackageQuery] = useState("Mexico paddock")
  const [packageId, setPackageId] = useState("")
  const [preview, setPreview] = useState<{
    totalRows: number
    readyRows: number
    duplicateRows: number
    errorRows: number
    rows: ParsedEnquiryBulkRow[]
  } | null>(null)

  const selected = products.find((product) => product.id === packageId) ?? null
  const matches = useMemo(() => {
    const terms = packageQuery.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const pool = terms.length
      ? products.filter((product) => {
          const label = product.label.toLowerCase()
          return terms.every((term) => label.includes(term))
        })
      : products
    return pool.slice(0, 8)
  }, [packageQuery, products])

  function runPreview(chosen: File, nextPackageId: string) {
    if (!nextPackageId) {
      setPreview(null)
      return
    }
    startTransition(async () => {
      const formData = new FormData()
      formData.append("file", chosen)
      formData.append("packageId", nextPackageId)
      const result = await previewEnquiryBulkUpload(formData)
      if (!result.ok) {
        toast.error(result.message)
        setPreview(null)
        return
      }
      setPreview(result)
      if (result.readyRows === 0) toast.error("There are no new rows ready to import.")
    })
  }

  function chooseFile(chosen: File) {
    const name = chosen.name.toLowerCase()
    if (!name.endsWith(".csv") && !name.endsWith(".xlsx") && !name.endsWith(".xlsm") && !name.endsWith(".txt")) {
      toast.error("Upload an Excel workbook (.xlsx) or a CSV export.")
      return
    }
    setFileName(chosen.name)
    setFile(chosen)
    setPreview(null)
    runPreview(chosen, packageId)
  }

  function choosePackage(id: string) {
    setPackageId(id)
    setPreview(null)
    if (file) runPreview(file, id)
  }

  function apply() {
    if (applyLock.current || !file || !packageId || !preview || preview.readyRows === 0) return
    applyLock.current = true
    startTransition(async () => {
      try {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("packageId", packageId)
        const result = await applyEnquiryBulkUpload(formData)
        if (!result.ok) {
          toast.error(result.message)
          return
        }
        if (result.failed || result.skipped) toast.warning(result.message)
        else toast.success(result.message)
        onImported()
      } finally {
        applyLock.current = false
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      data-escape-close=""
      onClick={onClose}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6">
          <div>
            <h2 className="text-lg font-semibold">Bulk upload enquiries</h2>
            <p className="mt-1 text-sm text-slate-500">
              For people who enquired before leads came into the portal. Choose the package once —
              every row becomes a new enquiry for it. Name, email, phone, and ticket count are read
              from the sheet. Other answers, such as how soon they want to book, are saved on the enquiry.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-5">
            <div>
              <label className="text-xs font-medium text-slate-600" htmlFor="enquiry-bulk-package">
                Package
              </label>
              {selected ? (
                <div className="mt-1 flex items-center justify-between gap-3 rounded-md border border-[#eceef1] px-3 py-2">
                  <p className="text-sm font-medium">{selected.label}</p>
                  <button
                    type="button"
                    className="shrink-0 text-xs font-medium text-primary"
                    onClick={() => {
                      setPackageId("")
                      setPreview(null)
                    }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    id="enquiry-bulk-package"
                    value={packageQuery}
                    onChange={(event) => setPackageQuery(event.target.value)}
                    placeholder="Search event or package"
                    className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                  />
                  <div className="mt-2 overflow-hidden rounded-md border border-[#eceef1]">
                    {matches.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-slate-500">No packages match that search.</p>
                    ) : (
                      matches.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => choosePackage(product.id)}
                          className="block w-full border-b border-[#f3f4f6] px-3 py-2 text-left text-sm last:border-b-0 hover:bg-[#fafbfc]"
                        >
                          {product.label}
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={downloadTemplate}
                className="flex h-10 items-center gap-1.5 rounded-md border px-4 text-sm font-medium"
              >
                <Download className="h-4 w-4" /> Download template
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-10 items-center gap-1.5 rounded-md border border-primary px-4 text-sm font-medium text-primary"
              >
                <Upload className="h-4 w-4" /> {fileName || "Choose Excel or CSV"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xlsm,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(event) => {
                  const chosen = event.target.files?.[0]
                  if (chosen) chooseFile(chosen)
                  event.target.value = ""
                }}
              />
            </div>
            <p className="text-xs text-slate-500">
              A header row is optional. The export can stay as it is: first name, last name, phone,
              email, how many tickets, and any other answers. A range such as 3–4 tickets is saved as
              4, and 5+ is saved as 5. No price is added and stock is not held. These enquiries are
              not added to the automatic marketing follow-up. Up to {ENQUIRY_BULK_MAX_ROWS.toLocaleString()} rows.
              {packageId ? "" : " Choose the package before the file is checked."}
            </p>

            {preview ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="blue">{preview.totalRows} rows</StatusPill>
                  <StatusPill tone="green">{preview.readyRows} ready</StatusPill>
                  {preview.duplicateRows ? (
                    <StatusPill tone="amber">{preview.duplicateRows} already in</StatusPill>
                  ) : null}
                  {preview.errorRows ? (
                    <StatusPill tone="red">{preview.errorRows} need a fix</StatusPill>
                  ) : null}
                </div>
                <div className="max-h-[40vh] overflow-auto rounded-lg border border-[#eceef1]">
                  <table className="w-full min-w-[860px] text-left text-[11px]">
                    <thead className="sticky top-0 bg-[#fafbfc] text-[10px] uppercase tracking-wide text-[#92969e]">
                      <tr>
                        <th className="px-3 py-2 font-medium">Row</th>
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Email</th>
                        <th className="px-3 py-2 font-medium">Phone</th>
                        <th className="px-3 py-2 font-medium">Tickets</th>
                        <th className="px-3 py-2 font-medium">Other answers</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {preview.rows.map((row) => (
                        <tr key={row.rowNumber}>
                          <td className="px-3 py-2 text-slate-400">{row.rowNumber}</td>
                          <td className="px-3 py-2 font-medium">{row.fullName || "—"}</td>
                          <td className="px-3 py-2">{row.email || "—"}</td>
                          <td className="px-3 py-2">{row.phone || "—"}</td>
                          <td className="px-3 py-2">{ticketLabel(row)}</td>
                          <td className="max-w-[240px] px-3 py-2 text-slate-500">
                            {row.answers.map((answer) => answer.answer).join(" · ") || "—"}
                          </td>
                          <td className="px-3 py-2">
                            {row.status === "ready" ? (
                              <StatusPill tone="green">Ready</StatusPill>
                            ) : row.status === "duplicate" ? (
                              <span className="text-amber-700">{row.message}</span>
                            ) : (
                              <span className="text-red-600">{row.message}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-[#eceef1] px-6 py-4">
          <button type="button" onClick={onClose} className="h-10 rounded-md border px-4 text-sm font-medium">
            Cancel
          </button>
          <button
            type="button"
            disabled={pending || !preview || preview.readyRows === 0}
            onClick={apply}
            className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending
              ? "Working…"
              : preview
                ? `Import ${preview.readyRows} ${preview.readyRows === 1 ? "enquiry" : "enquiries"}`
                : "Import"}
          </button>
        </div>
      </div>
    </div>
  )
}
