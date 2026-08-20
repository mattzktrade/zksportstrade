import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type {
  CrmImportBatch,
  CrmImportPreviewRow,
} from "@/lib/crm/imports/types"

export async function getCrmImportBatches(): Promise<CrmImportBatch[]> {
  noStore()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("crm_import_batches")
    .select(`
      id, import_type, file_name, status, total_rows, valid_rows, error_rows,
      applied_rows, skipped_rows, failed_rows, headers, summary, created_at,
      applied_at, created_by
    `)
    .order("created_at", { ascending: false })
    .limit(100)
  if (error || !data) return []

  const creatorIds = [...new Set(data.map((row) => row.created_by).filter(Boolean))] as string[]
  const { data: creators } = creatorIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", creatorIds)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string }> }
  const creatorName = new Map(
    (creators ?? []).map((profile) => [
      profile.id,
      profile.full_name?.trim() || profile.email,
    ]),
  )

  return data.map((row) => ({
    id: row.id,
    import_type: row.import_type,
    file_name: row.file_name,
    status: row.status,
    total_rows: Number(row.total_rows),
    valid_rows: Number(row.valid_rows),
    error_rows: Number(row.error_rows),
    applied_rows: Number(row.applied_rows),
    skipped_rows: Number(row.skipped_rows),
    failed_rows: Number(row.failed_rows),
    headers: Array.isArray(row.headers) ? (row.headers as string[]) : [],
    summary:
      row.summary && typeof row.summary === "object"
        ? (row.summary as Record<string, unknown>)
        : {},
    created_at: row.created_at,
    applied_at: row.applied_at,
    creator_name: row.created_by ? creatorName.get(row.created_by) ?? null : null,
  })) as CrmImportBatch[]
}

export async function getCrmImportPreviewRows(
  batchId: string | null,
): Promise<CrmImportPreviewRow[]> {
  noStore()
  if (!batchId) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("crm_import_rows")
    .select(`
      id, row_number, source_external_id, normalized_data, validation_errors,
      validation_warnings, status, target_table, target_id, apply_error
    `)
    .eq("batch_id", batchId)
    .order("row_number")
    .limit(500)
  if (error || !data) return []
  return data as CrmImportPreviewRow[]
}

