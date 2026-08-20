import { unstable_noStore as noStore } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import { createClient } from "@/lib/supabase/server"
import { linkPurchaseOrderSupplier } from "@/lib/inventory/suppliers"

export type PurchaseOrderRow = {
  id: string
  po_number: string
  supplier: string
  supplier_id: string | null
  /** CRM company linked through suppliers.crm_account_id. Null until an admin picks a company. */
  supplier_account_id: string | null
  /** Supplier contract / invoice / order number(s). Distinct from the internal PO number. */
  supplier_reference: string | null
  issued_at: string | null
  note: string | null
  created_at: string
  updated_at: string
}

export type PurchaseOrderDocumentRow = {
  id: string
  purchase_order_id: string
  file_bucket: string
  file_path: string
  file_name: string
  file_content_type: string | null
  file_size: number | null
  uploaded_at: string
}

export type PurchaseOrderStockLine = {
  layerId: string
  packageId: string
  packageName: string
  raceId: string | null
  eventName: string
  quantityPurchased: number
  quantityRemaining: number
  unitCost: number
  currency: string
}

export type PurchaseOrderProductOption = {
  id: string
  name: string
  eventName: string
}

export type PurchaseOrderUsage = {
  purchase_order_id: string
  layer_count: number
  quantity_purchased: number
  quantity_remaining: number
  package_ids: string[]
  lines: PurchaseOrderStockLine[]
}

function emptyUsage(purchaseOrderId: string): PurchaseOrderUsage {
  return {
    purchase_order_id: purchaseOrderId,
    layer_count: 0,
    quantity_purchased: 0,
    quantity_remaining: 0,
    package_ids: [],
    lines: [],
  }
}

export type PurchaseOrderWithMeta = PurchaseOrderRow & {
  documents: PurchaseOrderDocumentRow[]
  usage: PurchaseOrderUsage
}

export function generatePurchaseOrderNumber(): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  return `PO-${d}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`
}

export { purchaseOrderAdminHref } from "@/lib/admin/purchase-order-link"

