import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getNativePackageAvailability } from "@/lib/inventory/ledger"

export type CutoverRun = {
  id: string
  name: string
  status: string
  pilotRaceId: string | null
  pilotRaceName: string | null
  baselineAt: string | null
  baselineMetrics: Record<string, number>
  notes: string | null
  rollbackNotes: string | null
  createdAt: string
  approvedAt: string | null
}

export type CutoverPackageRow = {
  id: string
  packageId: string
  raceId: string
  packageName: string
  baselineAvailable: number
  currentAvailable: number
  availableDrift: number
  baselineHeld: number
  currentHeld: number
  heldDrift: number
  baselineSellable: number
  currentSellable: number
  sellableDrift: number
  currentLayerUnits: number
  activeReservations: number
  openShortages: number
  unassignedCostUnits: number
  openingBalanceStatus: string
  supplierStatus: string
  note: string | null
}

export type CutoverDealRow = {
  id: string
  dealId: string
  reference: string
  accountName: string
  stage: string
  type: "open_pipeline" | "historical_won"
  status: string
  expectedQuantity: number
  reservedQuantity: number
  reason: string | null
}

export type CutoverEventRow = {
  id: string
  eventType: string
  summary: string
  actorName: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

export async function getCutoverWorkspace(selectedRunId?: string | null): Promise<{
  runs: CutoverRun[]
  selectedRun: CutoverRun | null
  packages: CutoverPackageRow[]
  deals: CutoverDealRow[]
  events: CutoverEventRow[]
  races: Array<{ id: string; name: string }>
}> {
  noStore()
  const supabase = await createClient()
  const [{ data: runRows }, { data: races }] = await Promise.all([
    supabase
      .from("cutover_runs")
      .select(
        "id, name, status, pilot_race_id, baseline_at, baseline_metrics, notes, rollback_notes, created_at, approved_at, races(name)",
      )
      .order("created_at", { ascending: false }),
    supabase.from("races").select("id, name").eq("is_archived", false).order("name"),
  ])
  const runs: CutoverRun[] = (runRows ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    status: String(row.status),
    pilotRaceId: row.pilot_race_id,
    pilotRaceName:
      one(row.races as unknown as Array<{ name: string }> | null)?.name ?? null,
    baselineAt: row.baseline_at,
    baselineMetrics: (row.baseline_metrics ?? {}) as Record<string, number>,
    notes: row.notes,
    rollbackNotes: row.rollback_notes,
    createdAt: String(row.created_at),
    approvedAt: row.approved_at,
  }))
  const selectedRun =
    runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null
  if (!selectedRun) {
    return {
      runs,
      selectedRun: null,
      packages: [],
      deals: [],
      events: [],
      races: (races ?? []).map((race) => ({ id: String(race.id), name: String(race.name) })),
    }
  }

  const [{ data: packageRows }, { data: dealRows }, { data: eventRows }, currentAvailability] =
    await Promise.all([
      supabase
        .from("cutover_package_snapshots")
        .select("*")
        .eq("run_id", selectedRun.id)
        .order("package_name"),
      supabase
        .from("cutover_deal_reconciliations")
        .select(
          "id, deal_id, reconciliation_type, status, expected_quantity, reserved_quantity, reason, deals(reference, stage, crm_accounts(name))",
        )
        .eq("run_id", selectedRun.id)
        .order("created_at"),
      supabase
        .from("cutover_events")
        .select("id, event_type, summary, metadata, created_at, profiles(full_name)")
        .eq("run_id", selectedRun.id)
        .order("created_at", { ascending: false })
        .limit(200),
      getNativePackageAvailability(),
    ])
  const availability = new Map(currentAvailability.map((row) => [row.package_id, row]))

  return {
    runs,
    selectedRun,
    races: (races ?? []).map((race) => ({ id: String(race.id), name: String(race.name) })),
    packages: (packageRows ?? []).map((row) => {
      const current = availability.get(String(row.package_id))
      const currentAvailable = Number(current?.qty_available ?? 0)
      const currentHeld = Number(current?.qty_held ?? 0)
      const currentSellable = Number(current?.legacy_sellable ?? 0)
      return {
        id: String(row.id),
        packageId: String(row.package_id),
        raceId: String(row.race_id),
        packageName: String(row.package_name),
        baselineAvailable: Number(row.baseline_qty_available),
        currentAvailable,
        availableDrift: currentAvailable - Number(row.baseline_qty_available),
        baselineHeld: Number(row.baseline_qty_held),
        currentHeld,
        heldDrift: currentHeld - Number(row.baseline_qty_held),
        baselineSellable: Number(row.baseline_sellable),
        currentSellable,
        sellableDrift: currentSellable - Number(row.baseline_sellable),
        currentLayerUnits: Number(current?.layer_units_remaining ?? 0),
        activeReservations: Number(current?.active_reservations ?? 0),
        openShortages: Number(current?.open_shortage_qty ?? 0),
        unassignedCostUnits: Number(row.baseline_unassigned_cost_units),
        openingBalanceStatus: String(row.opening_balance_status),
        supplierStatus: String(row.supplier_reconciliation_status),
        note: row.reconciliation_note,
      }
    }),
    deals: (dealRows ?? []).map((row) => {
      const deal = one(
        row.deals as unknown as Array<{
          reference: string
          stage: string
          crm_accounts: { name: string } | { name: string }[] | null
        }> | null,
      )
      return {
        id: String(row.id),
        dealId: String(row.deal_id),
        reference: deal?.reference ?? String(row.deal_id),
        accountName: one(deal?.crm_accounts)?.name ?? "Unknown account",
        stage: deal?.stage ?? "unknown",
        type: row.reconciliation_type as "open_pipeline" | "historical_won",
        status: String(row.status),
        expectedQuantity: Number(row.expected_quantity),
        reservedQuantity: Number(row.reserved_quantity),
        reason: row.reason,
      }
    }),
    events: (eventRows ?? []).map((row) => ({
      id: String(row.id),
      eventType: String(row.event_type),
      summary: String(row.summary),
      actorName:
        one(row.profiles as unknown as Array<{ full_name: string }> | null)?.full_name ??
        null,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      createdAt: String(row.created_at),
    })),
  }
}

