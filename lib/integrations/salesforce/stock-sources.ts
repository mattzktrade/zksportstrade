import { createHash } from "crypto"
import { SupabaseClient } from "@supabase/supabase-js"
import { salesforceRequest, salesforceQuery, SalesforceApiError } from "@/lib/integrations/salesforce/client"
import { getSalesforceConfig } from "@/lib/integrations/salesforce/config"
import {
  computeProductQuantitySoldFromWonLines,
  readWonQuantityByProductBulk,
} from "@/lib/integrations/salesforce/sold-metrics"
import { readPortalOrderSoldForPackage } from "@/lib/inventory/local-sold"
import {
  allocateUnattributedSoldAcrossLayers,
  resolveSoldByCostLayer,
} from "@/lib/inventory/sold-by-cost-layer"
import { resolveLinkedStockLedger } from "@/lib/inventory/linked-stock-ledger"

export { allocateUnattributedSoldAcrossLayers, resolveSoldByCostLayer }

/**
 * Sync portal cost-layer groupings (per supplier + fulfilment block) to
 * Salesforce as `Stock_Source__c` child records under Product2.
 *
 * Linked Friday/Saturday/Sunday packages inherit the 3-day parent's cost ledger
 * (same as portal allocation) so Stock Sources appear on those Product2s too.
 *
 * The custom child object lives in the Salesforce org (set up by the admin) with
 * these fields (see docs/PHASE3_LISTING_SYNC.md):
 *   * Product__c            (Lookup Product2, required)
 *   * Supplier__c           (Text 100, required)
 *   * Fulfilment_Block__c   (Text 60, optional)
 *   * PO_Numbers__c         (Long Text 1000, optional)
 *   * Quantity_Purchased__c (Number 10,0, required)
 *   * Quantity_Sold__c      (Number 10,0, required)
 *   * Portal_Source_Ref__c  (Text 36, External ID, Unique, required)
 *   * Last_Portal_Sync__c   (Date/Time, optional)
 *   * PO_Documents__c       (Long Text 32768, optional)
 *
 * We upsert by `Portal_Source_Ref__c`, which is a deterministic hash of
 * `(package_id, supplier, fulfilment_block_id)`. Rows we manage always start
 * with the `zk-` prefix so any manually-created rows in Salesforce are left
 * untouched.
 *
 * Quantity_Sold__c is derived from:
 *   1. Portal order FIFO consumptions (and legacy quantity − remaining), plus
 *   2. Any remaining package sold units (Salesforce offline / closed-won pulls,
 *      Wix, trade portal) that reduced sellable but never wrote consumption rows,
 *      allocated FIFO across layers by received_at — same supplier stock those
 *      sales came from.
 *
 * Linked inventory groups are special: day / 2-day / 3-day Product2s all share the
 * 3-day cost ledger, but each Product2's Quantity_Sold__c is FIFO-allocated from
 * an attributed sold total:
 *   - 3-day → all linked non-shell sales (pool)
 *   - day   → 3-day sales + that day's sales only (Fri ignores Sunday)
 *   - 2-day → 3-day sales + 2-day sales
 * Pool-wide consumptions / quantity_remaining are ignored for that attribution.
 */

const SOURCE_REF_PREFIX = "zk-"
const SOURCE_OBJECT = "Stock_Source__c"

type LayerRow = {
  id: string
  package_id: string
  quantity: number
  quantity_remaining: number
  source: string | null
  purchase_order_id: string | null
  fulfilment_block_id: string | null
  received_at: string | null
}

type PurchaseOrderMini = {
  id: string
  po_number: string
  supplier: string
}

type PurchaseOrderDocMini = {
  purchase_order_id: string
  file_name: string
}

type BlockMini = {
  id: string
  name: string
}

type ConsumptionRow = {
  cost_layer_id: string | null
  quantity: number
}

export type StockSourceGroup = {
  supplier: string
  fulfilmentBlockName: string | null
  quantityPurchased: number
  quantitySold: number
  poNumbers: string[]
  poDocuments: string[]
  portalRef: string
}

export type StockSourceSyncResult = {
  upserted: number
  removed: number
  errors: string[]
  groups: number
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, Math.max(0, max - 1)) + "…"
}

function buildPortalRef(packageId: string, supplier: string, blockId: string | null): string {
  const key = `${packageId}::${supplier.toLowerCase().trim()}::${blockId ?? "none"}`
  const hash = createHash("sha256").update(key).digest("hex")
  return `${SOURCE_REF_PREFIX}${hash.slice(0, 32)}`
}

