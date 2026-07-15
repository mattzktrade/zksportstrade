import type { SupabaseClient } from "@supabase/supabase-js"
import type { Package } from "@/lib/types/catalog"

type PackageMeta = {
  id: string
  inventory_group_id?: string | null
  duration?: string | null
  shell_parent_package_id?: string | null
}

type LayerRow = {
  id: string
  package_id: string
  quantity_remaining: number | null
  fulfilment_block_id: string | null
  purchase_order_id: string | null
  source: string | null
}

/** Max remaining in one fulfilment block, purchase order, or supplier source. */
export function largestSameSuiteRemainingFromLayers(
  layers: Array<{
    id: string
    quantity_remaining: number | null
    fulfilment_block_id?: string | null
    purchase_order_id?: string | null
    source?: string | null
  }>,
): number {
  const byKey = new Map<string, number>()
  for (const layer of layers) {
    const rem = Math.max(0, Math.floor(Number(layer.quantity_remaining) || 0))
    if (rem <= 0) continue
    const block = layer.fulfilment_block_id?.trim()
    const po = layer.purchase_order_id?.trim()
    const source = layer.source?.trim()
    const key = block
      ? `block:${block}`
      : po
        ? `po:${po}`
        : source
          ? `src:${source.toLowerCase()}`
          : `layer:${layer.id}`
    byKey.set(key, (byKey.get(key) ?? 0) + rem)
  }
  if (byKey.size === 0) return 0
  return Math.max(...byKey.values())
}

function resolveLedgerPackageId(
  packageId: string,
  metaById: Map<string, PackageMeta>,
  remainingByPackage: Map<string, number>,
): string {
  const meta = metaById.get(packageId)
  const own = remainingByPackage.get(packageId) ?? 0
  if (own > 0 || !meta?.inventory_group_id?.trim()) return packageId

  for (const row of metaById.values()) {
    if (
      row.inventory_group_id === meta.inventory_group_id &&
      row.duration === "3_day" &&
      !row.shell_parent_package_id
    ) {
      return row.id
    }
  }
  return packageId
}

/**
 * Attach largestSameSuiteRemaining for portal/agent booking UIs.
 * Day packages without their own cost layers inherit the linked 3-day ledger.
 */
export async function attachLargestSameSuiteRemaining(
  supabase: SupabaseClient,
  packages: Package[],
  packageMeta: PackageMeta[],
): Promise<Package[]> {
  if (packages.length === 0) return packages

  const metaById = new Map(packageMeta.map((p) => [p.id, p]))
  const packageIds = [...new Set(packageMeta.map((p) => p.id))]
  const groupIds = [
    ...new Set(packageMeta.map((p) => p.inventory_group_id?.trim()).filter(Boolean) as string[]),
  ]

  // Include 3-day siblings so day packages can read the shared purchase ledger.
  if (groupIds.length > 0) {
    const { data: siblings } = await supabase
      .from("packages")
      .select("id, inventory_group_id, duration, shell_parent_package_id")
      .in("inventory_group_id", groupIds)
    for (const row of (siblings ?? []) as PackageMeta[]) {
      if (!metaById.has(row.id)) metaById.set(row.id, row)
      if (!packageIds.includes(row.id)) packageIds.push(row.id)
    }
  }

  const { data: layers } = await supabase
    .from("package_cost_layers")
    .select("id, package_id, quantity_remaining, fulfilment_block_id, purchase_order_id, source")
    .in("package_id", packageIds)
    .gt("quantity_remaining", 0)

  const layersByPackage = new Map<string, LayerRow[]>()
  const remainingByPackage = new Map<string, number>()
  for (const row of (layers ?? []) as LayerRow[]) {
    const list = layersByPackage.get(row.package_id) ?? []
    list.push(row)
    layersByPackage.set(row.package_id, list)
    remainingByPackage.set(
      row.package_id,
      (remainingByPackage.get(row.package_id) ?? 0) +
        Math.max(0, Math.floor(Number(row.quantity_remaining) || 0)),
    )
  }

  const largestByLedger = new Map<string, number>()
  for (const [pkgId, pkgLayers] of layersByPackage) {
    largestByLedger.set(pkgId, largestSameSuiteRemainingFromLayers(pkgLayers))
  }

  return packages.map((pkg) => {
    const ledgerId = resolveLedgerPackageId(pkg.id, metaById, remainingByPackage)
    const largest = largestByLedger.get(ledgerId) ?? 0
    return {
      ...pkg,
      largestSameSuiteRemaining: largest > 0 ? largest : null,
    }
  })
}

/** Largest single-block / supplier remaining for one package (linked day → 3-day ledger). */
export async function largestSameSuiteRemainingForPackage(
  supabase: SupabaseClient,
  packageId: string,
): Promise<number> {
  const id = packageId.trim()
  if (!id) return 0
  const { data: meta } = await supabase
    .from("packages")
    .select("id, inventory_group_id, duration, shell_parent_package_id")
    .eq("id", id)
    .maybeSingle()
  if (!meta) return 0
  const stub: Package = {
    id,
    name: "",
    circuit: "",
    location: "",
    country: "",
    countryCode: "",
    date: "",
    dateRange: "",
    price: null,
    currency: "USD",
    availability: 0,
    totalCapacity: 0,
    image: "",
    tier: "paddock",
    includes: [],
  }
  const [row] = await attachLargestSameSuiteRemaining(supabase, [stub], [
    meta as PackageMeta,
  ])
  return Math.max(0, Math.floor(Number(row.largestSameSuiteRemaining) || 0))
}
