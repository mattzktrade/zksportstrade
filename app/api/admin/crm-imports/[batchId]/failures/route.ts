import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { dealLedgerFailuresCsv } from "@/lib/crm/imports/deal-ledger"
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows"

export const runtime = "nodejs"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type FailureRow = {
  raw_data: Record<string, string>
  normalized_data: Record<string, string | number | boolean | null>
  validation_errors: string[]
  validation_warnings: string[]
  apply_error: string | null
  status: string
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorised." }, { status: 401 })

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Only admins can export CRM import rows." }, { status: 403 })
  }

  const { batchId } = await context.params
  if (!UUID_RE.test(batchId)) {
    return NextResponse.json({ error: "Import batch id is not valid." }, { status: 400 })
  }
  const { data: batch, error: batchError } = await supabase
    .from("crm_import_batches")
    .select("id, file_name, headers, import_type")
    .eq("id", batchId)
    .maybeSingle()
  if (batchError) return NextResponse.json({ error: batchError.message }, { status: 400 })
  if (!batch) return NextResponse.json({ error: "Import batch was not found." }, { status: 404 })

  const { data: rows, error } = await fetchAllRows<FailureRow>((from, to) =>
    supabase
      .from("crm_import_rows")
      .select("raw_data, normalized_data, validation_errors, validation_warnings, apply_error, status")
      .eq("batch_id", batchId)
      .in("status", ["error", "failed", "skipped"])
      .order("row_number")
      .range(from, to),
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const headers = Array.isArray(batch.headers) ? (batch.headers as string[]) : []
  const csv = dealLedgerFailuresCsv(
    (rows ?? []).map((row) => ({
      rawData: row.raw_data && typeof row.raw_data === "object" ? row.raw_data : {},
      errors: row.validation_errors ?? [],
      warnings: row.validation_warnings ?? [],
      applyError: row.apply_error,
      sheet:
        row.normalized_data && typeof row.normalized_data.sheet === "string"
          ? row.normalized_data.sheet
          : null,
      sourceRow:
        row.normalized_data && typeof row.normalized_data.sourceRow === "number"
          ? row.normalized_data.sourceRow
          : null,
      matchSummary:
        row.normalized_data && typeof row.normalized_data.matchSummary === "string"
          ? row.normalized_data.matchSummary
          : null,
    })),
    headers,
  )
  const safeName = String(batch.file_name || "sales-ledger")
    .replace(/[^\w.-]+/g, "-")
    .replace(/\.xlsx?$/i, "")
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}-unmatched.csv"`,
    },
  })
}