export function groupLayersIntoStockSources(input: {
  packageId: string
  layers: readonly LayerRow[]
  purchaseOrders: ReadonlyMap<string, PurchaseOrderMini>
  purchaseOrderDocsByPo: ReadonlyMap<string, string[]>
  blocks: ReadonlyMap<string, BlockMini>
  /** Sum of order_cost_consumptions.quantity per layer for non-cancelled orders. */
  consumptionsByLayer: ReadonlyMap<string, number>
  /**
   * Total places sold for this package (portal + Wix + Salesforce offline).
   * Used to attribute offline / non-order sales onto supplier stock FIFO.
   */
  totalPackageSold: number
}): StockSourceGroup[] {
  type Accum = {
    supplier: string
    fulfilmentBlockName: string | null
    fulfilmentBlockId: string | null
    quantityPurchased: number
    quantitySold: number
    poNumbers: Set<string>
    poDocuments: Set<string>
  }
  const groups = new Map<string, Accum>()

  const soldByLayer = resolveSoldByCostLayer({
    layers: input.layers,
    consumptionsByLayer: input.consumptionsByLayer,
    totalPackageSold: input.totalPackageSold,
  })

  for (const layer of input.layers) {
    const po = layer.purchase_order_id ? input.purchaseOrders.get(layer.purchase_order_id) : null
    const supplierRaw = po?.supplier?.trim() || layer.source?.trim() || "Unassigned"
    const supplier = supplierRaw.length > 0 ? supplierRaw : "Unassigned"
    const block = layer.fulfilment_block_id ? input.blocks.get(layer.fulfilment_block_id) : null
    const key = `${supplier.toLowerCase()}::${layer.fulfilment_block_id ?? "none"}`

    const g: Accum =
      groups.get(key) ?? {
        supplier,
        fulfilmentBlockName: block?.name ?? null,
        fulfilmentBlockId: layer.fulfilment_block_id ?? null,
        quantityPurchased: 0,
        quantitySold: 0,
        poNumbers: new Set<string>(),
        poDocuments: new Set<string>(),
      }

    const qty = Math.max(0, Math.floor(Number(layer.quantity) || 0))
    const sold = Math.max(0, Math.floor(soldByLayer.get(layer.id) ?? 0))

    g.quantityPurchased += qty
    g.quantitySold += sold
    if (po?.po_number) g.poNumbers.add(po.po_number)
    const docs = layer.purchase_order_id ? input.purchaseOrderDocsByPo.get(layer.purchase_order_id) : null
    if (docs) for (const d of docs) g.poDocuments.add(d)
    groups.set(key, g)
  }

  const out: StockSourceGroup[] = []
  for (const g of groups.values()) {
    const portalRef = buildPortalRef(input.packageId, g.supplier, g.fulfilmentBlockId)
    out.push({
      supplier: truncate(g.supplier, 100),
      fulfilmentBlockName: g.fulfilmentBlockName ? truncate(g.fulfilmentBlockName, 60) : null,
      quantityPurchased: g.quantityPurchased,
      quantitySold: g.quantitySold,
      poNumbers: Array.from(g.poNumbers),
      poDocuments: Array.from(g.poDocuments),
      portalRef,
    })
  }
  return out
}

type ExistingStockSource = {
  Id: string
  Portal_Source_Ref__c: string | null
}

async function readExistingPortalStockSources(product2Id: string): Promise<ExistingStockSource[]> {
  const rows = await salesforceQuery<ExistingStockSource>(
    `SELECT Id, Portal_Source_Ref__c FROM ${SOURCE_OBJECT} WHERE Product__c = '${product2Id.replace(/'/g, "\\'")}' AND Portal_Source_Ref__c LIKE '${SOURCE_REF_PREFIX}%'`,
  )
  return rows
}

const LINKED_DAY_DURATIONS = new Set([
  "thursday_only",
  "friday_only",
  "saturday_only",
  "sunday_only",
])

/**
 * How many shared-ledger units this Product2 should show as sold on Stock Sources:
 * - 3-day: every linked sale (pool total)
 * - day package: 3-day sales + that day's own sales only (Fri ignores Sunday sales)
 * - 2-day: 3-day sales + 2-day own sales
 */
