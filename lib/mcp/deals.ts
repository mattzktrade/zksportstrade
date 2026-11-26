import type { SupabaseClient } from "@supabase/supabase-js"
import { sellableFromAvailability } from "@/lib/assistant/availability"
import { likeContains } from "@/lib/admin/ranked-search"
import { canonicalDealSource, DEAL_SOURCES } from "@/lib/crm/deal-types"
import {
  parseDealInvoiceCurrency,
  persistDealInvoicePricing,
  preparePricedInvoiceLine,
  resolveDealInvoiceFxRate,
} from "@/lib/crm/deal-invoice-currency"
import { loadNativePackageAvailability } from "@/lib/inventory/ledger"
import { loadMcpDealPriceFloor } from "@/lib/mcp/settings"
import {
  canAssistantUpdateDealStage,
  crmStageForMcpStatus,
  crmStagesForMcpStatus,
  enquiryStageForMcpStatus,
  isMcpDealStatus,
  mcpStatusFromCrmStage,
} from "@/lib/mcp/status"
import { McpToolError, type McpApiKey, type McpDealStatus } from "@/lib/mcp/types"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requireUuid(id: string, label: string): string {
  const value = id.trim()
  if (!UUID_RE.test(value)) throw new McpToolError(`${label} is not a valid id.`)
  return value
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function mapDeal(row: Record<string, unknown>, ownerName: string | null = null) {
  const account = one(row.crm_accounts as { name?: string } | { name?: string }[] | null)
  const contact = one(
    row.crm_contacts as
      | { id?: string; full_name?: string; email?: string }
      | { id?: string; full_name?: string; email?: string }[]
      | null,
  )
  const linesRaw = Array.isArray(row.deal_line_items) ? row.deal_line_items : []
  const lines = linesRaw.map((line) => {
    const record = line as Record<string, unknown>
    const pkg = one(record.packages as { name?: string } | { name?: string }[] | null)
    return {
      product_id: record.package_id ?? null,
      product_name: pkg?.name ?? null,
      quantity: Number(record.quantity ?? 0),
      unit_price: Number(record.unit_sale_price ?? 0),
      invoice_unit_price:
        record.invoice_unit_sale_price == null ? null : Number(record.invoice_unit_sale_price),
      currency: record.currency ?? row.currency ?? "USD",
    }
  })
  const stage = String(row.stage ?? "draft")
  return {
    id: String(row.id),
    reference: row.reference ?? null,
    status: mcpStatusFromCrmStage(stage),
    crm_stage: stage,
    owner: ownerName,
    owner_id: row.owner_profile_id ?? null,
    contact: contact
      ? { id: contact.id ?? row.primary_contact_id, name: contact.full_name ?? null, email: contact.email ?? null }
      : { id: row.primary_contact_id ?? null, name: null, email: null },
    account_name: account?.name ?? null,
    currency: row.invoice_currency ?? row.currency ?? "USD",
    total_amount: Number(row.invoice_total_amount ?? row.total_amount ?? 0),
    notes: row.notes ?? null,
    lines,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  }
}

const DEAL_SELECT =
  "id, reference, stage, notes, currency, total_amount, invoice_currency, invoice_total_amount, owner_profile_id, primary_contact_id, account_id, created_at, updated_at, crm_accounts(name), crm_contacts!primary_contact_id(id, full_name, email), deal_line_items(package_id, quantity, unit_sale_price, invoice_unit_sale_price, currency, packages(name))"

async function ownerNamesById(
  admin: SupabaseClient,
  rows: Array<{ owner_profile_id?: string | null }>,
): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((row) => row.owner_profile_id).filter(Boolean))] as string[]
  if (ids.length === 0) return new Map()
  const { data } = await admin.from("profiles").select("id, full_name").in("id", ids)
  return new Map((data ?? []).map((row) => [String(row.id), String(row.full_name ?? "")]))
}

