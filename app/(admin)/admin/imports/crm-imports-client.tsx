"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  History,
  LoaderCircle,
  Trash2,
  Upload,
  UsersRound,
} from "lucide-react"
import { toast } from "sonner"
import {
  applyCrmImportBatch,
  deleteCrmImportBatch,
} from "@/app/(admin)/actions"
import {
  AdminPageHeader,
  AdminPanel,
  AdminStatCard,
  AdminStats,
  AdminDesktopTable,
  AdminMobileList,
  StatusPill,
} from "@/components/admin/admin-page-kit"
import type {
  CrmImportBatch,
  CrmImportPreviewRow,
} from "@/lib/crm/imports/types"
import type { CrmImportType } from "@/lib/crm/imports/salesforce-csv"
import { cn } from "@/lib/utils"

const CONTACT_TEMPLATE = [
  "First Name",
  "Last Name",
  "Account Name",
  "Title",
  "Last Activity",
  "Email",
  "Phone",
  "Mobile",
  "Mailing State/Province",
  "Mailing Country",
  "Account Owner",
  "Created Date",
]

const OPPORTUNITY_TEMPLATE = [
  "Opportunity ID",
  "Opportunity Name",
  "Account ID",
  "Account Name",
  "Primary Contact",
  "Contact ID",
  "Contact Email",
  "Opportunity Owner",
  "Owner Email",
  "Stage",
  "Is Won",
  "Is Closed",
  "Amount",
  "Currency ISO Code",
  "Close Date",
  "Lead Source",
  "Description",
  "Opportunity Product ID",
  "Product ID",
  "Product Code",
  "Product Name",
  "Quantity",
  "Sales Price",
  "Supplier",
  "Buy Price",
  "Created Date",
  "Last Modified Date",
]

function statusTone(
  status: CrmImportBatch["status"] | CrmImportPreviewRow["status"],
): "green" | "amber" | "red" | "blue" | "purple" | "gray" {
  if (status === "applied") return "green"
  if (status === "validated" || status === "valid") return "blue"
  if (status === "applying") return "purple"
  if (status === "applied_with_errors" || status === "skipped") return "amber"
  if (status === "failed" || status === "error") return "red"
  return "gray"
}