export function computeLinkedStockSourceAttributedSold(input: {
  packageId: string
  duration: string
  siblings: readonly { id: string; duration: string | null; sold: number }[]
}): number {
  const soldById = new Map(input.siblings.map((r) => [r.id, Math.max(0, Math.floor(r.sold))]))
  const threeDay = input.siblings.find((r) => (r.duration ?? "").trim() === "3_day")
  const threeDaySold = threeDay ? soldById.get(threeDay.id) ?? 0 : 0
  const ownSold = soldById.get(input.packageId) ?? 0

  if (input.duration === "3_day") {
    return input.siblings.reduce((sum, r) => sum + (soldById.get(r.id) ?? 0), 0)
  }
  if (LINKED_DAY_DURATIONS.has(input.duration)) {
    return threeDaySold + ownSold
  }
  if (input.duration === "2_day") {
    return threeDaySold + ownSold
  }
  return ownSold
}

async function linkedStockSourceAttributedSold(
  admin: SupabaseClient,
  input: {
    packageId: string
    groupId: string
    duration: string
  },
): Promise<number> {
  const { data: siblings } = await admin
    .from("packages")
    .select("id, duration, salesforce_product_id")
    .eq("inventory_group_id", input.groupId)
    .is("shell_parent_package_id", null)

  const rows = (siblings ?? []) as Array<{
    id: string
    duration: string | null
    salesforce_product_id: string | null
  }>

  const product2Ids = rows
    .map((r) => r.salesforce_product_id?.trim() ?? "")
    .filter(Boolean)
  const config = getSalesforceConfig()
  const wonByProduct =
    config && product2Ids.length > 0
      ? await readWonQuantityByProductBulk(product2Ids, config.opportunityStageWon).catch(
          () => new Map<string, number>(),
        )
      : new Map<string, number>()

  const withSold = await Promise.all(
    rows.map(async (row) => {
      const portalOrders = await readPortalOrderSoldForPackage(admin, row.id).catch(() => 0)
      const product2Id = row.salesforce_product_id?.trim() ?? ""
      const sfWon = product2Id ? wonByProduct.get(product2Id) ?? 0 : 0
      // Live Closed Won + portal orders. Do not use offline applications — they go stale
      // after Closed Lost and would push Stock Source Quantity Sold back to full stock.
      const sold = Math.max(portalOrders, sfWon)
      return {
        id: row.id,
        duration: row.duration,
        sold,
      }
    }),
  )

  return computeLinkedStockSourceAttributedSold({
    packageId: input.packageId,
    duration: input.duration,
    siblings: withSold,
  })
}

