import { unstable_noStore as noStore } from "next/cache"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import { createClient } from "@/lib/supabase/server"
import type { DealStage } from "@/lib/crm/deal-types"

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export type SupplierProfileProduct = {
  packageId: string
  packageName: string
  raceId: string | null
  eventName: string
  unitsPurchased: number
  unitsRemaining: number
  unitsCommitted: number
  unitsAvailable: number
  purchaseValueByCurrency: Array<{ currency: string; value: number }>
}

export type SupplierProfileDeal = {
  id: string
  reference: string
  stage: DealStage
  accountId: string | null
  accountName: string | null
  packageId: string
  packageName: string
  eventName: string
  quantity: number
  sourcingMode: string
  updatedAt: string
}

export type SupplierProfilePurchaseOrder = {
  id: string
  poNumber: string
  issuedAt: string | null
  note: string | null
  documentCount: number
  unitsPurchased: number
  unitsRemaining: number
  products: string[]
}

export type SupplierProfile = {
  supplier: {
    id: string
    name: string
    code: string | null
    contactName: string | null
    contactEmail: string | null
    contactPhone: string | null
    notes: string | null
    active: boolean
    crmAccountId: string | null
    createdAt: string
    updatedAt: string
  }
  purchaseOrders: SupplierProfilePurchaseOrder[]
  products: SupplierProfileProduct[]
  deals: SupplierProfileDeal[]
  coverageRaceIds: string[]
  spendByCurrency: Array<{ currency: string; value: number }>
  unitsPurchased: number
  unitsRemaining: number
  unitsAvailable: number
}

// package_cost_layers has two FKs to packages (package_id and source_package_id).
// PostgREST returns PGRST201 unless the ledger package relationship is hinted.
const COST_LAYER_PROFILE_SELECT =
  "id, package_id, purchase_order_id, quantity, quantity_remaining, unit_cost, currency, packages!package_id(name, race_id, races(name, season))" as const

type LayerRow = {
  id: string
  package_id: string
  purchase_order_id: string | null
  quantity: number | string
  quantity_remaining: number | string
  unit_cost: number | string
  currency: string
  packages:
    | {
        name: string
        race_id: string | null
        races:
          | { name: string; season: number | null }
          | Array<{ name: string; season: number | null }>
          | null
      }
    | Array<{
        name: string
        race_id: string | null
        races:
          | { name: string; season: number | null }
          | Array<{ name: string; season: number | null }>
          | null
      }>
    | null
}

