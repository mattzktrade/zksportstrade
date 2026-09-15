import { unstable_noStore as noStore } from "next/cache"
import { parseAccountKinds, type AccountKind } from "@/lib/crm/account-kinds"
import type { WorkflowOrderRow } from "@/lib/admin/workflow-views"
import { isDirectClientAccount } from "@/lib/operations/fulfilment"
import { createClient } from "@/lib/supabase/server"

export type OperationsLinkedPo = {
  id: string
  poNumber: string | null
  guestDetailsDeadline: string | null
  ticketsReceivedAt: string | null
}

export type OperationsBookingRow = WorkflowOrderRow & {
  operationsContactId: string | null
  operationsContactName: string | null
  operationsContactEmail: string | null
  operationsContactPhone: string | null
  supplierFulfilmentMethod: string | null
  clientDeliveryMethod: string | null
  deliveryMethod: string | null
  collectionPoint: string | null
  collectionTime: string | null
  contactOnSite: string | null
  supplierDetailsSentAt: string | null
  thankYouSkippedAt: string | null
  guestDetailsDeadline: string | null
  ticketsReceivedAt: string | null
  purchaseOrders: OperationsLinkedPo[]
  hasDeliveryProof: boolean
  isDirectClient: boolean
  accountKinds: AccountKind[]
}

export type OperationsAccountContact = {
  id: string
  accountId: string
  fullName: string
  email: string | null
  phone: string | null
  jobTitle: string | null
  isPrimary: boolean
}

export type OperationsDeliveryProof = {
  id: string
  orderId: string | null
  dealId: string | null
  note: string | null
  fileName: string | null
  createdAt: string
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

async function fetchInChunks<T>(ids: string[], run: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  if (ids.length === 0) return []
  const size = 400
  const out: T[] = []
  for (let i = 0; i < ids.length; i += size) {
    out.push(...(await run(ids.slice(i, i + size))))
  }
  return out
}

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed ? trimmed : null
}

type OpsRow = {
  supplier_fulfilment_method: string | null
  client_delivery_method: string | null
  delivery_method: string | null
  collection_point: string | null
  collection_time: string | null
  contact_on_site: string | null
  supplier_details_sent_at: string | null
  thank_you_skipped_at: string | null
  delivery_due_at: string | null
}

const EMPTY_OPS: OpsRow = {
  supplier_fulfilment_method: null,
  client_delivery_method: null,
  delivery_method: null,
  collection_point: null,
  collection_time: null,
  contact_on_site: null,
  supplier_details_sent_at: null,
  thank_you_skipped_at: null,
  delivery_due_at: null,
}