async function loadStockSourceInputsForPackage(
  admin: SupabaseClient,
  packageId: string,
): Promise<{
  layers: LayerRow[]
  purchaseOrders: Map<string, PurchaseOrderMini>
  purchaseOrderDocsByPo: Map<string, string[]>
  blocks: Map<string, BlockMini>
  consumptionsByLayer: Map<string, number>
  totalPackageSold: number
}> {
  const { ledgerPackageId, usedParentLedger, duration, groupId, isShell } =
    await resolveLinkedStockLedger(admin, packageId)

  const { data: layerData, error: layerErr } = await admin
    .from("package_cost_layers")
    .select(
      "id, package_id, quantity, quantity_remaining, source, purchase_order_id, fulfilment_block_id, received_at",
    )
    .eq("package_id", ledgerPackageId)
  if (layerErr) throw new Error(layerErr.message)

  const layers = (layerData ?? []).map((r) => ({
    id: String(r.id),
    package_id: String(r.package_id),
    quantity: Math.max(0, Math.floor(Number(r.quantity) || 0)),
    quantity_remaining: Math.max(0, Math.floor(Number(r.quantity_remaining) || 0)),
    source: (r.source as string | null) ?? null,
    purchase_order_id: (r.purchase_order_id as string | null) ?? null,
    fulfilment_block_id: (r.fulfilment_block_id as string | null) ?? null,
    received_at: (r.received_at as string | null) ?? null,
  })) as LayerRow[]

  const poIds = Array.from(new Set(layers.map((l) => l.purchase_order_id).filter((x): x is string => !!x)))
  const blockIds = Array.from(new Set(layers.map((l) => l.fulfilment_block_id).filter((x): x is string => !!x)))
  const layerIds = layers.map((l) => l.id)

  const purchaseOrders = new Map<string, PurchaseOrderMini>()
  if (poIds.length > 0) {
    const { data: poData } = await admin
      .from("purchase_orders")
      .select("id, po_number, supplier")
      .in("id", poIds)
    for (const r of poData ?? []) {
      purchaseOrders.set(String(r.id), {
        id: String(r.id),
        po_number: String(r.po_number ?? ""),
        supplier: String(r.supplier ?? ""),
      })
    }
  }

  const purchaseOrderDocsByPo = new Map<string, string[]>()
  if (poIds.length > 0) {
    const { data: docData } = await admin
      .from("purchase_order_documents")
      .select("purchase_order_id, file_name")
      .in("purchase_order_id", poIds)
      .order("uploaded_at", { ascending: false })
    for (const r of (docData ?? []) as PurchaseOrderDocMini[]) {
      const list = purchaseOrderDocsByPo.get(r.purchase_order_id) ?? []
      const name = String(r.file_name ?? "").trim()
      if (name) list.push(name)
      purchaseOrderDocsByPo.set(r.purchase_order_id, list)
    }
  }

  const blocks = new Map<string, BlockMini>()
  if (blockIds.length > 0) {
    const { data: blockData } = await admin
      .from("fulfilment_blocks")
      .select("id, name")
      .in("id", blockIds)
    for (const r of blockData ?? []) {
      blocks.set(String(r.id), { id: String(r.id), name: String(r.name ?? "") })
    }
  }

  // Linked shared-ledger Stock Sources: FIFO-allocate the product-specific attributed sold
  // total. Do NOT use raw order_cost_consumptions (pool-wide) or quantity_remaining (also
  // pool-wide) — those make Friday inherit Sunday's supplier split. Seed booked sold = 0
  // per layer so allocateUnattributedSoldAcrossLayers FIFO-applies attributedSold only.
  const linkedSharedLedger =
    !!groupId && !isShell && (usedParentLedger || duration === "3_day" || duration === "2_day")

  const consumptionsByLayer = new Map<string, number>()
  if (linkedSharedLedger) {
    for (const id of layerIds) consumptionsByLayer.set(id, 0)
  } else if (layerIds.length > 0) {
    const { data: consData } = await admin
      .from("order_cost_consumptions")
      .select("cost_layer_id, quantity, orders!inner(status)")
      .in("cost_layer_id", layerIds)
      .neq("orders.status", "cancelled")
    for (const raw of (consData ?? []) as ConsumptionRow[]) {
      if (!raw.cost_layer_id) continue
      const qty = Math.max(0, Math.floor(Number(raw.quantity) || 0))
      consumptionsByLayer.set(
        raw.cost_layer_id,
        (consumptionsByLayer.get(raw.cost_layer_id) ?? 0) + qty,
      )
    }
  }

  let totalPackageSold = await readPortalOrderSoldForPackage(admin, packageId).catch(() => 0)

  if (linkedSharedLedger && groupId) {
    totalPackageSold = await linkedStockSourceAttributedSold(admin, {
      packageId,
      groupId,
      duration,
    })
  } else {
    let sfWonSold = 0
    const { data: pkgSf } = await admin
      .from("packages")
      .select("salesforce_product_id")
      .eq("id", packageId)
      .maybeSingle()
    const product2IdForSold = (pkgSf as { salesforce_product_id?: string | null } | null)
      ?.salesforce_product_id?.trim()
    if (product2IdForSold) {
      const config = getSalesforceConfig()
      if (config) {
        sfWonSold = await computeProductQuantitySoldFromWonLines(
          product2IdForSold,
          config.opportunityStageWon,
        ).catch(() => 0)
      }
    }

    // Booked = portal orders + live Closed Won. Prefer this over (purchased − sellable),
    // which rewrites Stock Sources to Quantity Sold = Stock whenever package_inventory is
    // stuck at 0 after a Closed Lost (stale offline apps / heal lag).
    const booked = Math.max(totalPackageSold, sfWonSold)
    if (booked > 0) {
      totalPackageSold = booked
    } else {
      let sellable = 0
      const { data: inv } = await admin
        .from("package_inventory")
        .select("qty_available, qty_held")
        .eq("package_id", packageId)
        .maybeSingle()
      if (inv) {
        const available = Math.max(0, Math.floor(Number(inv.qty_available) || 0))
        const held = Math.max(0, Math.floor(Number(inv.qty_held) || 0))
        sellable = Math.max(0, available - held)
      }
      const totalPurchased = layers.reduce((sum, l) => sum + l.quantity, 0)
      const impliedSoldFromInventory = Math.max(0, totalPurchased - sellable)
      // Only imply from inventory when we have no booking signal at all.
      totalPackageSold = Math.max(totalPackageSold, impliedSoldFromInventory)
    }
  }

  return {
    layers,
    purchaseOrders,
    purchaseOrderDocsByPo,
    blocks,
    consumptionsByLayer,
    totalPackageSold,
  }
}

