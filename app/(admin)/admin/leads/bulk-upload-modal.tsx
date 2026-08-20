"use client"

import { useRef, useState, useTransition } from "react"
import { Download, Upload, X } from "lucide-react"
import { toast } from "sonner"
import {
  applyAccountBulkUpload,
  previewAccountBulkUpload,
} from "@/app/(admin)/admin/leads/bulk-upload-actions"
import { AccountKindPills } from "@/components/admin/account-kind-pills"
import { StatusPill } from "@/components/admin/admin-page-kit"
import {
  ACCOUNT_BULK_MAX_ROWS,
  ACCOUNT_BULK_TEMPLATE_CSV,
  type ParsedAccountBulkRow,
} from "@/lib/crm/account-bulk-upload"
import { accountKindLabels, type AccountKind } from "@/lib/crm/account-kinds"
import {
  ACCOUNT_SOURCE_LABELS,
  type AccountSource,
  type StaffOption,
} from "@/lib/crm/lead-types"

function downloadTemplate() {
  const blob = new Blob([ACCOUNT_BULK_TEMPLATE_CSV], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "account-bulk-upload-template.csv"
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function AccountBulkUploadModal({
  staffOptions,
  onClose,
  onImported,
}: {
  staffOptions: StaffOption[]
  onClose: () => void
  onImported: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [fileName, setFileName] = useState("")
  const [csvText, setCsvText] = useState("")
  const [source, setSource] = useState<AccountSource>("marketing")
  const [accountTypes, setAccountTypes] = useState<AccountKind[]>([])
  const [ownerId, setOwnerId] = useState("")
  const [preview, setPreview] = useState<{
    totalRows: number
    validRows: number
    errorRows: number
    sample: ParsedAccountBulkRow[]
  } | null>(null)

  function defaults() {
    return {
      source,
      accountTypes,
      ownerProfileId: ownerId || null,
    }
  }

  function readFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv") && file.type && !file.type.includes("csv")) {
      toast.error("Please choose a CSV file.")
      return
    }
    setFileName(file.name)
    setPreview(null)
    startTransition(async () => {
      const text = await file.text()
      setCsvText(text)
      const result = await previewAccountBulkUpload({ csvText: text, ...defaults() })
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

  function rerunPreview() {
    if (!csvText) {
      toast.error("Choose a CSV file first.")
      return
    }
    startTransition(async () => {
      const result = await previewAccountBulkUpload({ csvText, ...defaults() })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setPreview(result)
    })
  }

  function apply() {
    if (!csvText || !preview || preview.validRows === 0) return
    startTransition(async () => {
      const result = await applyAccountBulkUpload({ csvText, ...defaults() })
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
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between px-6 pt-6">
          <div>
            <h2 className="text-lg font-semibold">Bulk upload accounts</h2>
            <p className="text-sm text-slate-500">
              Import a campaign list as companies and contacts. Repeat the company name on each
              contact row — they are grouped onto one account. Existing companies are matched by
              name; contacts already on that company are skipped.
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
                <Upload className="h-4 w-4" /> {fileName || "Choose CSV"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) readFile(file)
                  e.target.value = ""
                }}
              />
            </div>
            <p className="text-xs text-slate-500">
              Columns: account name, contact name (or first + last), email, phone, job title,
              account type, source, owner, notes, city, country. Put the same company name on every
              contact at that company. Owner can be a staff name or email; leave it blank to use the
              default below. Rows without a company name are saved as a direct client using the
              contact name. Up to {ACCOUNT_BULK_MAX_ROWS.toLocaleString()} rows.
            </p>

            <div>
              <p className="mb-1 text-sm font-medium">Default type</p>
              <p className="mb-2 text-xs text-slate-500">
                Used when a row does not specify a type. Direct clients without a company name are
                always saved as Direct client.
              </p>
              <AccountKindPills compact value={accountTypes} onChange={setAccountTypes} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block font-medium">Default source</span>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as AccountSource)}
                  className="h-11 w-full rounded-md border bg-white px-3"
                >
                  {Object.entries(ACCOUNT_SOURCE_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Default owner</span>
                <select
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  className="h-11 w-full rounded-md border bg-white px-3"
                >
                  <option value="">Unassigned — needs allocating</option>
                  {staffOptions.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {preview ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="blue">{preview.totalRows} rows</StatusPill>
                  <StatusPill tone="green">{preview.validRows} ready</StatusPill>
                  {preview.errorRows ? (
                    <StatusPill tone="red">{preview.errorRows} with errors</StatusPill>
                  ) : null}
                  <button
                    type="button"
                    onClick={rerunPreview}
                    className="ml-auto text-xs font-medium text-primary"
                  >
                    Refresh preview
                  </button>
                </div>
                <div className="overflow-x-auto rounded-lg border border-[#eceef1]">
                  <table className="w-full min-w-[820px] text-left text-[9px]">
                    <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-[#92969e]">
                      <tr>
                        <th className="px-3 py-2 font-medium">Row</th>
                        <th className="px-3 py-2 font-medium">Account</th>
                        <th className="px-3 py-2 font-medium">Contact</th>
                        <th className="px-3 py-2 font-medium">Email</th>
                        <th className="px-3 py-2 font-medium">Owner</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {preview.sample.map((row) => (
                        <tr key={row.rowNumber} className={row.errors.length ? "bg-red-50/60" : ""}>
                          <td className="px-3 py-2 text-slate-400">{row.rowNumber}</td>
                          <td className="px-3 py-2 font-medium">{row.accountName || "—"}</td>
                          <td className="px-3 py-2">{row.contactName || "—"}</td>
                          <td className="px-3 py-2">{row.email || "—"}</td>
                          <td className="px-3 py-2">{row.ownerName || "Unassigned"}</td>
                          <td className="px-3 py-2">{accountKindLabels(row.accountTypes)}</td>
                          <td className="px-3 py-2">
                            {row.errors.length
                              ? row.errors.join(" ")
                              : row.warnings[0] ?? "Ready"}
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
            {pending ? "Working…" : preview ? `Import ${preview.validRows} row${preview.validRows === 1 ? "" : "s"}` : "Import"}
          </button>
        </div>
      </div>
    </div>
  )
}
