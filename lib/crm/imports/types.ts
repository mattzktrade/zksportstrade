import type { CrmImportType as SalesforceImportType } from "@/lib/crm/imports/salesforce-csv"

export type CrmImportType = SalesforceImportType | "deal_ledger"

export type CrmImportBatch = {
  id: string
  import_type: CrmImportType
  file_name: string
  status: "validated" | "applying" | "applied" | "applied_with_errors" | "failed"
  total_rows: number
  valid_rows: number
  error_rows: number
  applied_rows: number
  skipped_rows: number
  failed_rows: number
  headers: string[]
  summary: Record<string, unknown>
  created_at: string
  applied_at: string | null
  creator_name: string | null
}

export type CrmImportPreviewRow = {
  id: string
  row_number: number
  source_external_id: string | null
  normalized_data: Record<string, string | number | boolean | null>
  validation_errors: string[]
  validation_warnings: string[]
  status: "valid" | "error" | "applied" | "skipped" | "failed"
  target_table: string | null
  target_id: string | null
  apply_error: string | null
}