function formatPoDocumentSummary(docs: readonly string[]): string | null {
  if (docs.length === 0) return null
  const summary = docs.map((d) => `• ${d}`).join("\n")
  return summary.length > 32000 ? summary.slice(0, 31900) + "\n…" : summary
}

/**
 * Sync all `Stock_Source__c` records for a Salesforce Product2 based on the
 * portal's current cost-layer groupings. Best-effort: individual row failures
 * are captured in the result rather than thrown.
 */
export async function syncStockSourcesForProduct(input: {
  admin: SupabaseClient
  packageId: string
  product2Id: string
}): Promise<StockSourceSyncResult> {
  const { admin, packageId, product2Id } = input
  const result: StockSourceSyncResult = { upserted: 0, removed: 0, errors: [], groups: 0 }

  let existing: ExistingStockSource[] = []
  try {
    existing = await readExistingPortalStockSources(product2Id)
  } catch (e) {
    if (e instanceof SalesforceApiError && (e.status === 400 || e.status === 404)) {
      // Object or field not yet deployed in this org — silently skip so the rest of the
      // product sync continues.
      const msg = e.message || String(e)
      result.errors.push(`Stock source sync skipped: ${msg}`)
      return result
    }
    throw e
  }

  const inputs = await loadStockSourceInputsForPackage(admin, packageId)
  const groups = groupLayersIntoStockSources({ packageId, ...inputs })
  result.groups = groups.length

  const nowIso = new Date().toISOString()
  const wantedRefs = new Set(groups.map((g) => g.portalRef))

  for (const g of groups) {
    const body: Record<string, unknown> = {
      Product__c: product2Id,
      Supplier__c: g.supplier || "Unassigned",
      Fulfilment_Block__c: g.fulfilmentBlockName ?? null,
      PO_Numbers__c: g.poNumbers.length > 0 ? truncate(g.poNumbers.join(", "), 1000) : null,
      Quantity_Purchased__c: g.quantityPurchased,
      Quantity_Sold__c: g.quantitySold,
      Last_Portal_Sync__c: nowIso,
      PO_Documents__c: formatPoDocumentSummary(g.poDocuments),
    }
    try {
      await salesforceRequest(
        "PATCH",
        `/sobjects/${SOURCE_OBJECT}/Portal_Source_Ref__c/${encodeURIComponent(g.portalRef)}`,
        { body },
      )
      result.upserted += 1
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      result.errors.push(`${g.supplier}${g.fulfilmentBlockName ? ` / ${g.fulfilmentBlockName}` : ""}: ${msg}`)
    }
  }

  // Remove portal-managed rows that no longer match a group (supplier or block removed / merged).
  for (const row of existing) {
    if (!row.Portal_Source_Ref__c) continue
    if (wantedRefs.has(row.Portal_Source_Ref__c)) continue
    try {
      await salesforceRequest("DELETE", `/sobjects/${SOURCE_OBJECT}/${row.Id}`)
      result.removed += 1
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      result.errors.push(`Remove stale ${row.Portal_Source_Ref__c}: ${msg}`)
    }
  }

  return result
}

export type SfStockSourceRow = {
  Id: string
  Supplier__c: string | null
  Fulfilment_Block__c: string | null
  Quantity_Purchased__c: number | null
  Quantity_Sold__c: number | null
  Portal_Source_Ref__c: string | null
  PO_Numbers__c: string | null
}

export type ImportStockSourcesResult = {
  imported: number
  skipped: number
  claimed: number
  errors: string[]
}

async function readAllStockSourcesForProduct(product2Id: string): Promise<SfStockSourceRow[]> {
  return salesforceQuery<SfStockSourceRow>(
    `SELECT Id, Supplier__c, Fulfilment_Block__c, Quantity_Purchased__c, Quantity_Sold__c, Portal_Source_Ref__c, PO_Numbers__c ` +
      `FROM ${SOURCE_OBJECT} WHERE Product__c = '${product2Id.replace(/'/g, "\\'")}'`,
  )
}