export async function mcpListDeals(
  admin: SupabaseClient,
  input: { status?: string; owner?: string },
): Promise<unknown> {
  let query = admin.from("deals").select(DEAL_SELECT).order("updated_at", { ascending: false }).limit(50)

  if (input.status?.trim()) {
    const stages = crmStagesForMcpStatus(input.status)
    if (stages?.length) query = query.in("stage", stages)
  }

  if (input.owner?.trim()) {
    const owner = input.owner.trim()
    if (UUID_RE.test(owner)) {
      query = query.eq("owner_profile_id", owner)
    } else {
      const { data: profiles, error } = await admin
        .from("profiles")
        .select("id, full_name")
        .ilike("full_name", likeContains(owner))
        .limit(20)
      if (error) throw new McpToolError(error.message)
      const ids = (profiles ?? []).map((row) => String(row.id))
      if (ids.length === 0) return { deals: [] }
      query = query.in("owner_profile_id", ids)
    }
  }

  const { data, error } = await query
  if (error) throw new McpToolError(error.message)
  const rows = data ?? []
  const owners = await ownerNamesById(admin, rows)
  return {
    deals: rows.map((row) =>
      mapDeal(
        row as Record<string, unknown>,
        row.owner_profile_id ? owners.get(String(row.owner_profile_id)) ?? null : null,
      ),
    ),
  }
}

export async function mcpGetDeal(admin: SupabaseClient, id: string): Promise<unknown> {
  const dealId = requireUuid(id, "Deal id")
  const { data, error } = await admin.from("deals").select(DEAL_SELECT).eq("id", dealId).maybeSingle()
  if (error) throw new McpToolError(error.message)
  if (!data) throw new McpToolError(`Deal not found: ${dealId}.`)
  const owners = await ownerNamesById(admin, [data])
  const mapped = mapDeal(
    data as Record<string, unknown>,
    data.owner_profile_id ? owners.get(String(data.owner_profile_id)) ?? null : null,
  )
  const { data: activities } = await admin
    .from("deal_activities")
    .select("id, action, summary, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(20)
  return { ...mapped, recent_activities: activities ?? [] }
}

export async function mcpCreateDeal(
  admin: SupabaseClient,
  key: McpApiKey,
  input: {
    contactId: string
    productId: string
    quantity: number
    agreedPrice: number
    notes?: string
  },
): Promise<unknown> {
  const contactId = requireUuid(input.contactId, "contact_id")
  const productId = input.productId.trim()
  if (!productId) throw new McpToolError("product_id is required.")
  const quantity = Math.floor(input.quantity)
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw new McpToolError("quantity must be at least 1.")
  }
  const agreedPrice = Number(input.agreedPrice)
  if (!Number.isFinite(agreedPrice) || agreedPrice < 0) {
    throw new McpToolError("agreed_price must be a non-negative number.")
  }

  const floor = await loadMcpDealPriceFloor(admin)
  if (agreedPrice < floor) {
    throw new McpToolError(
      `agreed_price ${agreedPrice} is below the configured floor of ${floor}. Raise the price or ask an admin to change the floor in Settings → MCP keys.`,
    )
  }

  const { data: contact, error: contactError } = await admin
    .from("crm_contacts")
    .select("id, account_id, full_name, email, source, active")
    .eq("id", contactId)
    .maybeSingle()
  if (contactError) throw new McpToolError(contactError.message)
  if (!contact || contact.active === false) {
    throw new McpToolError(`Contact not found: ${contactId}.`)
  }
  if (!contact.account_id) {
    throw new McpToolError("That contact is not linked to a company, so a deal cannot be created.")
  }

  const { data: product, error: productError } = await admin
    .from("packages")
    .select("id, name, race_id, trade_price, currency, is_hidden, shell_parent_package_id")
    .eq("id", productId)
    .maybeSingle()
  if (productError) throw new McpToolError(productError.message)
  if (!product) throw new McpToolError(`Product not found: ${productId}.`)
  if (product.shell_parent_package_id) {
    throw new McpToolError("That id is a hidden day-split SKU. Use the parent package id.")
  }

  const stock = await loadNativePackageAvailability(admin, [productId])
  const sellable = stock[0] ? sellableFromAvailability(stock[0]) : 0
  if (quantity > sellable) {
    throw new McpToolError(
      `Not enough stock. Requested ${quantity}, sellable is ${sellable}. Create a sourcing enquiry with a person instead of a deal, or wait for stock.`,
    )
  }

  const invoiceCurrency = parseDealInvoiceCurrency(String(product.currency ?? "USD"))
  const invoiceFxRate = await resolveDealInvoiceFxRate({ invoiceCurrency })
  const priced = preparePricedInvoiceLine(agreedPrice, invoiceCurrency, invoiceFxRate)
  const rawSource = canonicalDealSource(typeof contact.source === "string" ? contact.source : "other")
  const source = (DEAL_SOURCES as readonly string[]).includes(rawSource) ? rawSource : "other"

  const { data: deal, error: dealError } = await admin
    .from("deals")
    .insert({
      account_id: contact.account_id,
      primary_contact_id: contactId,
      race_id: product.race_id,
      source,
      stage: "draft",
      enquiry_stage: "new",
      currency: "USD",
      total_amount: priced.usdUnitPrice * quantity,
      notes: input.notes?.trim() || null,
    })
    .select("id, reference")
    .maybeSingle()
  if (dealError || !deal?.id) {
    throw new McpToolError(dealError?.message ?? "Could not create the deal.")
  }
  const dealId = String(deal.id)

  const { error: lineError } = await admin.from("deal_line_items").insert({
    deal_id: dealId,
    package_id: productId,
    quantity,
    unit_sale_price: priced.usdUnitPrice,
    invoice_unit_sale_price: priced.invoiceUnitPrice,
    currency: invoiceCurrency,
    reservation_status: "none",
    sourcing_mode: "owned",
  })
  if (lineError) {
    await admin.from("deals").delete().eq("id", dealId)
    throw new McpToolError(lineError.message)
  }

  await persistDealInvoicePricing(admin, dealId, {
    invoiceCurrency,
    fxRate: invoiceFxRate,
    lines: [
      {
        packageId: productId,
        quantity,
        usdUnitPrice: priced.usdUnitPrice,
        invoiceUnitPrice: priced.invoiceUnitPrice,
      },
    ],
  })

  await admin.from("deal_activities").insert({
    deal_id: dealId,
    action: "deal_created",
    summary: `Draft deal created by ${key.name} for ${quantity} × ${product.name}`,
    metadata: {
      mcp: true,
      key_name: key.name,
      package_id: productId,
      quantity,
      agreed_price: agreedPrice,
      currency: invoiceCurrency,
    },
  })

  return {
    deal_id: dealId,
    reference: deal.reference ?? null,
    status: "draft",
    crm_stage: "draft",
  }
}

