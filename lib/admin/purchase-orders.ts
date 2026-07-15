import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"

export type PurchaseOrderRow = {
  id: string
  po_number: string
  supplier: string
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

export type PurchaseOrderUsage = {
  purchase_order_id: string
  layer_count: number
  quantity_purchased: number
  quantity_remaining: number
  package_ids: string[]
}

export type PurchaseOrderWithMeta = PurchaseOrderRow & {
  documents: PurchaseOrderDocumentRow[]
  usage: PurchaseOrderUsage
}

const PO_COLUMNS =
  "id, po_number, supplier, issued_at, note, created_at, updated_at" as const

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
  if (error || !data) return []
  return data.map((row) => ({
    ...(row as PurchaseOrderRow),
    issued_at: normaliseIssuedAt((row as PurchaseOrderRow).issued_at),
  }))
}

export async function getPurchaseOrderById(id: string): Promise<PurchaseOrderRow | null> {
  noStore()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(PO_COLUMNS)
    .eq("id", id)
    .maybeSingle()
  if (error || !data) return null
  return { ...(data as PurchaseOrderRow), issued_at: normaliseIssuedAt((data as PurchaseOrderRow).issued_at) }
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
    .select("id, package_id, purchase_order_id, quantity, quantity_remaining")
    .in("purchase_order_id", purchaseOrderIds)
  if (error || !data) return out
  for (const raw of data) {
    const row = raw as {
      id: string
      package_id: string
      purchase_order_id: string
      quantity: number | string
      quantity_remaining: number | string
    }
    const poId = row.purchase_order_id
    const entry =
      out.get(poId) ?? {
        purchase_order_id: poId,
        layer_count: 0,
        quantity_purchased: 0,
        quantity_remaining: 0,
        package_ids: [],
      }
    entry.layer_count += 1
    entry.quantity_purchased += Math.max(0, Math.floor(Number(row.quantity) || 0))
    entry.quantity_remaining += Math.max(0, Math.floor(Number(row.quantity_remaining) || 0))
    if (!entry.package_ids.includes(row.package_id)) {
      entry.package_ids.push(row.package_id)
    }
    out.set(poId, entry)
  }
  return out
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
    usage:
      usage.get(o.id) ?? {
        purchase_order_id: o.id,
        layer_count: 0,
        quantity_purchased: 0,
        quantity_remaining: 0,
        package_ids: [],
      },
  }))
}
