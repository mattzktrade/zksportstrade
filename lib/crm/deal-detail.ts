import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getCostLayersByPackage } from "@/lib/admin/cost-layers"
import { getDealListRows, type DealListRow } from "@/lib/crm/deals"
import type { OperationsGuest } from "@/lib/admin/workflow-views"
import type { OperationsEmailHistoryRow } from "@/lib/operations/emails"
import { isOperationsEmailKind } from "@/lib/operations/emails"
import { getBookingFormsForDeal } from "@/lib/booking-forms/queries"
import type { BookingFormAdminRow, BookingFormEventRow } from "@/lib/booking-forms/types"
import { dealSupplierKey, type DealSupplierOption } from "@/lib/crm/deal-supplier-options"

export type DealAddressDraft = {
  line1: string
  line2: string
  city: string
  postcode: string
  country: string
}

export type DealFulfilmentClient = {
  accountName: string | null
  accountType: string | null
  accountEmail: string | null
  accountPhone: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  contactJobTitle: string | null
  billingAddress: string | null
  accountBilling: DealAddressDraft
  orderClientName: string | null
  orderClientEmail: string | null
  orderClientPhone: string | null
  orderClientNationality: string | null
  dietaryRequirements: string | null
  specialRequests: string | null
  shippingAddress: string | null
  shipping: DealAddressDraft
  orderBillingAddress: string | null
  orderBilling: DealAddressDraft
}

export type DealDetailLine = DealListRow["lines"][number] & {
  packageName: string | null
  supplierName: string | null
  supplierKey: string
  supplierOptions: DealSupplierOption[]
}

export type DealNote = {
  id: string
  body: string
  actorName: string | null
  createdAt: string
}

export type DealDetailPageData = {
  deal: DealListRow
  lines: DealDetailLine[]
  client: DealFulfilmentClient
  guests: OperationsGuest[]
  notes: DealNote[]
  bookingForm: BookingFormAdminRow | null
  bookingEvents: BookingFormEventRow[]
  operationsEmails: OperationsEmailHistoryRow[]
}

function formatAddress(parts: Array<string | null | undefined>): string | null {
  const lines = parts.map((part) => String(part ?? "").trim()).filter(Boolean)
  return lines.length > 0 ? lines.join(", ") : null
}

function draftAddress(
  line1?: string | null,
  line2?: string | null,
  city?: string | null,
  postcode?: string | null,
  country?: string | null,
): DealAddressDraft {
  return {
    line1: line1 ?? "",
    line2: line2 ?? "",
    city: city ?? "",
    postcode: postcode ?? "",
    country: country ?? "",
  }
}

function textValue(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = String(value ?? "").trim()
    if (trimmed) return trimmed
  }
  return null
}

type FulfilmentDetails = {
  clientName?: string | null
  clientEmail?: string | null
  clientPhone?: string | null
  nationality?: string | null
  dietaryRequirements?: string | null
  specialRequests?: string | null
  shippingLine1?: string | null
  shippingLine2?: string | null
  shippingCity?: string | null
  shippingPostcode?: string | null
  shippingCountry?: string | null
  billingLine1?: string | null
  billingLine2?: string | null
  billingCity?: string | null
  billingPostcode?: string | null
  billingCountry?: string | null
}

function asFulfilment(value: unknown): FulfilmentDetails {
  if (!value || typeof value !== "object") return {}
  const row = value as Record<string, unknown>
  const str = (key: string) => {
    const next = row[key]
    return typeof next === "string" && next.trim() ? next.trim() : null
  }
  return {
    clientName: str("clientName"),
    clientEmail: str("clientEmail"),
    clientPhone: str("clientPhone"),
    nationality: str("nationality"),
    dietaryRequirements: str("dietaryRequirements"),
    specialRequests: str("specialRequests"),
    shippingLine1: str("shippingLine1"),
    shippingLine2: str("shippingLine2"),
    shippingCity: str("shippingCity"),
    shippingPostcode: str("shippingPostcode"),
    shippingCountry: str("shippingCountry"),
    billingLine1: str("billingLine1"),
    billingLine2: str("billingLine2"),
    billingCity: str("billingCity"),
    billingPostcode: str("billingPostcode"),
    billingCountry: str("billingCountry"),
  }
}

