import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  parseSalesforceCsv,
  type CrmImportType as SalesforceImportType,
} from "@/lib/crm/imports/salesforce-csv"
import type { CrmImportType } from "@/lib/crm/imports/types"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import {
  dealLedgerNormalizedData,
  parseDealLedgerCsv,
  type ParsedDealLedger,
} from "@/lib/crm/imports/deal-ledger"
import { loadDealLedgerCatalog } from "@/lib/crm/imports/deal-ledger-catalog"
import { matchDealLedgerRows } from "@/lib/crm/imports/deal-ledger-match"

export const runtime = "nodejs"

const MAX_FILE_BYTES = 25 * 1024 * 1024
const INSERT_CHUNK_SIZE = 500

function productKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((token) => (token === "days" ? "day" : token))
    .sort()
    .join(" ")
}

function eventTokens(value: string): Set<string> {
  const ignored = new Set([
    "f1", "gp", "grand", "prix", "formula", "one", "race",
  ])
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((token) => token && !ignored.has(token)),
  )
}

export async function POST(request: Request) {
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
    return NextResponse.json({ error: "Only admins can run CRM imports." }, { status: 403 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get("file")
    const importType = String(formData.get("importType") ?? "") as CrmImportType
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Choose a spreadsheet to upload." }, { status: 400 })
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File must be 25MB or smaller." }, { status: 400 })
    }
    if (importType === "deal_ledger") {
      return stageDealLedgerImport(supabase, user.id, file)
    }
    if (!["contacts", "opportunities"].includes(importType)) {
      return NextResponse.json({ error: "Select a valid import type." }, { status: 400 })
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ error: "Salesforce imports only accept CSV files." }, { status: 400 })
    }

    const parsed = parseSalesforceCsv(await file.text(), importType as SalesforceImportType)
    if (importType === "opportunities") {
      const { data: packageRows, error: packageError } = await supabase
        .from("packages")
        .select("id, name, races(name, season)")
        .is("shell_parent_package_id", null)
      if (packageError) throw new Error(packageError.message)
      const packagesByName = new Map<
        string,
        Array<{ id: string; raceName: string }>
      >()
      for (const packageRow of packageRows ?? []) {
        const raceRelation = packageRow.races as
          | { name?: string | null; season?: number | null }
          | Array<{ name?: string | null; season?: number | null }>
          | null
        const race = Array.isArray(raceRelation) ? raceRelation[0] : raceRelation
        const normalizedName = productKey(String(packageRow.name ?? ""))
        if (!normalizedName) continue
        const matches = packagesByName.get(normalizedName) ?? []
        matches.push({
          id: String(packageRow.id),
          raceName: eventSeasonLabel(
            String(race?.name ?? ""),
            race?.season == null ? null : Number(race.season),
          ),
        })
        packagesByName.set(normalizedName, matches)
      }
      for (const row of parsed.rows) {
        const normalized = row.normalizedData
        if (
          normalized.packageId ||
          normalized.salesforceProductId ||
          normalized.productCode ||
          !normalized.productName
        ) {
          continue
        }
        const allNameCandidates =
          packagesByName.get(productKey(String(normalized.productName))) ?? []
        const opportunityYears =
          String(normalized.opportunityName ?? "").match(/\b20\d{2}\b/g) ?? []
        const candidates = opportunityYears.length
          ? allNameCandidates.filter((candidate) =>
              opportunityYears.some((year) =>
                new RegExp(`\\b${year}\\b`).test(candidate.raceName),
              ),
            )
          : allNameCandidates
        let match: { id: string; raceName: string } | null =
          candidates.length === 1 ? candidates[0] : null
        if (!match && candidates.length > 1) {
          const opportunityTokens = eventTokens(String(normalized.opportunityName ?? ""))
          const scored = candidates
            .map((candidate) => ({
              candidate,
              score: [...eventTokens(candidate.raceName)].filter((token) =>
                opportunityTokens.has(token),
              ).length,
            }))
            .sort((a, b) => b.score - a.score)
          if (scored[0] && scored[0].score > 0 && scored[0].score > (scored[1]?.score ?? -1)) {
            match = scored[0].candidate
          }
        }
        if (match) {
          normalized.packageId = match.id
          row.warnings.push(
            `Product matched to portal package ${match.id} using product and event names; review before applying.`,
          )
        } else if (allNameCandidates.length > 0 && candidates.length === 0) {
          row.warnings.push(
            "Product name only matches portal packages from a different event season; this line will import without a product.",
          )
        } else if (candidates.length > 1) {
          row.warnings.push(
            "Product name matches multiple portal packages and the event could not safely disambiguate them; this line will import without a product.",
          )
        } else {
          row.warnings.push(
            "Product name does not exactly match a portal package; this line will import without a product.",
          )
        }
      }
    }
    const wonRows = parsed.rows.filter(
      (row) => row.normalizedData.isWon === true && row.errors.length === 0,
    ).length
    const warningRows = parsed.rows.filter((row) => row.warnings.length > 0).length
    const { data: batch, error: batchError } = await supabase
      .from("crm_import_batches")
      .insert({
        import_type: importType,
        file_name: file.name.slice(0, 255),
        status: "validated",
        total_rows: parsed.totalRows,
        valid_rows: parsed.validRows,
        error_rows: parsed.errorRows,
        headers: parsed.headers,
        summary: {
          warning_rows: warningRows,
          won_rows: wonRows,
          stock_will_change: false,
        },
        created_by: user.id,
      })
      .select("id")
      .single()
    if (batchError || !batch) {
      throw new Error(batchError?.message ?? "Could not create import batch.")
    }

    try {
      for (let i = 0; i < parsed.rows.length; i += INSERT_CHUNK_SIZE) {
        const chunk = parsed.rows.slice(i, i + INSERT_CHUNK_SIZE).map((row) => ({
          batch_id: batch.id,
          row_number: row.rowNumber,
          source_external_id: row.sourceExternalId,
          raw_data: row.rawData,
          normalized_data: row.normalizedData,
          validation_errors: row.errors,
          validation_warnings: row.warnings,
          status: row.errors.length > 0 ? "error" : "valid",
        }))
        const { error } = await supabase.from("crm_import_rows").insert(chunk)
        if (error) throw new Error(error.message)
      }
    } catch (error) {
      await supabase.from("crm_import_batches").delete().eq("id", batch.id)
      throw error
    }

    return NextResponse.json({
      ok: true,
      batchId: batch.id,
      totalRows: parsed.totalRows,
      validRows: parsed.validRows,
      errorRows: parsed.errorRows,
      warningRows,
      wonRows,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "CSV import failed." },
      { status: 400 },
    )
  }
}

