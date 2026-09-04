import type { SupabaseClient } from "@supabase/supabase-js"
import { mergeDealLedgerNotes, planDealLedgerStageUpdate } from "@/lib/crm/imports/deal-ledger"
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows"

type ImportRow = {
  id: string
  row_number: number
  raw_data: Record<string, string>
  normalized_data: Record<string, string | number | boolean | null>
  validation_errors: string[]
  validation_warnings: string[]
  status: string
}

function text(value: unknown): string | null {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed ? trimmed : null
}

function paymentStatusOf(
  value: unknown,
): "paid" | "unpaid" | "cancelled" | null {
  if (value === "paid" || value === "unpaid" || value === "cancelled") return value
  return null
}

export async function applyDealLedgerImportBatch(input: {
  supabase: SupabaseClient
  batchId: string
  actorId: string
}): Promise<{ applied: number; skipped: number; failed: number }> {
  const { data: batch, error: batchError } = await input.supabase
    .from("crm_import_batches")
    .select("id, import_type, status")
    .eq("id", input.batchId)
    .maybeSingle()
  if (batchError) throw new Error(batchError.message)
  if (!batch) throw new Error("Import batch was not found.")
  if (batch.import_type !== "deal_ledger") {
    throw new Error("This apply path is only for sales-ledger uploads.")
  }
  if (batch.status === "applied") {
    return { applied: 0, skipped: 0, failed: 0 }
  }

  const { error: lockError } = await input.supabase
    .from("crm_import_batches")
    .update({ status: "applying" })
    .eq("id", input.batchId)
  if (lockError) throw new Error(lockError.message)

  const { data: rows, error: rowsError } = await fetchAllRows<ImportRow>((from, to) =>
    input.supabase
      .from("crm_import_rows")
      .select("id, row_number, raw_data, normalized_data, validation_errors, validation_warnings, status")
      .eq("batch_id", input.batchId)
      .order("row_number")
      .range(from, to),
  )
  if (rowsError) throw new Error(rowsError.message)

  let applied = 0
  let skipped = 0
  let failed = 0

  try {
    for (const row of rows) {
      if (row.status === "error") {
        skipped += 1
        continue
      }
      if (row.status === "applied") {
        applied += 1
        continue
      }

      const normalized = row.normalized_data ?? {}
      const dealId = text(normalized.dealId)
      if (!dealId) {
        failed += 1
        await markRow(input.supabase, row.id, {
          status: "failed",
          applyError: "No matched deal was stored for this row.",
        })
        continue
      }

      try {
        await applyOneRow(input.supabase, input.actorId, dealId, normalized)
        applied += 1
        await markRow(input.supabase, row.id, {
          status: "applied",
          targetTable: "deals",
          targetId: dealId,
          applyError: null,
        })
      } catch (error) {
        failed += 1
        await markRow(input.supabase, row.id, {
          status: "failed",
          applyError: error instanceof Error ? error.message : "Could not update this deal.",
        })
      }
    }

    const { error: doneError } = await input.supabase
      .from("crm_import_batches")
      .update({
        status: failed > 0 ? "applied_with_errors" : "applied",
        applied_rows: applied,
        skipped_rows: skipped,
        failed_rows: failed,
        applied_at: new Date().toISOString(),
      })
      .eq("id", input.batchId)
    if (doneError) throw new Error(doneError.message)
    return { applied, skipped, failed }
  } catch (error) {
    await input.supabase
      .from("crm_import_batches")
      .update({ status: "failed" })
      .eq("id", input.batchId)
    throw error
  }
}

async function applyOneRow(
  supabase: SupabaseClient,
  actorId: string,
  dealId: string,
  normalized: Record<string, string | number | boolean | null>,
) {
  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .select("id, stage, expected_close_date, order_id, notes")
    .eq("id", dealId)
    .maybeSingle()
  if (dealError) throw new Error(dealError.message)
  if (!deal) throw new Error("Matched deal no longer exists.")

  const paymentStatus = paymentStatusOf(normalized.paymentStatus)
  const plan = planDealLedgerStageUpdate({
    currentStage: String(deal.stage),
    paymentStatus,
  })

  if (plan.action === "mark_paid") {
    const { error } = await supabase.rpc("admin_mark_finance_paid", {
      p_invoice_id: null,
      p_deal_id: dealId,
    })
    if (error) throw new Error(error.message)
  } else if (plan.action === "mark_unpaid") {
    const { error } = await supabase.rpc("admin_mark_finance_unpaid", {
      p_invoice_id: null,
      p_deal_id: dealId,
    })
    if (error) throw new Error(error.message)
  } else if (plan.action === "mark_cancelled") {
    const { error } = await supabase
      .from("deals")
      .update({
        stage: "cancelled",
        closed_at: new Date().toISOString(),
        next_action: "No action — closed",
        next_action_due_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", dealId)
    if (error) throw new Error(error.message)
  }

  const dealDate = text(normalized.dealDate)
  const invoiceNumber = text(normalized.invoiceNumber)
  const note = text(normalized.note)
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (dealDate) patch.expected_close_date = dealDate
  if (invoiceNumber) patch.ledger_invoice_number = invoiceNumber
  if (paymentStatus) patch.ledger_payment_status = paymentStatus
  if (note) patch.notes = mergeDealLedgerNotes(deal.notes, note)

  const { error: updateError } = await supabase.from("deals").update(patch).eq("id", dealId)
  if (updateError) throw new Error(updateError.message)

  if (plan.action === "mark_paid" && text(normalized.paymentDate) && deal.order_id) {
    await supabase
      .from("invoices")
      .update({ paid_at: `${text(normalized.paymentDate)}T12:00:00.000Z` })
      .eq("order_id", deal.order_id)
      .eq("status", "paid")
  }

  const summary = [
    "Sales ledger import",
    dealDate ? `deal date ${dealDate}` : null,
    paymentStatus ? `spreadsheet status ${paymentStatus}` : null,
    invoiceNumber ? `invoice ${invoiceNumber}` : null,
    note ? "finance notes added" : null,
  ]
    .filter(Boolean)
    .join(" · ")

  await supabase.from("deal_activities").insert({
    deal_id: dealId,
    actor_profile_id: actorId,
    action: "sales_ledger_import",
    summary,
    metadata: {
      invoiceNumber,
      paymentStatus,
      dealDate,
      stageAction: plan.action,
      note,
    },
  })
}

async function markRow(
  supabase: SupabaseClient,
  rowId: string,
  input: {
    status: string
    applyError: string | null
    targetTable?: string | null
    targetId?: string | null
  },
) {
  const { error } = await supabase
    .from("crm_import_rows")
    .update({
      status: input.status,
      apply_error: input.applyError,
      target_table: input.targetTable ?? null,
      target_id: input.targetId ?? null,
      applied_at: new Date().toISOString(),
    })
    .eq("id", rowId)
  if (error) throw new Error(error.message)
}
