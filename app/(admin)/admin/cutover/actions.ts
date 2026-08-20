"use server"

import { revalidatePath } from "next/cache"
import { setPackageOpeningBalance } from "@/app/(admin)/actions"
import { requireAdmin } from "@/lib/admin/require-admin"
import { createClient } from "@/lib/supabase/server"

type Result = { ok: true; message: string; runId?: string } | { ok: false; message: string }

async function adminGate() {
  const profile = await requireAdmin()
  if (profile.role !== "admin") return null
  return { profile, supabase: await createClient() }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected cutover error."
}

export async function createCutoverBaseline(input: {
  name: string
  pilotRaceId?: string
  notes?: string
}): Promise<Result> {
  const gate = await adminGate()
  if (!gate) return { ok: false, message: "Admin permission is required." }
  try {
    const { data, error } = await gate.supabase.rpc("admin_create_cutover_baseline", {
      p_name: input.name,
      p_pilot_race_id: input.pilotRaceId || null,
      p_notes: input.notes || null,
    })
    if (error) throw new Error(error.message)
    revalidatePath("/admin/cutover")
    return { ok: true, message: "Cutover baseline captured.", runId: String(data) }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

export async function prepareCutoverOpenDeal(input: {
  runId: string
  dealId: string
  holdDays?: number
}): Promise<Result> {
  const gate = await adminGate()
  if (!gate) return { ok: false, message: "Admin permission is required." }
  try {
    const { error } = await gate.supabase.rpc("admin_prepare_cutover_open_deal", {
      p_run_id: input.runId,
      p_deal_id: input.dealId,
      p_hold_days: input.holdDays ?? 30,
    })
    if (error) throw new Error(error.message)
    revalidatePath("/admin/cutover")
    revalidatePath("/admin/deals")
    return { ok: true, message: "Open deal reserved for the native parallel run." }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

export async function decideWonReconciliation(input: {
  runId: string
  dealId: string
  status: "reconciled" | "ignored" | "blocked"
  reason: string
}): Promise<Result> {
  const gate = await adminGate()
  if (!gate) return { ok: false, message: "Admin permission is required." }
  try {
    const { error } = await gate.supabase.rpc("admin_decide_cutover_reconciliation", {
      p_run_id: input.runId,
      p_deal_id: input.dealId,
      p_status: input.status,
      p_reason: input.reason,
    })
    if (error) throw new Error(error.message)
    revalidatePath("/admin/cutover")
    return { ok: true, message: `Historical won deal marked ${input.status}.` }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

export async function updateCutoverPackage(input: {
  runId: string
  packageId: string
  openingBalanceStatus: string
  supplierStatus: string
  note: string
}): Promise<Result> {
  const gate = await adminGate()
  if (!gate) return { ok: false, message: "Admin permission is required." }
  try {
    const { error } = await gate.supabase.rpc("admin_update_cutover_package", {
      p_run_id: input.runId,
      p_package_id: input.packageId,
      p_opening_balance_status: input.openingBalanceStatus,
      p_supplier_status: input.supplierStatus,
      p_note: input.note,
    })
    if (error) throw new Error(error.message)
    revalidatePath("/admin/cutover")
    return { ok: true, message: "Package reconciliation updated." }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

export async function setCutoverOpeningBalance(input: {
  runId: string
  packageId: string
  quantity: number
  supplierStatus: string
  reason: string
}): Promise<Result> {
  const gate = await adminGate()
  if (!gate) return { ok: false, message: "Admin permission is required." }
  const { data: run } = await gate.supabase
    .from("cutover_runs")
    .select("status")
    .eq("id", input.runId)
    .maybeSingle()
  if (!run || ["approved", "cancelled", "rolled_back"].includes(String(run.status))) {
    return { ok: false, message: "This cutover run is locked." }
  }
  const result = await setPackageOpeningBalance({
    packageId: input.packageId,
    verifiedQty: input.quantity,
    reason: input.reason,
  })
  if (!result.ok) return result
  return updateCutoverPackage({
    runId: input.runId,
    packageId: input.packageId,
    openingBalanceStatus: "verified",
    supplierStatus: input.supplierStatus,
    note: input.reason,
  })
}

export async function setCutoverStatus(input: {
  runId: string
  status: string
  note?: string
}): Promise<Result> {
  const gate = await adminGate()
  if (!gate) return { ok: false, message: "Admin permission is required." }
  try {
    const { error } = await gate.supabase.rpc("admin_set_cutover_status", {
      p_run_id: input.runId,
      p_status: input.status,
      p_note: input.note || null,
    })
    if (error) throw new Error(error.message)
    revalidatePath("/admin/cutover")
    return { ok: true, message: `Cutover status changed to ${input.status.replaceAll("_", " ")}.` }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

export async function setCutoverPilotRace(input: {
  runId: string
  raceId: string
}): Promise<Result> {
  const gate = await adminGate()
  if (!gate) return { ok: false, message: "Admin permission is required." }
  try {
    const { error } = await gate.supabase.rpc("admin_set_cutover_pilot_race", {
      p_run_id: input.runId,
      p_race_id: input.raceId,
    })
    if (error) throw new Error(error.message)
    revalidatePath("/admin/cutover")
    return { ok: true, message: "Pilot event selected." }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

export async function rollbackCutoverRun(input: {
  runId: string
  reason: string
}): Promise<Result> {
  const gate = await adminGate()
  if (!gate) return { ok: false, message: "Admin permission is required." }
  try {
    const { data, error } = await gate.supabase.rpc("admin_rollback_cutover_run", {
      p_run_id: input.runId,
      p_reason: input.reason,
    })
    if (error) throw new Error(error.message)
    revalidatePath("/admin/cutover")
    revalidatePath("/admin/deals")
    return {
      ok: true,
      message: `Cutover preparation rolled back; ${Number(data ?? 0)} created reservation(s) released.`,
    }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