/**
 * Import Salesforce Stock_Source__c rows into portal cost layers as a ledger only —
 * does NOT change package_inventory qty_available (stock/sellable already come from SF).
 *
 * Use when SF has supplier purchase history the portal is missing (legacy / manually
 * entered Stock Sources). Idempotent: skips when portal already has matching layers.
 */
export async function importStockSourcesFromSalesforce(input: {
  admin: SupabaseClient
  packageId: string
  product2Id: string
}): Promise<ImportStockSourcesResult> {
  const { admin, packageId, product2Id } = input
  const result: ImportStockSourcesResult = { imported: 0, skipped: 0, claimed: 0, errors: [] }

  const ledger = await resolveLinkedStockLedger(admin, packageId)
  if (ledger.isShell || ledger.usedParentLedger) {
    return result
  }

  let sfRows: SfStockSourceRow[] = []
  try {
    sfRows = await readAllStockSourcesForProduct(product2Id)
  } catch (e) {
    if (e instanceof SalesforceApiError && (e.status === 400 || e.status === 404)) {
      result.errors.push(`Stock source import skipped: ${e.message}`)
      return result
    }
    throw e
  }

  if (sfRows.length === 0) return result

  const { data: pkg } = await admin
    .from("packages")
    .select("id, currency, shell_parent_package_id")
    .eq("id", packageId)
    .maybeSingle()
  if (!pkg) {
    result.errors.push("Package not found.")
    return result
  }
  if ((pkg as { shell_parent_package_id?: string | null }).shell_parent_package_id) {
    result.skipped += sfRows.length
    return result
  }

  const { data: inv } = await admin
    .from("package_inventory")
    .select("qty_available, qty_held")
    .eq("package_id", packageId)
    .maybeSingle()
  const available = Math.max(0, Math.floor(Number(inv?.qty_available) || 0))
  const held = Math.max(0, Math.floor(Number(inv?.qty_held) || 0))
  const sellable = Math.max(0, available - held)

  const currency =
    (typeof (pkg as { currency?: string | null }).currency === "string" &&
      (pkg as { currency: string }).currency.trim()) ||
    "USD"

  const { data: existingLayers, error: layerErr } = await admin
    .from("package_cost_layers")
    .select("id, quantity, source, note")
    .eq("package_id", packageId)
  if (layerErr) {
    result.errors.push(layerErr.message)
    return result
  }

  const existingPurchased = (existingLayers ?? []).reduce(
    (sum, l) => sum + Math.max(0, Math.floor(Number((l as { quantity: number }).quantity) || 0)),
    0,
  )
  const existingBySupplier = new Map<string, number>()
  for (const l of existingLayers ?? []) {
    const src = String((l as { source?: string | null }).source ?? "")
      .trim()
      .toLowerCase()
    if (!src) continue
    existingBySupplier.set(
      src,
      (existingBySupplier.get(src) ?? 0) +
        Math.max(0, Math.floor(Number((l as { quantity: number }).quantity) || 0)),
    )
  }

  const sfPurchasedTotal = sfRows.reduce(
    (sum, r) => sum + Math.max(0, Math.floor(Number(r.Quantity_Purchased__c) || 0)),
    0,
  )
  const sfSoldTotal = sfRows.reduce(
    (sum, r) => sum + Math.max(0, Math.floor(Number(r.Quantity_Sold__c) || 0)),
    0,
  )
  // Prefer inventory-implied sold when SF Stock Source Sold is stale/zero.
  const impliedSoldFromInventory =
    sfPurchasedTotal > 0 ? Math.max(0, sfPurchasedTotal - sellable) : 0
  const effectiveSoldTotal = Math.max(sfSoldTotal, impliedSoldFromInventory)

  // Portal already has a full purchase ledger covering SF totals — only claim refs.
  const portalCoversSf = existingPurchased >= sfPurchasedTotal && existingPurchased > 0

  // Allocate remaining capacity across imported rows FIFO by purchased qty.
  let remainingPool = Math.max(0, sfPurchasedTotal - effectiveSoldTotal)

  for (const row of sfRows) {
    const supplier = (row.Supplier__c ?? "").trim() || "Unassigned"
    const purchased = Math.max(0, Math.floor(Number(row.Quantity_Purchased__c) || 0))
    if (purchased <= 0) {
      result.skipped += 1
      continue
    }

    const portalRef = buildPortalRef(packageId, supplier, null)
    const existingRef = row.Portal_Source_Ref__c?.trim() || ""

    // Claim the SF row under our deterministic portal ref so a later push updates
    // this same Stock Source instead of creating a duplicate.
    if (!existingRef.startsWith(SOURCE_REF_PREFIX)) {
      try {
        await salesforceRequest("PATCH", `/sobjects/${SOURCE_OBJECT}/${row.Id}`, {
          body: { Portal_Source_Ref__c: portalRef },
        })
        result.claimed += 1
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        result.errors.push(`Claim ${supplier}: ${msg}`)
      }
    }

    if (portalCoversSf) {
      result.skipped += 1
      continue
    }

    const supplierKey = supplier.toLowerCase()
    const alreadyForSupplier = existingBySupplier.get(supplierKey) ?? 0
    if (alreadyForSupplier >= purchased) {
      result.skipped += 1
      continue
    }

    const remaining = Math.min(purchased, remainingPool)
    remainingPool = Math.max(0, remainingPool - remaining)
    const noteParts = [
      "Imported from Salesforce Stock Source",
      row.Fulfilment_Block__c?.trim() ? `block: ${row.Fulfilment_Block__c.trim()}` : null,
      row.PO_Numbers__c?.trim() ? `PO: ${row.PO_Numbers__c.trim()}` : null,
    ].filter(Boolean)

    const { error: insErr } = await admin.from("package_cost_layers").insert({
      package_id: packageId,
      quantity: purchased,
      quantity_remaining: remaining,
      unit_cost: 0,
      currency,
      note: noteParts.join(" — "),
      source: supplier,
      received_at: new Date().toISOString(),
    })
    if (insErr) {
      result.errors.push(`${supplier}: ${insErr.message}`)
      continue
    }

    existingBySupplier.set(supplierKey, alreadyForSupplier + purchased)
    result.imported += 1
  }

  return result
}