export async function getDealDetailPageData(dealId: string): Promise<DealDetailPageData | null> {
  noStore()
  const id = dealId.trim()
  if (!id) return null
  const [rows, booking] = await Promise.all([getDealListRows({ ids: [id] }), getBookingFormsForDeal(id)])
  const deal = rows[0]
  if (!deal) return null

  const supabase = await createClient()
  const [{ data: account }, { data: contact }, { data: order }, dealExtra, { data: noteRows }] = await Promise.all([
    deal.account_id
      ? supabase
          .from("crm_accounts")
          .select(
            "name, account_type, email, phone, billing_address_line1, billing_address_line2, billing_city, billing_postcode, billing_country",
          )
          .eq("id", deal.account_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    deal.primary_contact_id
      ? supabase
          .from("crm_contacts")
          .select("full_name, email, phone, job_title")
          .eq("id", deal.primary_contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    deal.order_id
      ? supabase
          .from("orders")
          .select(
            `
            client_name, client_email, client_phone, client_nationality,
            dietary_requirements, special_requests,
            shipping_address_line1, shipping_address_line2, shipping_city, shipping_postcode, shipping_country,
            billing_address_line1, billing_address_line2, billing_city, billing_postcode, billing_country
          `,
          )
          .eq("id", deal.order_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("deals").select("fulfilment_details").eq("id", deal.id).maybeSingle(),
    supabase
      .from("deal_activities")
      .select("id, actor_profile_id, summary, created_at")
      .eq("deal_id", deal.id)
      .eq("action", "note")
      .order("created_at", { ascending: false })
      .limit(100),
  ])
  const noteActorIds = [
    ...new Set(
      (noteRows ?? [])
        .map((row) => row.actor_profile_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const fulfilment = asFulfilment(dealExtra.data?.fulfilment_details)

  const packageIds = [...new Set(deal.lines.map((line) => line.package_id).filter(Boolean))]
  const lineSupplierIds = [
    ...new Set(deal.lines.map((line) => line.supplier_id).filter((id): id is string => Boolean(id))),
  ]
  const [{ data: guestRows }, { data: packages }, layersByPackage, lineExtraQuery, assignedQuery, { data: noteActors }] =
    await Promise.all([
      deal.order_id
        ? supabase
            .from("order_guests")
            .select(
              "id, order_id, full_name, email, phone, nationality, date_of_birth, dietary_requirements, special_requests, is_lead_guest, details_complete, sort_order",
            )
            .eq("order_id", deal.order_id)
            .order("sort_order")
        : supabase
            .from("deal_guests")
            .select(
              "id, deal_id, full_name, email, phone, nationality, date_of_birth, dietary_requirements, special_requests, is_lead_guest, details_complete, sort_order",
            )
            .eq("deal_id", deal.id)
            .order("sort_order"),
      packageIds.length
        ? supabase.from("packages").select("id, name").in("id", packageIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
      getCostLayersByPackage(packageIds),
      supabase
        .from("deal_line_items")
        .select("id, supplier_id, fulfilment_cost_layer_id, sourcing_mode")
        .eq("deal_id", deal.id),
      packageIds.length
        ? supabase
            .from("deal_line_items")
            .select("id, package_id, quantity, supplier_id, fulfilment_cost_layer_id, deals!inner(stage)")
            .in("package_id", packageIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
      noteActorIds.length
        ? supabase.from("profiles").select("id, full_name").in("id", noteActorIds)
        : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }> }),
    ])
  const packageName = new Map((packages ?? []).map((row) => [row.id, row.name]))
  const noteActorName = new Map(
    (noteActors ?? []).map((row) => [row.id, row.full_name?.trim() || null]),
  )
  const allLayers = [...layersByPackage.values()].flat()
  const poIds = [
    ...new Set(allLayers.map((layer) => layer.purchase_order_id).filter((id): id is string => Boolean(id))),
  ]
  const layerSupplierIds = [
    ...new Set(allLayers.map((layer) => layer.supplier_id).filter((id): id is string => Boolean(id))),
  ]
  const [{ data: purchaseOrders }, { data: namedSuppliers }] = await Promise.all([
    poIds.length
      ? supabase.from("purchase_orders").select("id, po_number, supplier").in("id", poIds)
      : Promise.resolve({ data: [] as Array<{ id: string; po_number: string; supplier: string }> }),
    [...new Set([...lineSupplierIds, ...layerSupplierIds])].length
      ? supabase
          .from("suppliers")
          .select("id, name")
          .in("id", [...new Set([...lineSupplierIds, ...layerSupplierIds])])
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ])
  const poById = new Map((purchaseOrders ?? []).map((row) => [row.id, row]))
  const supplierById = new Map((namedSuppliers ?? []).map((row) => [row.id, row.name]))
  let lineExtraRows = lineExtraQuery.error ? [] : (lineExtraQuery.data ?? [])
  let assignedRows = assignedQuery.error ? [] : (assignedQuery.data ?? [])
  const missingAssign = lineExtraRows.some(
    (row) =>
      !row.fulfilment_cost_layer_id &&
      String((row as { sourcing_mode?: string }).sourcing_mode ?? "owned") === "owned",
  )
  if (missingAssign) {
    await supabase.rpc("assign_deal_suppliers", { p_deal_id: deal.id })
    const [refreshedLines, refreshedAssigned] = await Promise.all([
      supabase
        .from("deal_line_items")
        .select("id, supplier_id, fulfilment_cost_layer_id, sourcing_mode")
        .eq("deal_id", deal.id),
      packageIds.length
        ? supabase
            .from("deal_line_items")
            .select("id, package_id, quantity, supplier_id, fulfilment_cost_layer_id, deals!inner(stage)")
            .in("package_id", packageIds)
        : Promise.resolve({ data: assignedRows, error: null }),
    ])
    if (!refreshedLines.error) lineExtraRows = refreshedLines.data ?? lineExtraRows
    if (!refreshedAssigned.error) assignedRows = refreshedAssigned.data ?? assignedRows
  }
  const lineExtra = new Map(
    lineExtraRows.map((row) => [
      String(row.id),
      {
        supplierId: (row.supplier_id as string | null) ?? null,
        costLayerId: (row.fulfilment_cost_layer_id as string | null) ?? null,
      },
    ]),
  )

  type LayerMeta = {
    id: string
    packageId: string
    remaining: number
    unitCost: number
    supplierId: string | null
    supplierName: string
    key: string
  }
  const layerMeta: LayerMeta[] = allLayers.map((layer) => {
    const po = layer.purchase_order_id ? poById.get(layer.purchase_order_id) : null
    const supplierId = layer.supplier_id ?? null
    const supplierName =
      po?.supplier?.trim() ||
      (layer.supplier_id ? supplierById.get(layer.supplier_id) : null) ||
      layer.source?.trim() ||
      "Unassigned"
    return {
      id: layer.id,
      packageId: layer.package_id,
      remaining: Math.max(0, layer.quantity_remaining),
      unitCost: layer.unit_cost,
      supplierId,
      supplierName,
      key: dealSupplierKey({
        supplierId: layer.supplier_id,
        source: po?.supplier || layer.source,
        layerId: layer.id,
      }),
    }
  })
  const layerById = new Map(layerMeta.map((layer) => [layer.id, layer]))

  const assignedByPackageKey = new Map<string, number>()
  for (const row of assignedRows) {
    const dealJoin = (row as { deals?: { stage?: string } | Array<{ stage?: string }> }).deals
    const dealStage = Array.isArray(dealJoin) ? dealJoin[0]?.stage : dealJoin?.stage
    if (["cancelled", "closed_lost"].includes(String(dealStage ?? ""))) continue
    const packageId = String(row.package_id)
    const layer = row.fulfilment_cost_layer_id ? layerById.get(String(row.fulfilment_cost_layer_id)) : null
    const key = layer?.key
      ?? dealSupplierKey({
        supplierId: (row.supplier_id as string | null) ?? null,
        source: null,
      })
    if (key === "unassigned") continue
    const mapKey = `${packageId}:${key}`
    assignedByPackageKey.set(mapKey, (assignedByPackageKey.get(mapKey) ?? 0) + Number(row.quantity ?? 0))
  }

  function optionsForPackage(packageId: string): DealSupplierOption[] {
    const grouped = new Map<string, DealSupplierOption>()
    for (const layer of layerMeta.filter((item) => item.packageId === packageId && item.remaining > 0)) {
      const current = grouped.get(layer.key)
      if (current) {
        current.remaining += layer.remaining
        if (layer.remaining > (current.remaining - layer.remaining)) {
          current.costLayerId = layer.id
          current.unitCost = layer.unitCost
          current.supplierId = layer.supplierId
        }
        continue
      }
      grouped.set(layer.key, {
        key: layer.key,
        supplierName: layer.supplierName,
        remaining: layer.remaining,
        costLayerId: layer.id,
        supplierId: layer.supplierId,
        unitCost: layer.unitCost,
      })
    }
    return [...grouped.values()]
      .map((option) => ({
        ...option,
        remaining: Math.max(
          0,
          option.remaining - (assignedByPackageKey.get(`${packageId}:${option.key}`) ?? 0),
        ),
      }))
      .sort((a, b) => a.supplierName.localeCompare(b.supplierName))
  }

  const { data: operationsEmailRows, error: operationsEmailError } = await supabase
    .from("operations_emails")
    .select("id, deal_id, order_id, kind, to_email, to_name, subject, sent_at, sent_by")
    .eq("deal_id", dealId)
    .order("sent_at", { ascending: false })
    .limit(40)
  const senderIds = operationsEmailError
    ? []
    : [
        ...new Set(
          (operationsEmailRows ?? [])
            .map((row) => row.sent_by)
            .filter((id): id is string => Boolean(id)),
        ),
      ]
  const senderNames = new Map<string, string>()
  if (senderIds.length) {
    const { data: senders } = await supabase.from("profiles").select("id, full_name").in("id", senderIds)
    for (const profile of senders ?? []) {
      senderNames.set(String(profile.id), String(profile.full_name ?? "").trim())
    }
  }
  const operationsEmails: OperationsEmailHistoryRow[] = operationsEmailError
    ? []
    : ((operationsEmailRows ?? []) as Array<{
    id: string
    deal_id: string | null
    order_id: string | null
    kind: string
    to_email: string
    to_name: string | null
    subject: string
    sent_at: string
    sent_by: string | null
  }>)
    .filter((row) => isOperationsEmailKind(row.kind))
    .map((row) => ({
      id: String(row.id),
      dealId: row.deal_id ? String(row.deal_id) : null,
      orderId: row.order_id ? String(row.order_id) : null,
      kind: row.kind,
      toEmail: String(row.to_email),
      toName: row.to_name ? String(row.to_name) : null,
      subject: String(row.subject),
      sentAt: String(row.sent_at),
      sentByName: row.sent_by ? senderNames.get(row.sent_by) || null : null,
    }))

  return {
    deal,
    lines: deal.lines.map((line) => {
      const extra = lineExtra.get(line.id)
      const selectedLayer = extra?.costLayerId ? layerById.get(extra.costLayerId) : null
      const supplierKey = selectedLayer?.key
        ?? dealSupplierKey({
          supplierId: extra?.supplierId ?? line.supplier_id,
          source: null,
        })
      const options = optionsForPackage(line.package_id)
      const selected = options.find((option) => option.key === supplierKey)
      if (supplierKey !== "unassigned" && !selected) {
        options.unshift({
          key: supplierKey,
          supplierName:
            selectedLayer?.supplierName ||
            (line.supplier_id ? supplierById.get(line.supplier_id) : null) ||
            "Selected supplier",
          remaining: 0,
          costLayerId: extra?.costLayerId ?? null,
          supplierId: extra?.supplierId ?? line.supplier_id,
          unitCost: selectedLayer?.unitCost ?? line.expected_unit_cost,
        })
      }
      return {
        ...line,
        packageName: packageName.get(line.package_id) ?? null,
        supplierName: selected?.supplierName
          ?? (line.supplier_id ? supplierById.get(line.supplier_id) ?? null : null),
        supplierKey: selected?.key ?? (supplierKey === "unassigned" ? "" : supplierKey),
        supplierOptions: options,
      }
    }),
    client: {
      accountName: account?.name ?? deal.account_name,
      accountType: account?.account_type ?? null,
      accountEmail: account?.email ?? null,
      accountPhone: account?.phone ?? null,
      contactName: contact?.full_name ?? deal.contact_name,
      contactEmail: contact?.email ?? null,
      contactPhone: contact?.phone ?? null,
      contactJobTitle: contact?.job_title ?? null,
      billingAddress: formatAddress([
        account?.billing_address_line1,
        account?.billing_address_line2,
        account?.billing_city,
        account?.billing_postcode,
        account?.billing_country,
      ]),
      accountBilling: draftAddress(
        account?.billing_address_line1,
        account?.billing_address_line2,
        account?.billing_city,
        account?.billing_postcode,
        account?.billing_country,
      ),
      orderClientName: textValue(order?.client_name, fulfilment.clientName),
      orderClientEmail: textValue(order?.client_email, fulfilment.clientEmail),
      orderClientPhone: textValue(order?.client_phone, fulfilment.clientPhone),
      orderClientNationality: textValue(order?.client_nationality, fulfilment.nationality),
      dietaryRequirements: textValue(order?.dietary_requirements, fulfilment.dietaryRequirements),
      specialRequests: textValue(order?.special_requests, fulfilment.specialRequests),
      shippingAddress: formatAddress([
        order?.shipping_address_line1 ?? fulfilment.shippingLine1,
        order?.shipping_address_line2 ?? fulfilment.shippingLine2,
        order?.shipping_city ?? fulfilment.shippingCity,
        order?.shipping_postcode ?? fulfilment.shippingPostcode,
        order?.shipping_country ?? fulfilment.shippingCountry,
      ]),
      shipping: draftAddress(
        order?.shipping_address_line1 ?? fulfilment.shippingLine1,
        order?.shipping_address_line2 ?? fulfilment.shippingLine2,
        order?.shipping_city ?? fulfilment.shippingCity,
        order?.shipping_postcode ?? fulfilment.shippingPostcode,
        order?.shipping_country ?? fulfilment.shippingCountry,
      ),
      orderBillingAddress: formatAddress([
        order?.billing_address_line1 ?? fulfilment.billingLine1,
        order?.billing_address_line2 ?? fulfilment.billingLine2,
        order?.billing_city ?? fulfilment.billingCity,
        order?.billing_postcode ?? fulfilment.billingPostcode,
        order?.billing_country ?? fulfilment.billingCountry,
      ]),
      orderBilling: draftAddress(
        order?.billing_address_line1 ?? fulfilment.billingLine1,
        order?.billing_address_line2 ?? fulfilment.billingLine2,
        order?.billing_city ?? fulfilment.billingCity,
        order?.billing_postcode ?? fulfilment.billingPostcode,
        order?.billing_country ?? fulfilment.billingCountry,
      ),
    },
    guests: (guestRows ?? []).map((row) => ({
      id: String(row.id),
      orderId: deal.order_id ?? null,
      dealId: deal.order_id ? null : deal.id,
      fullName: (row.full_name as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      nationality: (row.nationality as string | null) ?? null,
      dateOfBirth: (row.date_of_birth as string | null) ?? null,
      dietaryRequirements: (row.dietary_requirements as string | null) ?? null,
      specialRequests: (row.special_requests as string | null) ?? null,
      isLeadGuest: Boolean(row.is_lead_guest),
      detailsComplete: Boolean(row.details_complete),
      sortOrder: Number(row.sort_order),
    })),
    notes: (noteRows ?? []).map((row) => ({
      id: String(row.id),
      body: String(row.summary),
      actorName: row.actor_profile_id ? noteActorName.get(String(row.actor_profile_id)) ?? null : null,
      createdAt: String(row.created_at),
    })),
    bookingForm: booking.form,
    bookingEvents: booking.events,
    operationsEmails,
  }
}
