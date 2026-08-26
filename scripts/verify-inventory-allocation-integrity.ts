import dotenv from "dotenv"
import { createAdminClient } from "../lib/supabase/admin"

dotenv.config({ path: ".env.local" })

type Layer = {
  id: string
  package_id: string
  source_package_id: string | null
  source_package_origin: string
  quantity: number
  quantity_remaining: number
  unit_cost: number
  currency: string
}
type Allocation = {
  id: string
  package_id: string
  cost_layer_id: string | null
  order_cost_consumption_id: string | null
  quantity: number
  state: string
  effective_unit_cost_snapshot: number | null
  cost_currency_snapshot: string | null
}
type DayComponent = {
  id: string
  cost_layer_id: string | null
  day_slot: string
  units_per_package: number
  quantity_total: number
  quantity_remaining: number
  cost_weight: number
  unit_cost_component: number | null
  currency: string
}
type AllocationDayComponent = {
  allocation_id: string
  cost_layer_day_component_id: string
  day_slot: string
  requested_units: number
  consumed_units: number
}
type Consumption = {
  id: string
  cost_layer_id: string | null
  quantity: number
  unit_cost: number | null
  currency: string
}

async function main() {
  const admin = createAdminClient()
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.")

  const [
    layersResult,
    allocationsResult,
    dayComponentsResult,
    allocationDayComponentsResult,
    consumptionsResult,
    shortagesResult,
    availabilityResult,
    policiesResult,
    restatementsResult,
    previewResult,
  ] =
    await Promise.all([
      admin
        .from("package_cost_layers")
        .select(
          "id, package_id, source_package_id, source_package_origin, quantity, quantity_remaining, unit_cost, currency",
        ),
      admin
        .from("inventory_allocations")
        .select(
          "id, package_id, cost_layer_id, order_cost_consumption_id, quantity, state, effective_unit_cost_snapshot, cost_currency_snapshot",
        )
        .in("state", ["reserved", "committed"]),
      admin
        .from("package_cost_layer_day_components")
        .select(
          "id, cost_layer_id, day_slot, units_per_package, quantity_total, quantity_remaining, cost_weight, unit_cost_component, currency",
        ),
      admin
        .from("inventory_allocation_day_components")
        .select(
          "allocation_id, cost_layer_day_component_id, day_slot, requested_units, consumed_units",
        ),
      admin
        .from("order_cost_consumptions")
        .select("id, cost_layer_id, quantity, unit_cost, currency"),
      admin
        .from("inventory_shortages")
        .select("shortage_type, quantity")
        .eq("status", "open"),
      admin
        .from("inventory_availability")
        .select(
          "package_id, layer_original_quantity, layer_quantity_remaining, reserved_quantity, manual_hold_quantity, committed_quantity, available_quantity, historical_shortage_quantity, brokered_shortage_quantity",
        )
        .limit(1),
      admin
        .from("inventory_group_cost_policies")
        .select("inventory_group_id, setup_required, setup_reason"),
      admin
        .from("inventory_cost_restatement_events")
        .select("id", { count: "exact", head: true }),
      admin.rpc("inventory_reconcile_historical_inventory", {
        p_apply: false,
        p_idempotency_key: null,
        p_limit: 25,
      }),
    ])

  for (const result of [
    layersResult,
    allocationsResult,
    dayComponentsResult,
    allocationDayComponentsResult,
    consumptionsResult,
    shortagesResult,
    availabilityResult,
    policiesResult,
    restatementsResult,
  ]) {
    if (result.error) throw new Error(result.error.message)
  }
  if (previewResult.error) throw new Error(previewResult.error.message)

  const layers = (layersResult.data ?? []) as Layer[]
  const allocations = (allocationsResult.data ?? []) as Allocation[]
  const dayComponents = (dayComponentsResult.data ?? []) as DayComponent[]
  const allocationDayComponents =
    (allocationDayComponentsResult.data ?? []) as AllocationDayComponent[]
  const consumptions = (consumptionsResult.data ?? []) as Consumption[]
  const layerById = new Map(layers.map((layer) => [layer.id, layer]))
  const allocationById = new Map(allocations.map((allocation) => [allocation.id, allocation]))
  const consumptionById = new Map(consumptions.map((consumption) => [consumption.id, consumption]))
  const dayComponentById = new Map(dayComponents.map((component) => [component.id, component]))
  const allocationComponentsByAllocation = new Map<string, AllocationDayComponent[]>()
  for (const component of allocationDayComponents) {
    const rows = allocationComponentsByAllocation.get(component.allocation_id) ?? []
    rows.push(component)
    allocationComponentsByAllocation.set(component.allocation_id, rows)
  }

  const violations: string[] = []
  for (const component of dayComponents) {
    if (!component.cost_layer_id) continue
    const related = allocationDayComponents.filter(
      (row) => row.cost_layer_day_component_id === component.id,
    )
    const reserved = related
      .filter((row) => allocationById.get(row.allocation_id)?.state === "reserved")
      .reduce((sum, row) => sum + Number(row.requested_units), 0)
    const committed = related
      .filter((row) => allocationById.get(row.allocation_id)?.state === "committed")
      .reduce((sum, row) => sum + Number(row.consumed_units), 0)
    const expectedRemaining = Number(component.quantity_total) - committed
    if (Number(component.quantity_remaining) !== expectedRemaining) {
      violations.push(
        `${component.cost_layer_id}/${component.day_slot}: remaining ${component.quantity_remaining} does not equal ${component.quantity_total} total - ${committed} committed`,
      )
    }
    if (reserved > Number(component.quantity_remaining)) {
      violations.push(
        `${component.cost_layer_id}/${component.day_slot}: ${reserved} reserved exceeds ${component.quantity_remaining} remaining`,
      )
    }
  }

  for (const layer of layers) {
    const components = dayComponents.filter((component) => component.cost_layer_id === layer.id)
    if (components.length === 0) {
      violations.push(`${layer.id}: physical layer has no frozen day components`)
      continue
    }
    const errors: string[] = []
    const weightTotal = components.reduce((sum, component) => sum + Number(component.cost_weight), 0)
    if (Math.abs(weightTotal - 1) > 0.000001) {
      errors.push(`${layer.id}: frozen day weights total ${weightTotal}, not 1`)
    }
    if (components.every((component) => component.unit_cost_component != null)) {
      const componentCost = components.reduce(
        (sum, component) => sum + Number(component.unit_cost_component),
        0,
      )
      if (Math.abs(componentCost - Number(layer.unit_cost)) > 0.000001) {
        errors.push(
          `${layer.id}: frozen component cost ${componentCost} does not equal purchase cost ${layer.unit_cost}`,
        )
      }
    }
    violations.push(...errors)
  }

  for (const allocation of allocations) {
    if (!allocation.cost_layer_id || !layerById.has(allocation.cost_layer_id)) {
      violations.push(`${allocation.id}: active allocation has no physical cost layer`)
      continue
    }
    const components = allocationComponentsByAllocation.get(allocation.id) ?? []
    if (components.length === 0) {
      violations.push(`${allocation.id}: active allocation has no day-component audit rows`)
    }
    for (const component of components) {
      if (!dayComponentById.has(component.cost_layer_day_component_id)) {
        violations.push(`${allocation.id}/${component.day_slot}: component snapshot target is missing`)
      }
      if (Number(component.requested_units) <= 0) {
        violations.push(`${allocation.id}/${component.day_slot}: requested units are not positive`)
      }
    }
    if (allocation.state !== "committed" || !allocation.order_cost_consumption_id) continue
    const consumption = consumptionById.get(allocation.order_cost_consumption_id)
    if (!consumption) {
      violations.push(`${allocation.order_cost_consumption_id}: committed allocation has no COGS row`)
      continue
    }
    if (
      consumption.cost_layer_id !== allocation.cost_layer_id ||
      Number(consumption.quantity) !== Number(allocation.quantity)
    ) {
      violations.push(`${consumption.id}: allocation quantity/layer does not match COGS`)
    }
    if (
      Number(consumption.unit_cost ?? 0) !==
      Number(allocation.effective_unit_cost_snapshot ?? 0)
    ) {
      violations.push(`${consumption.id}: COGS does not match frozen effective day cost`)
    }
    if (
      allocation.cost_currency_snapshot &&
      consumption.currency !== allocation.cost_currency_snapshot
    ) {
      violations.push(`${consumption.id}: COGS currency does not match allocation snapshot`)
    }
  }

  const shortages = shortagesResult.data ?? []
  const shortageTotal = shortages.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0)
  const historical = shortages
    .filter((row) => row.shortage_type === "historical_reconciliation")
    .reduce((sum, row) => sum + Number(row.quantity ?? 0), 0)
  const brokered = shortageTotal - historical
  const preview = (previewResult.data ?? {}) as Record<string, unknown>
  const policies = (policiesResult.data ?? []) as Array<{
    inventory_group_id: string
    setup_required: boolean
    setup_reason: string | null
  }>
  const ambiguousLayers = layers.filter(
    (layer) => layer.source_package_origin === "ambiguous_shared_ledger",
  )
  const setupRequiredPolicies = policies.filter((policy) => policy.setup_required)

  console.log(
    JSON.stringify(
      {
        layers: layers.length,
        activeAllocations: allocations.length,
        dayComponents: dayComponents.length,
        allocationDayComponents: allocationDayComponents.length,
        cogsRows: consumptions.length,
        costRestatementEvents: restatementsResult.count ?? 0,
        ambiguousHistoricalLayers: ambiguousLayers.map((layer) => ({
          layerId: layer.id,
          ledgerPackageId: layer.package_id,
          sourcePackageId: layer.source_package_id,
        })),
        setupRequiredGroups: setupRequiredPolicies,
        availabilityRows: availabilityResult.data?.length ?? 0,
        openShortageQuantity: shortageTotal,
        historicalShortageQuantity: historical,
        brokeredShortageQuantity: brokered,
        pendingHistoricalPreview: {
          deals: Number(preview.deal_count ?? 0),
          allocatable: Number(preview.allocated_quantity ?? 0),
          shortage: Number(preview.shortage_quantity ?? 0),
        },
        violations,
      },
      null,
      2,
    ),
  )
  if (violations.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
