import { unstable_noStore as noStore } from "next/cache"
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows"
import { createClient } from "@/lib/supabase/server"
import type { CrmAccountOption, DealListRow, DealStage, PackageDealSaleRow } from "@/lib/crm/deal-types"
import { dealStageCountsAsSold } from "@/lib/crm/deal-types"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import { costLayerSupplierPoolKey } from "@/lib/inventory/supplier-pool"

export type { DealListRow, DealStage } from "@/lib/crm/deal-types"
export { DEAL_STAGE_LABELS } from "@/lib/crm/deal-types"

export type CrmCompanyOption = {
  id: string
  name: string
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

type AccountOptionRow = { id: string; name: string }
type AccountOptionContactRow = {
  id: string
  account_id: string
  full_name: string
  email: string | null
  phone: string | null
  active: boolean
}

export async function getCrmAccountOptions(): Promise<CrmAccountOption[]> {
  noStore()
  const supabase = await createClient()
  const [accountsRes, contactsRes] = await Promise.all([
    fetchAllRows<AccountOptionRow>((from, to) =>
      supabase.from("crm_accounts").select("id, name").eq("active", true).order("id").range(from, to),
    ),
    fetchAllRows<AccountOptionContactRow>((from, to) =>
      supabase
        .from("crm_contacts")
        .select("id, account_id, full_name, email, phone, active")
        .eq("active", true)
        .order("id")
        .range(from, to),
    ),
  ])

  if (accountsRes.error || contactsRes.error) return []

  const contactsByAccount = new Map<
    string,
    Array<{ id: string; full_name: string; email: string | null; phone: string | null }>
  >()
  for (const contact of contactsRes.data) {
    const list = contactsByAccount.get(contact.account_id) ?? []
    list.push({
      id: contact.id,
      full_name: contact.full_name,
      email: contact.email,
      phone: contact.phone,
    })
    contactsByAccount.set(contact.account_id, list)
  }

  return accountsRes.data
    .map((account) => ({
      id: account.id,
      name: account.name,
      contacts: (contactsByAccount.get(account.id) ?? []).sort((a, b) =>
        a.full_name.localeCompare(b.full_name),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function getCrmCompanyOptions(): Promise<CrmCompanyOption[]> {
  noStore()
  const supabase = await createClient()
  const { data, error } = await fetchAllRows<AccountOptionRow>((from, to) =>
    supabase.from("crm_accounts").select("id, name").eq("active", true).order("id").range(from, to),
  )

  if (error) return []
  return data
    .map((account) => ({ id: account.id, name: account.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function getDealListRows(options?: { ids?: string[] }): Promise<DealListRow[]> {
  noStore()
  const supabase = await createClient()
  const ids = [...new Set((options?.ids ?? []).map((id) => id.trim()).filter(Boolean))]
  let query = supabase
    .from("deals")
    .select(`
      id, account_id, primary_contact_id, reference, stage, source, currency, total_amount, expected_close_date, next_action,
      next_action_due_at, loss_reason, hold_expires_at, do_not_expire, notes, created_at,
      updated_at, created_by, owner_profile_id, race_id, order_id,
      crm_accounts(name),
      crm_contacts(full_name),
      deal_line_items(
        id, package_id, quantity, unit_sale_price, expected_unit_cost,
        sourcing_mode, supplier_id, supplier_quote_at,
        reservation_status, packages(name, race_id, races(name, season))
      )
    `)
    .order("reference", { ascending: false })
  query = ids.length > 0 ? query.in("id", ids) : query.limit(5000)
  const { data, error } = await query

  if (error || !data) return []

  const ownerIds = [...new Set(data.map((row) => row.owner_profile_id).filter(Boolean))] as string[]
  const createdByIds = [...new Set(data.map((row) => row.created_by).filter(Boolean))] as string[]
  const lineRaceIds = data.flatMap((row) =>
    ((row.deal_line_items ?? []) as Array<{ packages: unknown }>).map((line) => {
      const pkg = one(line.packages as { race_id: string } | { race_id: string }[] | null)
      return pkg?.race_id ?? null
    }),
  )
  const raceIds = [
    ...new Set(
      [...data.map((row) => row.race_id), ...lineRaceIds].filter((id): id is string => Boolean(id)),
    ),
  ]
  const orderIds = [...new Set(data.map((row) => row.order_id).filter(Boolean))] as string[]
  const dealIds = data.map((row) => row.id)

  const [{ data: races }, { data: orders }, { data: activities }] = await Promise.all([
    raceIds.length
      ? supabase.from("races").select("id, name, season, event_date").in("id", raceIds)
      : Promise.resolve({
          data: [] as Array<{ id: string; name: string; season: number; event_date: string | null }>,
        }),
    orderIds.length
      ? supabase
          .from("orders")
          .select(`
            id, reference,
            invoices(
              id, status, xero_invoice_id, xero_invoice_number, xero_sync_status,
              xero_sync_error, due_date, invoice_emailed_at, invoice_email_error,
              payment_reminder_count, last_payment_reminder_at,
              payment_reminder_error, cancellation_eligible_at
            )
          `)
          .in("id", orderIds)
      : Promise.resolve({ data: [] }),
    dealIds.length
      ? supabase
          .from("deal_activities")
          .select("id, deal_id, actor_profile_id, action, summary, created_at")
          .in("deal_id", dealIds)
          .order("created_at", { ascending: false })
          .limit(2000)
      : Promise.resolve({
          data: [] as Array<{
            id: string
            deal_id: string
            actor_profile_id: string | null
            action: string
            summary: string
            created_at: string
          }>,
        }),
  ])

  const actorIds = [
    ...new Set(
      (activities ?? [])
        .map((row) => row.actor_profile_id)
        .filter(Boolean),
    ),
  ] as string[]
  const profileIds = [...new Set([...ownerIds, ...createdByIds, ...actorIds])]
  const { data: owners } = profileIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", profileIds)
    : { data: [] as Array<{ id: string; full_name: string | null }> }

  const ownerName = new Map(
    (owners ?? []).map((row) => [row.id, row.full_name?.trim() || null]),
  )
  const raceName = new Map(
    (races ?? []).map((row) => [row.id, eventSeasonLabel(row.name, row.season)]),
  )
  const raceDate = new Map((races ?? []).map((row) => [row.id, row.event_date ?? null]))
  const orderMap = new Map((orders ?? []).map((row) => [String(row.id), row]))
  const activitiesByDeal = new Map<
    string,
    Array<{
      id: string
      actor_name: string | null
      summary: string
      created_at: string
    }>
  >()
  for (const activity of activities ?? []) {
    const list = activitiesByDeal.get(activity.deal_id) ?? []
    if (list.length >= 5) continue
    list.push({
      id: activity.id,
      actor_name: activity.actor_profile_id
        ? ownerName.get(activity.actor_profile_id) ?? null
        : null,
      summary: activity.summary,
      created_at: activity.created_at,
    })
    activitiesByDeal.set(activity.deal_id, list)
  }

  return data.map((row) => {
    const account = one(row.crm_accounts as { name: string } | { name: string }[] | null)
    const contact = one(row.crm_contacts as { full_name: string } | { full_name: string }[] | null)
    const lines = (row.deal_line_items ?? []) as Array<{
      id: string
      package_id: string
      quantity: number
      unit_sale_price: number
      expected_unit_cost: number | null
      sourcing_mode: "owned" | "brokered"
      supplier_id: string | null
      supplier_quote_at: string | null
      reservation_status: string
      packages:
        | { name: string; race_id: string; races: { name: string; season: number } | Array<{ name: string; season: number }> | null }
        | Array<{ name: string; race_id: string; races: { name: string; season: number } | Array<{ name: string; season: number }> | null }>
        | null
    }>
    const lineSummary = lines
      .map((line) => {
        const pkg = one(line.packages)
        return `${line.quantity}× ${pkg?.name ?? "Package"}`
      })
      .join(", ")
    const lineEvents = [
      ...new Map(
        [
          row.race_id
            ? ([
                row.race_id,
                {
                  id: row.race_id,
                  label: raceName.get(row.race_id) ?? row.race_id,
                  eventDate: raceDate.get(row.race_id) ?? null,
                },
              ] as const)
            : null,
          ...lines.map((line) => {
            const pkg = one(line.packages)
            const race = one(pkg?.races)
            if (!pkg?.race_id) return null
            return [
              pkg.race_id,
              {
                id: pkg.race_id,
                label:
                  raceName.get(pkg.race_id) ??
                  (race ? eventSeasonLabel(race.name, race.season) : pkg.race_id),
                eventDate: raceDate.get(pkg.race_id) ?? null,
              },
            ] as const
          }),
        ].filter(
          (
            entry,
          ): entry is readonly [string, { id: string; label: string; eventDate: string | null }] =>
            Boolean(entry),
        ),
      ).values(),
    ].sort((a, b) => {
      if (a.eventDate && b.eventDate && a.eventDate !== b.eventDate) {
        return a.eventDate.localeCompare(b.eventDate)
      }
      if (a.eventDate) return -1
      if (b.eventDate) return 1
      return a.label.localeCompare(b.label)
    })
    const effectiveRaceId = row.race_id ?? (lineEvents.length === 1 ? lineEvents[0].id : null)
    const order = row.order_id ? orderMap.get(String(row.order_id)) : null
    const invoice = one(
      (order?.invoices ?? null) as
        | {
            id: string
            status: string
            xero_invoice_id: string | null
            xero_invoice_number: string | null
            xero_sync_status: string | null
            xero_sync_error: string | null
            due_date: string | null
            invoice_emailed_at: string | null
            invoice_email_error: string | null
            payment_reminder_count: number
            last_payment_reminder_at: string | null
            payment_reminder_error: string | null
            cancellation_eligible_at: string | null
          }
        | Array<{
            id: string
            status: string
            xero_invoice_id: string | null
            xero_invoice_number: string | null
            xero_sync_status: string | null
            xero_sync_error: string | null
            due_date: string | null
            invoice_emailed_at: string | null
            invoice_email_error: string | null
            payment_reminder_count: number
            last_payment_reminder_at: string | null
            payment_reminder_error: string | null
            cancellation_eligible_at: string | null
          }>
        | null,
    )

    return {
      id: row.id,
      account_id: row.account_id,
      primary_contact_id: row.primary_contact_id,
      race_id: effectiveRaceId,
      reference: row.reference,
      stage: row.stage as DealStage,
      source: row.source,
      currency: row.currency,
      total_amount: Number(row.total_amount ?? 0),
      expected_close_date: row.expected_close_date,
      next_action: row.next_action,
      next_action_due_at: row.next_action_due_at,
      loss_reason: row.loss_reason,
      hold_expires_at: row.hold_expires_at,
      do_not_expire: Boolean(row.do_not_expire),
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by ?? null,
      created_by_name: row.created_by ? ownerName.get(row.created_by) ?? null : null,
      recent_activities: activitiesByDeal.get(row.id) ?? [],
      account_name: account?.name ?? null,
      contact_name: contact?.full_name ?? null,
      owner_profile_id: row.owner_profile_id,
      owner_name: row.owner_profile_id ? ownerName.get(row.owner_profile_id) ?? null : null,
      race_name: lineEvents.length > 0 ? lineEvents.map((event) => event.label).join(", ") : null,
      events: lineEvents,
      line_summary: lineSummary || null,
      lines: lines.map((line) => ({
        id: line.id,
        package_id: line.package_id,
        quantity: Number(line.quantity),
        unit_sale_price: Number(line.unit_sale_price),
        expected_unit_cost:
          line.expected_unit_cost == null ? null : Number(line.expected_unit_cost),
        sourcing_mode: line.sourcing_mode ?? "owned",
        supplier_id: line.supplier_id ?? null,
        supplier_quote_at: line.supplier_quote_at ?? null,
      })),
      reserved_qty: lines
        .filter((line) => line.reservation_status === "active")
        .reduce((sum, line) => sum + Number(line.quantity ?? 0), 0),
      gross_profit: lines.length > 0 && lines.every((line) => line.expected_unit_cost != null)
        ? lines.reduce(
            (sum, line) =>
              sum +
              (Number(line.unit_sale_price) - Number(line.expected_unit_cost)) *
                Number(line.quantity),
            0,
          )
        : null,
      margin:
        lines.length > 0 &&
        lines.every((line) => line.expected_unit_cost != null) &&
        Number(row.total_amount) > 0
          ? lines.reduce(
              (sum, line) =>
                sum +
                (Number(line.unit_sale_price) - Number(line.expected_unit_cost)) *
                  Number(line.quantity),
              0,
            ) / Number(row.total_amount)
          : null,
      order_id: row.order_id,
      order_reference: order?.reference ? String(order.reference) : null,
      invoice_id: invoice?.id ?? null,
      invoice_status: invoice?.status ?? null,
      xero_invoice_id: invoice?.xero_invoice_id ?? null,
      xero_invoice_number: invoice?.xero_invoice_number ?? null,
      xero_sync_status: invoice?.xero_sync_status ?? null,
      xero_sync_error: invoice?.xero_sync_error ?? null,
      invoice_due_date: invoice?.due_date ?? null,
      invoice_emailed_at: invoice?.invoice_emailed_at ?? null,
      invoice_email_error: invoice?.invoice_email_error ?? null,
      payment_reminder_count: Number(invoice?.payment_reminder_count ?? 0),
      last_payment_reminder_at: invoice?.last_payment_reminder_at ?? null,
      payment_reminder_error: invoice?.payment_reminder_error ?? null,
      cancellation_eligible_at: invoice?.cancellation_eligible_at ?? null,
    }
  })
}

export type { PackageDealSaleRow } from "@/lib/crm/deal-types"

type PackageDealQueryRow = {
  id: string
  package_id: string
  quantity: number
  unit_sale_price: number
  expected_unit_cost: number | null
  sourcing_mode: "owned" | "brokered" | null
  supplier_id: string | null
  reservation_status: string | null
  packages: { name: string } | { name: string }[] | null
  deals:
    | {
        id: string
        reference: string
        stage: string
        source: string
        currency: string
        created_at: string
        updated_at: string
        notes: string | null
        owner_profile_id: string | null
        race_id: string | null
        expected_close_date: string | null
        next_action: string | null
        next_action_due_at: string | null
        hold_expires_at: string | null
        do_not_expire: boolean | null
        order_id: string | null
        account_id: string | null
        primary_contact_id: string | null
        crm_accounts: { name: string } | { name: string }[] | null
        crm_contacts: { full_name: string } | { full_name: string }[] | null
      }
    | Array<{
        id: string
        reference: string
        stage: string
        source: string
        currency: string
        created_at: string
        updated_at: string
        notes: string | null
        owner_profile_id: string | null
        race_id: string | null
        expected_close_date: string | null
        next_action: string | null
        next_action_due_at: string | null
        hold_expires_at: string | null
        do_not_expire: boolean | null
        order_id: string | null
        account_id: string | null
        primary_contact_id: string | null
        crm_accounts: { name: string } | { name: string }[] | null
        crm_contacts: { full_name: string } | { full_name: string }[] | null
      }>
    | null
}

export async function getDealsForPackage(packageId: string): Promise<PackageDealSaleRow[]> {
  return getDealsForPackages([packageId])
}

export async function getDealsForPackages(packageIds: readonly string[]): Promise<PackageDealSaleRow[]> {
  noStore()
  const ids = [...new Set(packageIds.map((id) => id.trim()).filter(Boolean))]
  if (!ids.length) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("deal_line_items")
    .select(
      `
      id, package_id, quantity, unit_sale_price, expected_unit_cost,
      sourcing_mode, supplier_id, reservation_status,
      packages(name),
      deals!inner(
        id, reference, stage, source, currency, created_at, updated_at, notes,
        owner_profile_id, race_id, expected_close_date, next_action, next_action_due_at,
        hold_expires_at, do_not_expire, order_id, account_id, primary_contact_id,
        crm_accounts(name),
        crm_contacts(full_name)
      )
    `,
    )
    .in("package_id", ids)

  if (error || !data) return []

  const rows = data as PackageDealQueryRow[]
  const { data: fulfilmentRows } = await supabase
    .from("deal_line_inventory_fulfilment")
    .select(
      "deal_line_item_id,fully_allocated,supplier_id,cost_layer_id,supplier_label,weighted_unit_cost",
    )
    .in("deal_line_item_id", rows.map((row) => row.id))
  const fulfilmentByLine = new Map(
    (fulfilmentRows ?? []).map((row) => [String(row.deal_line_item_id), row]),
  )
  const lineIds = rows.map((row) => row.id)
  const { data: allocationRows } = await supabase
    .from("inventory_allocations")
    .select("deal_line_item_id,cost_layer_id,quantity")
    .in("deal_line_item_id", lineIds)
    .in("state", ["reserved", "committed"])
  const allocationLayerIds = [
    ...new Set(
      (allocationRows ?? [])
        .map((allocation) => allocation.cost_layer_id)
        .filter((value): value is string => !!value),
    ),
  ]
  const { data: allocationLayers } = allocationLayerIds.length
    ? await supabase
        .from("package_cost_layers")
        .select("id,source,supplier_id,purchase_order_id")
        .in("id", allocationLayerIds)
    : { data: [] as Array<{
        id: string
        source: string | null
        supplier_id: string | null
        purchase_order_id: string | null
      }> }
  const allocationPurchaseOrderIds = [
    ...new Set(
      (allocationLayers ?? [])
        .map((layer) => layer.purchase_order_id)
        .filter((value): value is string => !!value),
    ),
  ]
  const { data: allocationPurchaseOrders } = allocationPurchaseOrderIds.length
    ? await supabase
        .from("purchase_orders")
        .select("id,supplier,supplier_id")
        .in("id", allocationPurchaseOrderIds)
    : { data: [] as Array<{
        id: string
        supplier: string
        supplier_id: string | null
      }> }
  const allocationPurchaseOrderById = new Map(
    (allocationPurchaseOrders ?? []).map((order) => [order.id, order]),
  )
  const allocationLayerById = new Map(
    (allocationLayers ?? []).map((layer) => {
      const purchase = layer.purchase_order_id
        ? allocationPurchaseOrderById.get(layer.purchase_order_id)
        : null
      const name = (purchase?.supplier || layer.source || "Unassigned").trim()
      return [
        layer.id,
        {
          key: costLayerSupplierPoolKey({
            layerSupplierId: layer.supplier_id,
            purchaseSupplierId: purchase?.supplier_id,
            purchaseSupplier: purchase?.supplier,
            layerSource: layer.source,
          }) || `name:${name.toLowerCase()}`,
          name,
        },
      ]
    }),
  )
  const allocationsByLine = new Map<
    string,
    Map<string, { key: string; name: string; quantity: number }>
  >()
  for (const allocation of allocationRows ?? []) {
    const layer = allocation.cost_layer_id
      ? allocationLayerById.get(allocation.cost_layer_id)
      : null
    if (!layer) continue
    const lineId = String(allocation.deal_line_item_id)
    const bySupplier =
      allocationsByLine.get(lineId) ??
      new Map<string, { key: string; name: string; quantity: number }>()
    const current = bySupplier.get(layer.key)
    if (current) {
      current.quantity += Math.max(0, Math.floor(Number(allocation.quantity) || 0))
    } else {
      bySupplier.set(layer.key, {
        ...layer,
        quantity: Math.max(0, Math.floor(Number(allocation.quantity) || 0)),
      })
    }
    allocationsByLine.set(lineId, bySupplier)
  }
  const supplierIds = [
    ...new Set(
      [
        ...rows.map((row) => row.supplier_id),
        ...(fulfilmentRows ?? []).map((row) => row.supplier_id),
      ].filter((value): value is string => !!value),
    ),
  ]
  const ownerIds = [
    ...new Set(
      rows
        .map((row) => one(row.deals)?.owner_profile_id)
        .filter((value): value is string => !!value),
    ),
  ]
  const orderIds = [
    ...new Set(
      rows.map((row) => one(row.deals)?.order_id).filter((value): value is string => !!value),
    ),
  ]
  const raceIds = [
    ...new Set(
      rows.map((row) => one(row.deals)?.race_id).filter((value): value is string => !!value),
    ),
  ]
  const [{ data: suppliers }, { data: owners }, { data: orders }, { data: races }] = await Promise.all([
    supplierIds.length
      ? supabase.from("suppliers").select("id, name").in("id", supplierIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    ownerIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", ownerIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
    orderIds.length
      ? supabase.from("orders").select("id, reference").in("id", orderIds)
      : Promise.resolve({ data: [] as Array<{ id: string; reference: string }> }),
    raceIds.length
      ? supabase.from("races").select("id, name, season").in("id", raceIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; season: number }> }),
  ])
  const supplierName = new Map((suppliers ?? []).map((row) => [row.id, row.name]))
  const ownerName = new Map((owners ?? []).map((row) => [row.id, row.full_name]))
  const orderRef = new Map((orders ?? []).map((row) => [row.id, row.reference]))
  const raceName = new Map(
    (races ?? []).map((row) => [row.id, eventSeasonLabel(row.name, row.season)]),
  )

  const byDeal = new Map<string, PackageDealSaleRow>()
  for (const row of rows) {
    const deal = one(row.deals)
    if (!deal || deal.stage === "cancelled" || deal.stage === "closed_lost") continue
    const quantity = Math.max(0, Math.floor(Number(row.quantity) || 0))
    const unitSalePrice = Number(row.unit_sale_price ?? 0)
    const sourcingMode = (row.sourcing_mode ?? "owned") as "owned" | "brokered"
    const fulfilment = fulfilmentByLine.get(row.id)
    const fullyAllocated = Boolean(fulfilment?.fully_allocated)
    const expectedUnitCost = sourcingMode === "brokered"
      ? row.expected_unit_cost == null ? null : Number(row.expected_unit_cost)
      : fullyAllocated && fulfilment?.weighted_unit_cost != null
        ? Number(fulfilment.weighted_unit_cost)
        : null
    const allocatedSupplierId =
      fullyAllocated && typeof fulfilment?.supplier_id === "string"
        ? fulfilment.supplier_id
        : null
    const allocatedSupplierLabel =
      fullyAllocated && typeof fulfilment?.supplier_label === "string"
        ? fulfilment.supplier_label
        : null
    const supplierAllocations = [
      ...(allocationsByLine.get(row.id)?.values() ?? []),
    ].filter((allocation) => allocation.quantity > 0)
    const allocatedSupplierKey =
      supplierAllocations.length === 1
        ? supplierAllocations[0].key
        : allocatedSupplierId
          ? `id:${allocatedSupplierId}`
          : allocatedSupplierLabel && !allocatedSupplierLabel.includes(" · ")
            ? `name:${allocatedSupplierLabel.replace(/^\d+x\s+/i, "").trim().toLowerCase()}`
            : ""
    const lineTotal = quantity * unitSalePrice
    const pkg = one(row.packages)
    const line = {
      id: row.id,
      packageId: row.package_id,
      packageName: pkg?.name ?? null,
      quantity,
      unitSalePrice,
      expectedUnitCost,
      sourcingMode,
      supplierId: sourcingMode === "brokered" ? row.supplier_id : allocatedSupplierId,
      supplierName: sourcingMode === "brokered"
        ? row.supplier_id ? supplierName.get(row.supplier_id) ?? null : null
        : allocatedSupplierLabel,
      supplierKey: sourcingMode === "owned" ? allocatedSupplierKey : "",
      supplierAllocations: sourcingMode === "owned" ? supplierAllocations : [],
      costLayerId:
        sourcingMode === "owned" &&
        fullyAllocated &&
        typeof fulfilment?.cost_layer_id === "string"
          ? fulfilment.cost_layer_id
          : null,
    }
    const existing = byDeal.get(deal.id)
    if (existing) {
      existing.quantity += quantity
      existing.totalAmount += lineTotal
      existing.lines.push(line)
      if (row.reservation_status === "active") existing.reservedQty += quantity
      continue
    }
    const account = one(deal.crm_accounts)
    const contact = one(deal.crm_contacts)
    byDeal.set(deal.id, {
      id: deal.id,
      reference: deal.reference,
      accountId: deal.account_id ?? null,
      contactId: deal.primary_contact_id ?? null,
      accountName: account?.name ?? null,
      contactName: contact?.full_name ?? null,
      quantity,
      totalAmount: lineTotal,
      currency: deal.currency || "USD",
      stage: deal.stage as DealStage,
      source: deal.source || "offline",
      createdAt: deal.created_at,
      updatedAt: deal.updated_at,
      notes: deal.notes,
      ownerName: deal.owner_profile_id ? ownerName.get(deal.owner_profile_id) ?? null : null,
      raceName: deal.race_id ? raceName.get(deal.race_id) ?? null : null,
      lineSummary: `${quantity}× ${pkg?.name ?? "Package"}`,
      expectedCloseDate: deal.expected_close_date,
      nextAction: deal.next_action,
      nextActionDueAt: deal.next_action_due_at,
      reservedQty: row.reservation_status === "active" ? quantity : 0,
      holdExpiresAt: deal.hold_expires_at,
      doNotExpire: Boolean(deal.do_not_expire),
      orderId: deal.order_id,
      orderReference: deal.order_id ? orderRef.get(deal.order_id) ?? null : null,
      lines: [line],
      cogs: null,
      grossProfit: null,
      margin: null,
      supplierLabel: null,
    })
  }

  return [...byDeal.values()]
    .map((deal) => {
      const lineSummary = deal.lines
        .map((line) => `${line.quantity}× ${line.packageName ?? "Package"}`)
        .join(", ")
      const namedSuppliers = [
        ...new Set(deal.lines.map((line) => line.supplierName?.trim()).filter(Boolean) as string[]),
      ]
      const costed = deal.lines.length > 0 && deal.lines.every((line) => line.expectedUnitCost != null)
      const cogs = costed
        ? deal.lines.reduce(
            (sum, line) => sum + Number(line.expectedUnitCost) * line.quantity,
            0,
          )
        : null
      const grossProfit = cogs == null ? null : deal.totalAmount - cogs
      return {
        ...deal,
        lineSummary: lineSummary || deal.lineSummary,
        supplierLabel: namedSuppliers.length > 0 ? namedSuppliers.join(" · ") : null,
        cogs,
        grossProfit,
        margin:
          grossProfit == null || deal.totalAmount <= 0 ? null : grossProfit / deal.totalAmount,
      }
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function isPackageSoldDealStage(stage: string): boolean {
  return dealStageCountsAsSold(stage)
}