function dateTime(value: string | null): string {
  if (!value) return "—"
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function downloadTemplate(type: CrmImportType) {
  const columns = type === "contacts" ? CONTACT_TEMPLATE : OPPORTUNITY_TEMPLATE
  const example =
    type === "contacts"
      ? [
          "Jane",
          "Smith",
          "Example Travel",
          "Director",
          "2026-08-01",
          "jane@example.com",
          "+44 20 0000 0000",
          "+44 7700 900000",
          "London",
          "United Kingdom",
          "Michel",
          "2026-01-15",
        ]
      : [
          "006XXXXXXXXXXXXXXX",
          "Monaco GP 2026 - Example Travel",
          "001XXXXXXXXXXXXXXX",
          "Example Travel",
          "Jane Smith",
          "003XXXXXXXXXXXXXXX",
          "jane@example.com",
          "Michel",
          "",
          "Closed Won",
          "TRUE",
          "TRUE",
          "25000",
          "USD",
          "2026-05-01",
          "Referral",
          "Historical Salesforce opportunity",
          "00kXXXXXXXXXXXXXXX",
          "01tXXXXXXXXXXXXXXX",
          "MONACO-2026-PC",
          "Paddock Club",
          "2",
          "12500",
          "Example Supplier",
          "9000",
          "2026-02-01",
          "2026-05-01",
        ]
  const csv = [columns, example]
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
    .join("\r\n")
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `salesforce-${type}-import-template.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

function ImportUploader({
  type,
  title,
  description,
  onUploaded,
}: {
  type: CrmImportType
  title: string
  description: string
  onUploaded: (batchId: string) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  async function upload() {
    if (!file) {
      toast.error("Choose a CSV file.")
      return
    }
    setUploading(true)
    try {
      const formData = new FormData()
      formData.set("importType", type)
      formData.set("file", file)
      const response = await fetch("/api/admin/crm-imports", { method: "POST", body: formData })
      const result = (await response.json()) as {
        error?: string
        batchId?: string
        validRows?: number
        errorRows?: number
      }
      if (!response.ok || !result.batchId) {
        throw new Error(result.error ?? "Upload failed.")
      }
      toast.success(
        `Validated ${result.validRows ?? 0} row(s); ${result.errorRows ?? 0} error row(s).`,
      )
      setFile(null)
      onUploaded(result.batchId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-lg border border-[#e8eaee] bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-primary">
          {type === "contacts" ? <UsersRound className="h-4 w-4" /> : <FileSpreadsheet className="h-4 w-4" />}
        </div>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">{description}</p>
        </div>
      </div>
      <label className="mt-4 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 text-center hover:border-primary/40">
        <Upload className="h-4 w-4 text-slate-400" />
        <span className="mt-2 text-[10px] font-medium text-slate-700">
          {file ? file.name : "Choose Salesforce CSV"}
        </span>
        <span className="mt-0.5 text-[9px] text-slate-400">Maximum 25MB / 50,000 rows</span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => downloadTemplate(type)}
          className="h-9 flex-1 rounded-md border px-3 text-[10px] font-semibold"
        >
          Download template
        </button>
        <button
          type="button"
          disabled={!file || uploading}
          onClick={() => void upload()}
          className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-primary px-3 text-[10px] font-semibold text-white disabled:opacity-50"
        >
          {uploading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Validate upload
        </button>
      </div>
    </div>
  )
}

export function CrmImportsClient({
  batches,
  selectedBatchId,
  previewRows,
}: {
  batches: CrmImportBatch[]
  selectedBatchId: string | null
  previewRows: CrmImportPreviewRow[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirmed, setConfirmed] = useState(false)
  const selected = batches.find((batch) => batch.id === selectedBatchId) ?? null
  const wonRows = Number(selected?.summary.won_rows ?? 0)
  const warningRows = Number(selected?.summary.warning_rows ?? 0)
  const appliedTotal = batches.reduce((sum, batch) => sum + batch.applied_rows, 0)
  const pendingBatches = batches.filter((batch) => batch.status === "validated")

  function applyBatch() {
    if (!selected || !confirmed) return
    startTransition(async () => {
      const result = await applyCrmImportBatch(selected.id)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      setConfirmed(false)
      router.refresh()
    })
  }

  function deleteBatch() {
    if (!selected) return
    startTransition(async () => {
      const result = await deleteCrmImportBatch(selected.id)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.push("/admin/imports")
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="CRM imports"
        description="Stage, validate and apply historical contacts, opportunities and won sales from CSV."
      />

      <AdminStats className="sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard icon={History} value={batches.length} label="Import batches" tone="purple" />
        <AdminStatCard icon={CheckCircle2} value={appliedTotal} label="Rows applied" tone="green" />
        <AdminStatCard icon={Upload} value={pendingBatches.length} label="Awaiting approval" tone="blue" />
        <AdminStatCard
          icon={AlertTriangle}
          value={batches.reduce((sum, batch) => sum + batch.failed_rows + batch.error_rows, 0)}
          label="Rows requiring review"
          tone="amber"
        />
      </AdminStats>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] leading-4 text-amber-900">
        <strong>Safe migration rule:</strong> imported Closed Won sales are marked for stock
        reconciliation, but this importer never changes inventory, creates reservations, sends
        invoices or contacts clients.
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <ImportUploader
          type="contacts"
          title="Contacts and accounts"
          description="Upload the standard Salesforce Contacts report. Salesforce IDs are optional: the portal creates its own IDs and matches repeat imports by account name, then contact email or name."
          onUploaded={(batchId) => router.push(`/admin/imports?batch=${batchId}`)}
        />
        <ImportUploader
          type="opportunities"
          title="Deals, sales and opportunities"
          description="Upload an Opportunities with Products report. Open, lost and won records map to the native deal pipeline."
          onUploaded={(batchId) => router.push(`/admin/imports?batch=${batchId}`)}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <AdminPanel>
          <div className="border-b px-4 py-3">
            <h2 className="text-[11px] font-semibold">Import history</h2>
          </div>
          <div className="max-h-[680px] overflow-y-auto">
            {batches.map((batch) => (
              <Link
                key={batch.id}
                href={`/admin/imports?batch=${batch.id}`}
                className={cn(
                  "block border-b px-4 py-3 hover:bg-slate-50",
                  selected?.id === batch.id && "bg-red-50/60 ring-1 ring-inset ring-primary/20",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[10px] font-semibold">{batch.file_name}</p>
                  <StatusPill tone={statusTone(batch.status)}>
                    {batch.status.replaceAll("_", " ")}
                  </StatusPill>
                </div>
                <p className="mt-1 text-[9px] capitalize text-slate-500">
                  {batch.import_type} · {batch.total_rows} rows
                </p>
                <p className="mt-1 text-[8px] text-slate-400">
                  {dateTime(batch.created_at)}{batch.creator_name ? ` · ${batch.creator_name}` : ""}
                </p>
              </Link>
            ))}
            {batches.length === 0 ? (
              <p className="px-4 py-12 text-center text-[10px] text-slate-400">
                No import batches yet.
              </p>
            ) : null}
          </div>
        </AdminPanel>

        <AdminPanel>
          {selected ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold">{selected.file_name}</h2>
                    <StatusPill tone={statusTone(selected.status)}>
                      {selected.status.replaceAll("_", " ")}
                    </StatusPill>
                  </div>
                  <p className="mt-1 text-[9px] text-slate-500">
                    {selected.valid_rows} valid · {selected.error_rows} errors · {warningRows} warnings
                    {wonRows > 0 ? ` · ${wonRows} won-sale rows` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  {["validated", "failed"].includes(selected.status) ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={deleteBatch}
                      className="flex h-9 items-center gap-1.5 rounded-md border px-3 text-[9px] font-semibold text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  ) : null}
                </div>
              </div>

              {selected.status === "validated" || selected.status === "failed" || selected.status === "applied_with_errors" ? (
                <div className="border-b bg-slate-50 px-5 py-4">
                  <label className="flex items-start gap-2 text-[10px] text-slate-700">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      I have reviewed the validation errors and understand that only valid rows
                      will be applied. Historical won sales will not change stock.
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={pending || !confirmed || selected.valid_rows === 0}
                    onClick={applyBatch}
                    className="mt-3 flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-[10px] font-semibold text-white disabled:opacity-50"
                  >
                    {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Apply {selected.valid_rows} valid row{selected.valid_rows === 1 ? "" : "s"}
                  </button>
                </div>
              ) : null}

              <AdminDesktopTable>
                <table className="w-full min-w-[900px] text-left">
                  <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Salesforce ID</th>
                      <th className="px-3 py-2 font-medium">Account / Contact</th>
                      <th className="px-3 py-2 font-medium">Stage / Product</th>
                      <th className="px-3 py-2 font-medium">Validation / Apply result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-[9px]">
                    {previewRows.map((row) => {
                      const n = row.normalized_data
                      return (
                        <tr key={row.id} className="align-top">
                          <td className="px-3 py-3">{row.row_number}</td>
                          <td className="px-3 py-3"><StatusPill tone={statusTone(row.status)}>{row.status}</StatusPill></td>
                          <td className="max-w-[150px] break-all px-3 py-3 font-mono text-[8px]">{row.source_external_id || "Portal ID generated"}</td>
                          <td className="px-3 py-3"><p className="font-medium">{String(n.accountName ?? "—")}</p><p className="text-[8px] text-slate-400">{String(n.contactName ?? n.email ?? "—")}</p></td>
                          <td className="px-3 py-3"><p className="font-medium">{String(n.nativeStage ?? "Contact")}</p><p className="text-[8px] text-slate-400">{String(n.productName ?? n.productCode ?? "—")}</p></td>
                          <td className="max-w-[320px] px-3 py-3">
                            {row.validation_errors.map((message) => <p key={message} className="text-red-600">{message}</p>)}
                            {row.validation_warnings.map((message) => <p key={message} className="text-amber-700">{message}</p>)}
                            {row.apply_error ? <p className="text-red-600">{row.apply_error}</p> : null}
                            {row.status === "applied" ? <p className="text-emerald-600">Applied to {row.target_table}</p> : null}
                          </td>
                        </tr>
                      )
                    })}
                    {previewRows.length === 0 ? <tr><td colSpan={6} className="px-4 py-14 text-center text-[10px] text-slate-400">No preview rows.</td></tr> : null}
                  </tbody>
                </table>
              </AdminDesktopTable>
              <AdminMobileList>
                {previewRows.map((row) => {
                  const n = row.normalized_data
                  return (
                    <div key={row.id} className="space-y-1 px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold">Row {row.row_number}</p>
                        <StatusPill tone={statusTone(row.status)}>{row.status}</StatusPill>
                      </div>
                      <p className="text-[10px] text-slate-700">{String(n.accountName ?? "—")}</p>
                      <p className="text-[8px] text-slate-400">{String(n.contactName ?? n.email ?? "—")}</p>
                      {row.validation_errors[0] ? <p className="text-[8px] text-red-600">{row.validation_errors[0]}</p> : null}
                      {row.apply_error ? <p className="text-[8px] text-red-600">{row.apply_error}</p> : null}
                    </div>
                  )
                })}
                {previewRows.length === 0 ? <p className="px-4 py-14 text-center text-[10px] text-slate-400">No preview rows.</p> : null}
              </AdminMobileList>
              {selected.total_rows > 500 ? (
                <p className="border-t px-4 py-2 text-[8px] text-slate-400">
                  Showing the first 500 rows. Batch totals include all {selected.total_rows} rows.
                </p>
              ) : null}
            </>
          ) : (
            <div className="flex min-h-[360px] items-center justify-center text-[10px] text-slate-400">
              Upload or select an import batch to review it.
            </div>
          )}
        </AdminPanel>
      </div>
    </div>
  )
}

