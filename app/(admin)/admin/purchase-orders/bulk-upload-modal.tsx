"use client"

import { useRef, useState, useTransition } from "react"
import { Download, Upload, X } from "lucide-react"
import { toast } from "sonner"
import {
  applyPurchaseBulkUpload,
  previewPurchaseBulkUpload,
} from "@/app/(admin)/admin/purchase-orders/bulk-upload-actions"
import { StatusPill } from "@/components/admin/admin-page-kit"
import {
  PURCHASE_BULK_MAX_ROWS,
  PURCHASE_BULK_TEMPLATE_CSV,
  type ParsedPurchaseBulkRow,
} from "@/lib/inventory/purchase-bulk-upload"

function downloadTemplate() {
  const blob = new Blob([PURCHASE_BULK_TEMPLATE_CSV], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "inventory-purchase-bulk-upload-template.csv"
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function money(value: number | null): string {
  if (value == null) return "—"
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

export function PurchaseBulkUploadModal({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [fileName, setFileName] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<{
    totalRows: number
    validRows: number
    errorRows: number
    sample: ParsedPurchaseBulkRow[]
  } | null>(null)

  function readFile(chosen: File) {
    const name = chosen.name.toLowerCase()
    if (!name.endsWith(".csv") && !name.endsWith(".xlsx") && !name.endsWith(".xlsm")) {
      toast.error("Upload the Excel workbook (.xlsx) or a CSV export.")
      return
    }
    setFileName(chosen.name)
    setFile(chosen)
    setPreview(null)
    startTransition(async () => {
      const formData = new FormData()
      formData.append("file", chosen)
      const result = await previewPurchaseBulkUpload(formData)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setPreview(result)
      if (result.validRows === 0) {
        toast.error("There are no valid rows in that file.")
      }
    })
  }

  function apply() {
    if (!file || !preview || preview.validRows === 0) return
    startTransition(async () => {
      const formData = new FormData()
      formData.append("file", file)
      const result = await applyPurchaseBulkUpload(formData)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      if (result.failed) toast.warning(result.message)
      else toast.success(result.message)
      onImported()
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
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between px-6 pt-6">
          <div>
            <h2 className="text-lg font-semibold">Bulk upload stock purchases</h2>
            <p className="text-sm text-slate-500">
              Import the inventory purchase spreadsheet as purchase orders and stock. Upload the
              Excel file (.xlsx) so contract hyperlinks in Order / Contract are kept — a CSV
              export only includes the visible text.
            </p>
          </div>
          <button type="button" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-5">
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
                accept=".xlsx,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) readFile(file)
                  e.target.value = ""
                }}
              />
            </div>
            <p className="text-xs text-slate-500">
              Columns: Event, Package, QTY, Total, Cost Per Unit, Parking, Supplier, Order /
              Contract,               Invoice Number, Paid, Sold, Legend Day, Tour Times, Contact, Contact Email.
              Invoice and Order / Contract numbers are stored as the supplier reference — a new
              internal PO number is assigned on import. Contract hyperlinks are saved on the purchase order and downloaded when the file is
              publicly reachable (Google Drive/SharePoint links that need a login cannot be
              fetched). Missing products are created on the matched event, hidden from the portal,
              with this stock added. Up to {PURCHASE_BULK_MAX_ROWS.toLocaleString()} rows.
            </p>

            {preview ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="blue">{preview.totalRows} rows</StatusPill>
                  <StatusPill tone="green">{preview.validRows} ready</StatusPill>
                  {preview.errorRows ? (
                    <StatusPill tone="red">{preview.errorRows} with errors</StatusPill>
                  ) : null}
                </div>
                <div className="overflow-x-auto rounded-lg border border-[#eceef1]">
                  <table className="w-full min-w-[980px] text-left text-[9px]">
                    <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-[#92969e]">
                      <tr>
                        <th className="px-3 py-2 font-medium">Row</th>
                        <th className="px-3 py-2 font-medium">Event</th>
                        <th className="px-3 py-2 font-medium">Package</th>
                        <th className="px-3 py-2 font-medium">Qty</th>
                        <th className="px-3 py-2 font-medium">Unit cost</th>
                        <th className="px-3 py-2 font-medium">Supplier</th>
                        <th className="px-3 py-2 font-medium">Contract / invoice</th>
                        <th className="px-3 py-2 font-medium">Contract</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {preview.sample.map((row) => (
                        <tr key={row.rowNumber} className={row.errors.length ? "bg-red-50/60" : ""}>
                          <td className="px-3 py-2 text-slate-400">{row.rowNumber}</td>
                          <td className="px-3 py-2">{row.eventName || row.eventLabel || "—"}</td>
                          <td className="px-3 py-2 font-medium">
                            {row.willCreatePackage ? `Create: ${row.createPackageName}` : row.stockPackageName || row.packageName || row.packageLabel || "—"}
                          </td>
                          <td className="px-3 py-2">{row.quantity ?? "—"}</td>
                          <td className="px-3 py-2">{money(row.unitCost)}</td>
                          <td className="px-3 py-2">{row.supplierName || "—"}</td>
                          <td className="px-3 py-2">{row.supplierReference || "—"}</td>
                          <td className="px-3 py-2">
                            {row.contractUrl ? "Link" : row.contractLocal ? "Local file" : "—"}
                          </td>
                          <td className="px-3 py-2">
                            {row.errors.length ? row.errors.join(" ") : row.warnings[0] ?? "Ready"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.totalRows > preview.sample.length ? (
                  <p className="text-xs text-slate-500">
                    Showing the first {preview.sample.length} rows. The full file is imported.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-[#eceef1] px-6 py-4">
          <button type="button" onClick={onClose} className="h-10 rounded-md border px-4 text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={pending || !preview || preview.validRows === 0}
            onClick={apply}
            className="h-10 rounded-md bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending
              ? "Working…"
              : preview
                ? `Import ${preview.validRows} row${preview.validRows === 1 ? "" : "s"}`
                : "Import"}
          </button>
        </div>
      </div>
    </div>
  )
}