export async function getSupplierProfile(supplierId: string): Promise<SupplierProfile | null> {
  noStore()
  const supabase = await createClient()
  const id = supplierId.trim()
  if (!id) return null

  const { data: supplier, error } = await supabase
    .from("suppliers")
    .select("id, name, code, contact_name, contact_email, contact_phone, notes, active, crm_account_id, created_at, updated_at")
    .eq("id", id)
    .maybeSingle()
  if (error || !supplier) return null

  const [{ data: linkedPos }, { data: legacyPos }, { data: directLayers }, { data: legacyLayers }, { data: dealLines }, { data: coverageRows }] =
    await Promise.all([
      supabase
        .from("purchase_orders")
        .select("id, po_number, issued_at, note, created_at, purchase_order_documents(id)")
        .eq("supplier_id", id),
      supabase
        .from("purchase_orders")
        .select("id, po_number, issued_at, note, created_at, purchase_order_documents(id)")
        .is("supplier_id", null)
        .ilike("supplier", supplier.name),
      supabase
        .from("package_cost_layers")
        .select(COST_LAYER_PROFILE_SELECT)
        .eq("supplier_id", id),
      supabase
        .from("package_cost_layers")
        .select(COST_LAYER_PROFILE_SELECT)
        .is("supplier_id", null)
        .ilike("source", supplier.name),
      supabase
        .from("deal_line_items")
        .select(`
          package_id, quantity, sourcing_mode,
          packages(name, race_id, races(name, season)),
          deals(id, reference, stage, account_id, order_id, updated_at, crm_accounts(name))
        `)
        .eq("supplier_id", id),
      supabase.from("supplier_event_coverage").select("race_id").eq("supplier_id", id),
    ])

  const poById = new Map<
    string,
    {
      id: string
      po_number: string
      issued_at: string | null
      note: string | null
      created_at: string
      purchase_order_documents: Array<{ id: string }> | null
    }
  >()
  for (const po of [...(linkedPos ?? []), ...(legacyPos ?? [])]) poById.set(po.id, po)
  const poIds = [...poById.keys()]
  const { data: poLayers } = poIds.length
    ? await supabase
        .from("package_cost_layers")
        .select(COST_LAYER_PROFILE_SELECT)
        .in("purchase_order_id", poIds)
    : { data: [] }

  const layerById = new Map<string, LayerRow>()
  for (const layer of [...(directLayers ?? []), ...(legacyLayers ?? []), ...(poLayers ?? [])] as LayerRow[]) {
    layerById.set(layer.id, layer)
  }
  const layers = [...layerById.values()]

  const committedByPackage = new Map<string, number>()
  const deals: SupplierProfileDeal[] = []
  for (const raw of dealLines ?? []) {
    const deal = one(
      raw.deals as
        | {
            id: string
            reference: string
            stage: string
            account_id: string | null
            order_id: string | null
            updated_at: string
            crm_accounts: { name: string } | Array<{ name: string }> | null
          }
        | Array<{
            id: string
            reference: string
            stage: string
            account_id: string | null
            order_id: string | null
            updated_at: string
            crm_accounts: { name: string } | Array<{ name: string }> | null
          }>
        | null,
    )
    if (!deal) continue
    const pkg = one(
      raw.packages as
        | {
            name: string
            race_id: string | null
            races: { name: string; season: number | null } | Array<{ name: string; season: number | null }> | null
          }
        | Array<{
            name: string
            race_id: string | null
            races: { name: string; season: number | null } | Array<{ name: string; season: number | null }> | null
          }>
        | null,
    )
    const race = one(pkg?.races)
    const account = one(deal.crm_accounts)
    const quantity = Number(raw.quantity ?? 0)
    const stage = deal.stage as DealStage
    if (!deal.order_id && !["closed_lost", "cancelled", "fulfilled"].includes(stage)) {
      committedByPackage.set(raw.package_id, (committedByPackage.get(raw.package_id) ?? 0) + quantity)
    }
    deals.push({
      id: deal.id,
      reference: deal.reference,
      stage,
      accountId: deal.account_id,
      accountName: account?.name ?? null,
      packageId: raw.package_id,
      packageName: pkg?.name ?? "Unknown product",
      eventName: race ? eventSeasonLabel(race.name, race.season) : "Unknown event",
      quantity,
      sourcingMode: raw.sourcing_mode,
      updatedAt: deal.updated_at,
    })
  }
  deals.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const productById = new Map<string, SupplierProfileProduct>()
  const spendByCurrency = new Map<string, number>()
  const poUsage = new Map<string, { purchased: number; remaining: number; products: Set<string> }>()
  for (const layer of layers) {
    const pkg = one(layer.packages)
    const race = one(pkg?.races)
    const purchased = Math.max(0, Number(layer.quantity ?? 0))
    const remaining = Math.max(0, Number(layer.quantity_remaining ?? 0))
    const layerValue = purchased * Math.max(0, Number(layer.unit_cost ?? 0))
    const currency = layer.currency || "USD"
    spendByCurrency.set(currency, (spendByCurrency.get(currency) ?? 0) + layerValue)
    const current = productById.get(layer.package_id) ?? {
      packageId: layer.package_id,
      packageName: pkg?.name ?? "Unknown product",
      raceId: pkg?.race_id ?? null,
      eventName: race ? eventSeasonLabel(race.name, race.season) : "Unknown event",
      unitsPurchased: 0,
      unitsRemaining: 0,
      unitsCommitted: committedByPackage.get(layer.package_id) ?? 0,
      unitsAvailable: 0,
      purchaseValueByCurrency: [],
    }
    current.unitsPurchased += purchased
    current.unitsRemaining += remaining
    const productCurrency = current.purchaseValueByCurrency.find((entry) => entry.currency === currency)
    if (productCurrency) productCurrency.value += layerValue
    else current.purchaseValueByCurrency.push({ currency, value: layerValue })
    productById.set(layer.package_id, current)

    if (layer.purchase_order_id) {
      const usage = poUsage.get(layer.purchase_order_id) ?? { purchased: 0, remaining: 0, products: new Set<string>() }
      usage.purchased += purchased
      usage.remaining += remaining
      usage.products.add(current.packageName)
      poUsage.set(layer.purchase_order_id, usage)
    }
  }

  const products = [...productById.values()]
    .map((product) => ({
      ...product,
      unitsAvailable: Math.max(0, product.unitsRemaining - product.unitsCommitted),
    }))
    .sort((a, b) => a.eventName.localeCompare(b.eventName) || a.packageName.localeCompare(b.packageName))
  const purchaseOrders: SupplierProfilePurchaseOrder[] = [...poById.values()]
    .map((po) => {
      const usage = poUsage.get(po.id)
      return {
        id: po.id,
        poNumber: po.po_number,
        issuedAt: po.issued_at,
        note: po.note,
        documentCount: (po.purchase_order_documents ?? []).length,
        unitsPurchased: usage?.purchased ?? 0,
        unitsRemaining: usage?.remaining ?? 0,
        products: [...(usage?.products ?? new Set<string>())].sort(),
      }
    })
    .sort((a, b) => (b.issuedAt ?? "").localeCompare(a.issuedAt ?? ""))

  return {
    supplier: {
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      contactName: supplier.contact_name,
      contactEmail: supplier.contact_email,
      contactPhone: supplier.contact_phone,
      notes: supplier.notes,
      active: Boolean(supplier.active),
      crmAccountId: supplier.crm_account_id ?? null,
      createdAt: supplier.created_at,
      updatedAt: supplier.updated_at,
    },
    purchaseOrders,
    products,
    deals,
    coverageRaceIds: [...new Set((coverageRows ?? []).map((row) => String(row.race_id)).filter(Boolean))],
    spendByCurrency: [...spendByCurrency.entries()].map(([currency, value]) => ({ currency, value })),
    unitsPurchased: products.reduce((sum, product) => sum + product.unitsPurchased, 0),
    unitsRemaining: products.reduce((sum, product) => sum + product.unitsRemaining, 0),
    unitsAvailable: products.reduce((sum, product) => sum + product.unitsAvailable, 0),
  }
}

export async function findSupplierIdForAccount(account: {
  id: string
  name: string
}): Promise<string | null> {
  const supabase = await createClient()
  const { data: linked } = await supabase
    .from("suppliers")
    .select("id")
    .eq("crm_account_id", account.id)
    .maybeSingle()
  return linked?.id ? String(linked.id) : null
}

export async function findAccountIdForSupplier(supplier: {
  id: string
  name: string
  crmAccountId?: string | null
}): Promise<string | null> {
  return supplier.crmAccountId ?? null
}