function issuedDateFromReceivedAt(receivedAt: string | null | undefined): string | null {
  if (!receivedAt) return null
  const s = String(receivedAt).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

const PO_COLUMNS =
  "id, po_number, supplier, supplier_id, supplier_reference, issued_at, note, created_at, updated_at, suppliers(crm_account_id)" as const
const PO_COLUMNS_NO_REF =
  "id, po_number, supplier, supplier_id, issued_at, note, created_at, updated_at, suppliers(crm_account_id)" as const
const PO_COLUMNS_BARE =
  "id, po_number, supplier, supplier_id, issued_at, note, created_at, updated_at" as const

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function mapPurchaseOrderRow(row: {
  id: string
  po_number: string
  supplier: string
  supplier_id: string | null
  supplier_reference?: string | null
  issued_at: string | null
  note: string | null
  created_at: string
  updated_at: string
  suppliers?: { crm_account_id: string | null } | { crm_account_id: string | null }[] | null
}): PurchaseOrderRow {
  const supplierReference = String(row.supplier_reference ?? "").trim()
  return {
    id: row.id,
    po_number: row.po_number,
    supplier: row.supplier,
    supplier_id: row.supplier_id,
    supplier_account_id: one(row.suppliers)?.crm_account_id ?? null,
    supplier_reference: supplierReference || null,
    issued_at: normaliseIssuedAt(row.issued_at),
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function setPurchaseOrderSupplierReference(
  supabase: SupabaseClient,
  id: string,
  supplierReference: string | null | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const value = supplierReference?.trim() ? supplierReference.trim().slice(0, 200) : null
  const { error } = await supabase.from("purchase_orders").update({ supplier_reference: value }).eq("id", id)
  if (!error) return { ok: true }
  const message = error.message.toLowerCase()
  if (message.includes("supplier_reference")) {
    return {
      ok: false,
      message: "Apply the latest database migration to store supplier contract/invoice numbers.",
    }
  }
  return { ok: false, message: error.message }
}

const PO_DOC_COLUMNS =
  "id, purchase_order_id, file_bucket, file_path, file_name, file_content_type, file_size, uploaded_at" as const

function normaliseIssuedAt(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s ? s.slice(0, 10) : null
}

export async function getPurchaseOrders(): Promise<PurchaseOrderRow[]> {
  noStore()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(PO_COLUMNS)
    .order("issued_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
  if (!error && data) return data.map((row) => mapPurchaseOrderRow(row))

  const withoutRef = await supabase
    .from("purchase_orders")
    .select(PO_COLUMNS_NO_REF)
    .order("issued_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
  if (!withoutRef.error && withoutRef.data) {
    return withoutRef.data.map((row) => mapPurchaseOrderRow({ ...row, supplier_reference: null }))
  }

  const fallback = await supabase
    .from("purchase_orders")
    .select(PO_COLUMNS_BARE)
    .order("issued_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
  if (fallback.error || !fallback.data) return []
  return fallback.data.map((row) => mapPurchaseOrderRow({ ...row, suppliers: null, supplier_reference: null }))
}

export async function getPurchaseOrderById(id: string): Promise<PurchaseOrderRow | null> {
  noStore()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(PO_COLUMNS)
    .eq("id", id)
    .maybeSingle()
  if (!error && data) return mapPurchaseOrderRow(data)

  const withoutRef = await supabase
    .from("purchase_orders")
    .select(PO_COLUMNS_NO_REF)
    .eq("id", id)
    .maybeSingle()
  if (!withoutRef.error && withoutRef.data) {
    return mapPurchaseOrderRow({ ...withoutRef.data, supplier_reference: null })
  }
  return null
}

export async function getPurchaseOrderDocuments(
  purchaseOrderIds: readonly string[],
): Promise<Map<string, PurchaseOrderDocumentRow[]>> {
  const out = new Map<string, PurchaseOrderDocumentRow[]>()
  if (purchaseOrderIds.length === 0) return out
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("purchase_order_documents")
    .select(PO_DOC_COLUMNS)
    .in("purchase_order_id", purchaseOrderIds)
    .order("uploaded_at", { ascending: false })
  if (error || !data) return out
  for (const raw of data) {
    const row = raw as PurchaseOrderDocumentRow
    const list = out.get(row.purchase_order_id) ?? []
    list.push(row)
    out.set(row.purchase_order_id, list)
  }
  return out
}

export async function getPurchaseOrderUsage(
  purchaseOrderIds: readonly string[],
): Promise<Map<string, PurchaseOrderUsage>> {
  const out = new Map<string, PurchaseOrderUsage>()
  if (purchaseOrderIds.length === 0) return out
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("package_cost_layers")
    .select("id, package_id, purchase_order_id, quantity, quantity_remaining, unit_cost, currency, created_at")
    .in("purchase_order_id", purchaseOrderIds)
    .order("created_at", { ascending: true })
  if (error || !data) return out

  const layersByPo = new Map<string, typeof data>()
  for (const raw of data) {
    const row = raw as {
      id: string
      package_id: string
      purchase_order_id: string
      quantity: number | string
      quantity_remaining: number | string
      unit_cost: number | string | null
      currency: string | null
    }
    const poId = row.purchase_order_id
    const entry = out.get(poId) ?? emptyUsage(poId)
    const purchased = Math.max(0, Math.floor(Number(row.quantity) || 0))
    const remaining = Math.max(0, Math.floor(Number(row.quantity_remaining) || 0))
    entry.layer_count += 1
    entry.quantity_purchased += purchased
    entry.quantity_remaining += remaining
    if (!entry.package_ids.includes(row.package_id)) {
      entry.package_ids.push(row.package_id)
    }
    out.set(poId, entry)
    const list = layersByPo.get(poId) ?? []
    list.push(raw)
    layersByPo.set(poId, list)
  }

  const packageIds = [...new Set(data.map((row) => String((row as { package_id: string }).package_id)))]
  if (packageIds.length === 0) return out

  const { data: packages } = await supabase.from("packages").select("id, name, race_id").in("id", packageIds)
  const packageById = new Map(
    (packages ?? []).map((pkg) => [
      String((pkg as { id: string }).id),
      pkg as { id: string; name: string; race_id: string | null },
    ]),
  )
  const raceIds = [
    ...new Set(
      [...packageById.values()]
        .map((pkg) => pkg.race_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const raceNameById = new Map<string, string>()
  if (raceIds.length > 0) {
    const { data: races } = await supabase.from("races").select("id, name, season").in("id", raceIds)
    for (const race of races ?? []) {
      const row = race as { id: string; name: string; season: number | null }
      raceNameById.set(row.id, eventSeasonLabel(row.name, row.season))
    }
  }

  for (const [poId, layers] of layersByPo) {
    const entry = out.get(poId)
    if (!entry) continue
    entry.lines = layers
      .map((raw) => {
        const row = raw as {
          id: string
          package_id: string
          quantity: number | string
          quantity_remaining: number | string
          unit_cost: number | string | null
          currency: string | null
        }
        const pkg = packageById.get(row.package_id)
        const eventName = pkg?.race_id ? (raceNameById.get(pkg.race_id) ?? "Unknown event") : "Unknown event"
        return {
          layerId: String(row.id),
          packageId: row.package_id,
          packageName: pkg?.name?.trim() || "Unknown product",
          raceId: pkg?.race_id ?? null,
          eventName,
          quantityPurchased: Math.max(0, Math.floor(Number(row.quantity) || 0)),
          quantityRemaining: Math.max(0, Math.floor(Number(row.quantity_remaining) || 0)),
          unitCost: Number(row.unit_cost) || 0,
          currency: String(row.currency ?? "USD") || "USD",
        }
      })
      .sort((a, b) => {
        const eventCmp = a.eventName.localeCompare(b.eventName, undefined, { sensitivity: "base" })
        if (eventCmp !== 0) return eventCmp
        const nameCmp = a.packageName.localeCompare(b.packageName, undefined, { sensitivity: "base" })
        if (nameCmp !== 0) return nameCmp
        return a.layerId.localeCompare(b.layerId)
      })
  }

  return out
}

export async function getPurchaseOrderProductOptions(): Promise<PurchaseOrderProductOption[]> {
  noStore()
  const supabase = await createClient()
  const { data: packages, error } = await supabase
    .from("packages")
    .select("id, name, race_id, duration, inventory_group_id, shell_parent_package_id")
    .order("name")
  if (error || !packages) return []

  const usable = (packages as Array<{
    id: string
    name: string | null
    race_id: string | null
    duration: string | null
    inventory_group_id: string | null
    shell_parent_package_id: string | null
  }>).filter((pkg) => !pkg.shell_parent_package_id)

  const threeDayByGroup = new Set(
    usable
      .filter((pkg) => pkg.inventory_group_id && pkg.duration === "3_day")
      .map((pkg) => pkg.inventory_group_id as string),
  )
  const stockPackages = usable.filter((pkg) => {
    if (!pkg.inventory_group_id || pkg.duration === "3_day") return true
    return !threeDayByGroup.has(pkg.inventory_group_id)
  })

  const raceIds = [...new Set(stockPackages.map((pkg) => pkg.race_id).filter((id): id is string => Boolean(id)))]
  const raceNameById = new Map<string, string>()
  if (raceIds.length > 0) {
    const { data: races } = await supabase.from("races").select("id, name, season").in("id", raceIds)
    for (const race of races ?? []) {
      const row = race as { id: string; name: string; season: number | null }
      raceNameById.set(row.id, eventSeasonLabel(row.name, row.season))
    }
  }

  return stockPackages
    .map((pkg) => ({
      id: pkg.id,
      name: pkg.name?.trim() || "Untitled product",
      eventName: pkg.race_id ? (raceNameById.get(pkg.race_id) ?? "Unknown event") : "Unknown event",
    }))
    .sort((a, b) => {
      const eventCmp = a.eventName.localeCompare(b.eventName, undefined, { sensitivity: "base" })
      if (eventCmp !== 0) return eventCmp
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    })
}

export async function getPurchaseOrdersWithMeta(): Promise<PurchaseOrderWithMeta[]> {
  const orders = await getPurchaseOrders()
  if (orders.length === 0) return []
  const ids = orders.map((o) => o.id)
  const [docs, usage] = await Promise.all([
    getPurchaseOrderDocuments(ids),
    getPurchaseOrderUsage(ids),
  ])
  return orders.map((o) => ({
    ...o,
    documents: docs.get(o.id) ?? [],
    usage: usage.get(o.id) ?? emptyUsage(o.id),
  }))
}

/** Create and link a purchase order for every cost layer on this package that is missing one. */
export async function ensurePurchaseOrdersForPackageLayers(packageId: string): Promise<number> {
  const id = packageId.trim()
  if (!id) return 0
  const supabase = await createClient()
  const { data: layers, error } = await supabase
    .from("package_cost_layers")
    .select("id, source, note, received_at, purchase_order_id")
    .eq("package_id", id)
    .is("purchase_order_id", null)
  if (error || !layers || layers.length === 0) return 0

  let created = 0
  for (const layer of layers) {
    const supplier = (String(layer.source ?? "").trim() || "Unknown supplier").slice(0, 200)
    const poNumber = generatePurchaseOrderNumber()
    const note = String(layer.note ?? "").trim().slice(0, 5000) || "Auto-created from stock purchase"
    const { data: poId, error: createErr } = await supabase.rpc("admin_create_purchase_order", {
      p_po_number: poNumber,
      p_supplier: supplier,
      p_issued_at: issuedDateFromReceivedAt(layer.received_at as string | null),
      p_note: note,
    })
    if (createErr || !poId) {
      console.warn(
        "[purchase-order] auto-create for layer failed:",
        createErr?.message ?? "missing id",
      )
      continue
    }
    const resolvedId = String(poId)
    const { error: linkErr } = await supabase.rpc("admin_set_cost_layer_purchase_order", {
      p_layer_id: layer.id,
      p_purchase_order_id: resolvedId,
      p_clear: false,
    })
    if (linkErr) {
      console.warn("[purchase-order] link layer failed:", linkErr.message)
      continue
    }
    const linked = await linkPurchaseOrderSupplier(supabase, resolvedId, supplier)
    if (!linked.ok) {
      console.warn("[purchase-order] supplier link failed:", linked.message)
    }
    created += 1
  }
  return created
}