export async function enrichOperationsBookings(rows: WorkflowOrderRow[]): Promise<OperationsBookingRow[]> {
  noStore()
  if (rows.length === 0) return []
  const supabase = await createClient()

  const orderIds = [...new Set(rows.map((row) => row.id).filter((id) => UUID_RE.test(id)))]
  const dealIds = [...new Set(rows.map((row) => row.dealId).filter((id): id is string => Boolean(id)))]
  const accountIds = [...new Set(rows.map((row) => row.accountId).filter((id): id is string => Boolean(id)))]

  const [dealExtras, orderOps, dealOps, accounts, orderProofs, dealProofs, orderLayers, dealLines] = await Promise.all([
    fetchInChunks(dealIds, async (chunk) => {
      const { data, error } = await supabase
        .from("deals")
        .select("id, operations_contact_id")
        .in("id", chunk)
      if (error && /operations_contact_id/i.test(error.message)) return [] as Array<{ id: string; operations_contact_id: string | null }>
      return (data ?? []) as Array<{ id: string; operations_contact_id: string | null }>
    }),
    fetchInChunks(orderIds, async (chunk) => {
      const { data, error } = await supabase
        .from("order_operations")
        .select(
          "order_id, supplier_fulfilment_method, client_delivery_method, delivery_method, collection_point, collection_time, contact_on_site, supplier_details_sent_at, thank_you_skipped_at, delivery_due_at",
        )
        .in("order_id", chunk)
      if (error && /supplier_fulfilment_method|thank_you_skipped/i.test(error.message)) {
        return [] as Array<OpsRow & { order_id: string }>
      }
      return (data ?? []) as Array<OpsRow & { order_id: string }>
    }),
    fetchInChunks(dealIds, async (chunk) => {
      const { data, error } = await supabase
        .from("deal_operations")
        .select(
          "deal_id, supplier_fulfilment_method, client_delivery_method, delivery_method, collection_point, collection_time, contact_on_site, supplier_details_sent_at, thank_you_skipped_at, delivery_due_at",
        )
        .in("deal_id", chunk)
      if (error && /supplier_fulfilment_method|thank_you_skipped/i.test(error.message)) {
        return [] as Array<OpsRow & { deal_id: string }>
      }
      return (data ?? []) as Array<OpsRow & { deal_id: string }>
    }),
    fetchInChunks(accountIds, async (chunk) => {
      const { data } = await supabase.from("crm_accounts").select("id, account_types").in("id", chunk)
      return (data ?? []) as Array<{ id: string; account_types: unknown }>
    }),
    fetchInChunks(orderIds, async (chunk) => {
      const { data, error } = await supabase.from("order_delivery_proofs").select("order_id, deal_id").in("order_id", chunk)
      if (error) return [] as Array<{ order_id: string | null; deal_id: string | null }>
      return (data ?? []) as Array<{ order_id: string | null; deal_id: string | null }>
    }),
    fetchInChunks(dealIds, async (chunk) => {
      const { data, error } = await supabase.from("order_delivery_proofs").select("order_id, deal_id").in("deal_id", chunk)
      if (error && /deal_id/i.test(error.message)) return [] as Array<{ order_id: string | null; deal_id: string | null }>
      return (data ?? []) as Array<{ order_id: string | null; deal_id: string | null }>
    }),
    fetchInChunks(orderIds, async (chunk) => {
      const { data } = await supabase.from("order_cost_consumptions").select("order_id, cost_layer_id").in("order_id", chunk)
      return (data ?? []) as Array<{ order_id: string; cost_layer_id: string | null }>
    }),
    fetchInChunks(dealIds, async (chunk) => {
      const { data } = await supabase
        .from("deal_line_items")
        .select("deal_id, fulfilment_cost_layer_id")
        .in("deal_id", chunk)
      return (data ?? []) as Array<{ deal_id: string; fulfilment_cost_layer_id: string | null }>
    }),
  ])

  const layerIds = [
    ...new Set(
      [
        ...orderLayers.map((row) => row.cost_layer_id),
        ...dealLines.map((row) => row.fulfilment_cost_layer_id),
      ].filter((id): id is string => Boolean(id)),
    ),
  ]
  const layers = await fetchInChunks(layerIds, async (chunk) => {
    const { data } = await supabase.from("package_cost_layers").select("id, purchase_order_id").in("id", chunk)
    return (data ?? []) as Array<{ id: string; purchase_order_id: string | null }>
  })
  const layerPo = new Map(layers.map((row) => [String(row.id), row.purchase_order_id]))
  const poIds = [...new Set([...layerPo.values()].filter((id): id is string => Boolean(id)))]
  const purchaseOrders = await fetchInChunks(poIds, async (chunk) => {
    const { data, error } = await supabase
      .from("purchase_orders")
      .select("id, po_number, guest_details_deadline, tickets_received_at")
      .in("id", chunk)
    if (error && /guest_details_deadline|tickets_received_at/i.test(error.message)) {
      return [] as Array<{
        id: string
        po_number: string | null
        guest_details_deadline: string | null
        tickets_received_at: string | null
      }>
    }
    return (data ?? []) as Array<{
      id: string
      po_number: string | null
      guest_details_deadline: string | null
      tickets_received_at: string | null
    }>
  })
  const poById = new Map(
    purchaseOrders.map((row) => [
      String(row.id),
      {
        id: String(row.id),
        poNumber: row.po_number,
        guestDetailsDeadline: blank(row.guest_details_deadline?.slice(0, 10)),
        ticketsReceivedAt: blank(row.tickets_received_at?.slice(0, 10)),
      } satisfies OperationsLinkedPo,
    ]),
  )

  const posByOrder = new Map<string, OperationsLinkedPo[]>()
  for (const row of orderLayers) {
    const poId = row.cost_layer_id ? layerPo.get(String(row.cost_layer_id)) : null
    const po = poId ? poById.get(poId) : null
    if (!po) continue
    const list = posByOrder.get(String(row.order_id)) ?? []
    if (!list.some((item) => item.id === po.id)) list.push(po)
    posByOrder.set(String(row.order_id), list)
  }
  const posByDeal = new Map<string, OperationsLinkedPo[]>()
  for (const row of dealLines) {
    const poId = row.fulfilment_cost_layer_id ? layerPo.get(String(row.fulfilment_cost_layer_id)) : null
    const po = poId ? poById.get(poId) : null
    if (!po) continue
    const list = posByDeal.get(String(row.deal_id)) ?? []
    if (!list.some((item) => item.id === po.id)) list.push(po)
    posByDeal.set(String(row.deal_id), list)
  }

  const opsContactIds = [...new Set(dealExtras.map((row) => row.operations_contact_id).filter(Boolean).map(String))]
  const contacts = await fetchInChunks(opsContactIds, async (chunk) => {
    const { data } = await supabase.from("crm_contacts").select("id, full_name, email, phone").in("id", chunk)
    return (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null; phone: string | null }>
  })
  const contactById = new Map(contacts.map((row) => [String(row.id), row]))
  const dealExtraById = new Map(dealExtras.map((row) => [String(row.id), row]))
  const orderOpsById = new Map(orderOps.map((row) => [String(row.order_id), row]))
  const dealOpsById = new Map(dealOps.map((row) => [String(row.deal_id), row]))
  const kindsByAccount = new Map(accounts.map((row) => [String(row.id), parseAccountKinds(row.account_types)]))
  const proofOrders = new Set(orderProofs.map((row) => row.order_id).filter(Boolean).map(String))
  const proofDeals = new Set(
    [...orderProofs, ...dealProofs].map((row) => row.deal_id).filter(Boolean).map(String),
  )

  return rows.map((row) => {
    const dealExtra = row.dealId ? dealExtraById.get(row.dealId) : null
    const ops =
      (UUID_RE.test(row.id) ? orderOpsById.get(row.id) : null) ??
      (row.dealId ? dealOpsById.get(row.dealId) : null) ??
      EMPTY_OPS
    const opsContactId = dealExtra?.operations_contact_id ?? null
    const opsContact = opsContactId ? contactById.get(opsContactId) : null
    const purchaseOrdersForRow = [
      ...(UUID_RE.test(row.id) ? posByOrder.get(row.id) ?? [] : []),
      ...(row.dealId ? posByDeal.get(row.dealId) ?? [] : []),
    ].filter((po, index, all) => all.findIndex((item) => item.id === po.id) === index)
    const deadlines = purchaseOrdersForRow
      .map((po) => po.guestDetailsDeadline)
      .filter((value): value is string => Boolean(value))
      .sort()
    const tickets = purchaseOrdersForRow
      .map((po) => po.ticketsReceivedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
    const allTicketsIn =
      purchaseOrdersForRow.length > 0 && purchaseOrdersForRow.every((po) => Boolean(po.ticketsReceivedAt))
    const accountKinds = row.accountId ? kindsByAccount.get(row.accountId) ?? [] : []
    return {
      ...row,
      operationsContactId: opsContactId,
      operationsContactName: opsContact?.full_name ?? null,
      operationsContactEmail: blank(opsContact?.email),
      operationsContactPhone: blank(opsContact?.phone),
      supplierFulfilmentMethod: blank(ops.supplier_fulfilment_method),
      clientDeliveryMethod: blank(ops.client_delivery_method),
      deliveryMethod: blank(ops.delivery_method),
      collectionPoint: blank(ops.collection_point),
      collectionTime: blank(ops.collection_time),
      contactOnSite: blank(ops.contact_on_site),
      supplierDetailsSentAt: ops.supplier_details_sent_at,
      thankYouSkippedAt: ops.thank_you_skipped_at,
      deliveryDueAt: ops.delivery_due_at ?? row.deliveryDueAt,
      guestDetailsDeadline: deadlines[0] ?? row.guestDetailsDueAt,
      ticketsReceivedAt: allTicketsIn ? tickets[tickets.length - 1]! : null,
      purchaseOrders: purchaseOrdersForRow,
      hasDeliveryProof: (UUID_RE.test(row.id) && proofOrders.has(row.id)) || Boolean(row.dealId && proofDeals.has(row.dealId)),
      isDirectClient: isDirectClientAccount(accountKinds),
      accountKinds,
    }
  })
}

export async function loadOperationsAccountContacts(accountIds: string[]): Promise<OperationsAccountContact[]> {
  noStore()
  const ids = [...new Set(accountIds.filter((id) => UUID_RE.test(id)))]
  if (!ids.length) return []
  const supabase = await createClient()
  const rows = await fetchInChunks(ids, async (chunk) => {
    const { data } = await supabase
      .from("crm_contacts")
      .select("id, account_id, full_name, email, phone, job_title, is_primary, active")
      .in("account_id", chunk)
      .eq("active", true)
      .order("is_primary", { ascending: false })
    return (data ?? []) as Array<{
      id: string
      account_id: string
      full_name: string | null
      email: string | null
      phone: string | null
      job_title: string | null
      is_primary: boolean
      active: boolean
    }>
  })
  return rows.map((row) => ({
    id: String(row.id),
    accountId: String(row.account_id),
    fullName: row.full_name?.trim() || "Unnamed contact",
    email: blank(row.email),
    phone: blank(row.phone),
    jobTitle: blank(row.job_title),
    isPrimary: Boolean(row.is_primary),
  }))
}

export async function loadOperationsDeliveryProofs(
  orderIds: string[],
  dealIds: string[],
): Promise<OperationsDeliveryProof[]> {
  noStore()
  const supabase = await createClient()
  const [byOrder, byDeal] = await Promise.all([
    fetchInChunks(orderIds.filter((id) => UUID_RE.test(id)), async (chunk) => {
      const { data, error } = await supabase
        .from("order_delivery_proofs")
        .select("id, order_id, deal_id, note, file_name, created_at")
        .in("order_id", chunk)
        .order("created_at", { ascending: false })
      if (error) return []
      return data ?? []
    }),
    fetchInChunks(dealIds.filter((id) => UUID_RE.test(id)), async (chunk) => {
      const { data, error } = await supabase
        .from("order_delivery_proofs")
        .select("id, order_id, deal_id, note, file_name, created_at")
        .in("deal_id", chunk)
        .order("created_at", { ascending: false })
      if (error) return []
      return data ?? []
    }),
  ])
  const seen = new Set<string>()
  const out: OperationsDeliveryProof[] = []
  for (const row of [...byOrder, ...byDeal]) {
    const id = String((row as { id: string }).id)
    if (seen.has(id)) continue
    seen.add(id)
    const record = row as {
      id: string
      order_id: string | null
      deal_id: string | null
      note: string | null
      file_name: string | null
      created_at: string
    }
    out.push({
      id,
      orderId: record.order_id,
      dealId: record.deal_id,
      note: record.note,
      fileName: record.file_name,
      createdAt: String(record.created_at),
    })
  }
  return out
}

export function oneContact<T>(value: T | T[] | null | undefined): T | null {
  return one(value)
}