async function stageDealLedgerImport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  file: File,
) {
  const name = file.name.toLowerCase()
  if (name.endsWith(".xls") && !name.endsWith(".xlsx") && !name.endsWith(".xlsm")) {
    return NextResponse.json(
      { error: "Save the workbook as .xlsx, not the older .xls format." },
      { status: 400 },
    )
  }
  if (!name.endsWith(".csv") && !name.endsWith(".xlsx") && !name.endsWith(".xlsm")) {
    return NextResponse.json(
      { error: "Upload the Excel workbook (.xlsx) or a CSV export of the sales ledger." },
      { status: 400 },
    )
  }

  let parsed: ParsedDealLedger
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    const { parseDealLedgerXlsx } = await import("@/lib/crm/imports/deal-ledger-xlsx")
    parsed = await parseDealLedgerXlsx(Buffer.from(await file.arrayBuffer()))
  } else {
    parsed = parseDealLedgerCsv(await file.text())
  }

  const catalog = await loadDealLedgerCatalog(supabase)
  parsed = matchDealLedgerRows(parsed, catalog)
  const warningRows = parsed.rows.filter((row) => row.warnings.length > 0).length
  const matchedRows = parsed.rows.filter((row) => row.dealId && row.errors.length === 0).length

  const { data: batch, error: batchError } = await supabase
    .from("crm_import_batches")
    .insert({
      import_type: "deal_ledger",
      source_system: "sales_ledger",
      file_name: file.name.slice(0, 255),
      status: "validated",
      total_rows: parsed.totalRows,
      valid_rows: parsed.validRows,
      error_rows: parsed.errorRows,
      headers: parsed.headers,
      summary: {
        warning_rows: warningRows,
        matched_rows: matchedRows,
        stock_will_change: false,
        creates_deals: false,
      },
      created_by: userId,
    })
    .select("id")
    .single()
  if (batchError || !batch) {
    throw new Error(batchError?.message ?? "Could not create import batch.")
  }

  try {
    for (let i = 0; i < parsed.rows.length; i += INSERT_CHUNK_SIZE) {
      const chunk = parsed.rows.slice(i, i + INSERT_CHUNK_SIZE).map((row) => ({
        batch_id: batch.id,
        row_number: row.rowNumber,
        source_external_id: row.dealReference,
        raw_data: row.rawData,
        normalized_data: dealLedgerNormalizedData(row),
        validation_errors: row.errors,
        validation_warnings: row.warnings,
        status: row.errors.length > 0 ? "error" : "valid",
      }))
      const { error } = await supabase.from("crm_import_rows").insert(chunk)
      if (error) throw new Error(error.message)
    }
  } catch (error) {
    await supabase.from("crm_import_batches").delete().eq("id", batch.id)
    throw error
  }

  return NextResponse.json({
    ok: true,
    batchId: batch.id,
    totalRows: parsed.totalRows,
    validRows: parsed.validRows,
    errorRows: parsed.errorRows,
    warningRows,
    matchedRows,
  })
}