export async function mcpUpdateDealStatus(
  admin: SupabaseClient,
  key: McpApiKey,
  input: { dealId: string; status: string },
): Promise<unknown> {
  const dealId = requireUuid(input.dealId, "deal_id")
  const requested = input.status.trim().toLowerCase()
  if (!isMcpDealStatus(requested)) {
    throw new McpToolError("status must be draft, negotiating, or lost.")
  }
  const status = requested as McpDealStatus
  const nextStage = crmStageForMcpStatus(status)

  const { data: deal, error } = await admin
    .from("deals")
    .select("id, stage, enquiry_stage, order_id")
    .eq("id", dealId)
    .maybeSingle()
  if (error) throw new McpToolError(error.message)
  if (!deal) throw new McpToolError(`Deal not found: ${dealId}.`)
  if (deal.order_id) {
    throw new McpToolError("This deal already has a confirmed order. The assistant cannot change its status.")
  }
  if (!canAssistantUpdateDealStage(String(deal.stage))) {
    throw new McpToolError(
      `This deal is in ${deal.stage}. The assistant can only set draft, negotiating, or lost on open pipeline deals — never on signed, paid, or cancelled deals.`,
    )
  }

  if (status === "lost") {
    await admin.rpc("admin_release_deal_reservations", {
      p_deal_id: dealId,
      p_release_status: "cancelled",
      p_reason: "Reservation released because the sales assistant marked the deal lost",
    })
  }

  const enquiryStage = enquiryStageForMcpStatus(status)
  const now = new Date().toISOString()
  const { error: updateError } = await admin
    .from("deals")
    .update({
      stage: nextStage,
      enquiry_stage: enquiryStage,
      loss_reason: status === "lost" ? "Closed by sales assistant" : null,
      closed_at: status === "lost" ? now : null,
      updated_at: now,
    })
    .eq("id", dealId)
  if (updateError) throw new McpToolError(updateError.message)

  await admin.from("deal_activities").insert({
    deal_id: dealId,
    action: "stage_changed",
    summary: `Stage changed from ${deal.stage} to ${nextStage} by ${key.name}`,
    metadata: { mcp: true, key_name: key.name, status, previous_stage: deal.stage },
  })

  return {
    deal_id: dealId,
    status,
    crm_stage: nextStage,
  }
}