/**
 * For packages missing a purchase ledger, import Stock Sources from Salesforce
 * without changing sellable inventory. Best-effort across many packages.
 */
export async function importMissingStockSourcesFromSalesforce(
  admin: SupabaseClient,
  options?: { packageIds?: string[]; limit?: number },
): Promise<{ packagesChecked: number; imported: number; claimed: number; errors: string[] }> {
  const out = { packagesChecked: 0, imported: 0, claimed: 0, errors: [] as string[] }
  const limit = options?.limit ?? 40

  let query = admin
    .from("packages")
    .select("id, salesforce_product_id")
    .not("salesforce_product_id", "is", null)
    .is("shell_parent_package_id", null)
    .limit(Math.max(limit * 5, 100))

  if (options?.packageIds && options.packageIds.length > 0) {
    query = admin
      .from("packages")
      .select("id, salesforce_product_id")
      .in("id", options.packageIds)
      .not("salesforce_product_id", "is", null)
      .is("shell_parent_package_id", null)
  }

  const { data: pkgs, error } = await query
  if (error) {
    out.errors.push(error.message)
    return out
  }

  const candidates = (pkgs ?? [])
    .map((raw) => ({
      packageId: String((raw as { id: string }).id),
      product2Id: String((raw as { salesforce_product_id: string }).salesforce_product_id ?? "").trim(),
    }))
    .filter((p) => p.packageId && p.product2Id)

  if (candidates.length === 0) return out

  // One query for existing cost layers instead of a COUNT per package.
  const { data: layerRows } = await admin
    .from("package_cost_layers")
    .select("package_id")
    .in(
      "package_id",
      candidates.map((c) => c.packageId),
    )
  const hasLayers = new Set(
    (layerRows ?? []).map((r) => String((r as { package_id: string }).package_id)),
  )

  const missing = candidates.filter((c) => !hasLayers.has(c.packageId)).slice(0, limit)

  for (const { packageId, product2Id } of missing) {
    out.packagesChecked += 1
    try {
      const r = await importStockSourcesFromSalesforce({ admin, packageId, product2Id })
      out.imported += r.imported
      out.claimed += r.claimed
      out.errors.push(...r.errors.map((e) => `${packageId}: ${e}`))
    } catch (e) {
      out.errors.push(`${packageId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return out
}
