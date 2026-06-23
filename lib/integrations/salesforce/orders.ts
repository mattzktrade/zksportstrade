import { getSalesforceConfig } from "@/lib/integrations/salesforce/config"
import { SalesforceApiError, salesforceQuery, salesforceRequest } from "@/lib/integrations/salesforce/client"
import { isSalesforceDuplicateError } from "@/lib/integrations/salesforce/duplicate"
import { formatSalesforceSyncError } from "@/lib/integrations/salesforce/format-error"
import {
  clientEmailForSalesforce,
  linkPrimaryContactToOpportunity,
  resolveAgentForSalesforce,
} from "@/lib/integrations/salesforce/contacts"
import { enqueuePackageInventoryChannelSyncServer } from "@/lib/integrations/enqueue-server"
import { syncOpportunityOutcomeForOrder } from "@/lib/integrations/salesforce/opportunity-lifecycle"
import { resolveProduct2IdForPackage } from "@/lib/integrations/salesforce/resolve-product"
import { syncProductValueSold } from "@/lib/integrations/salesforce/sold-metrics"
import { createAdminClient } from "@/lib/supabase/admin"
import { PACKAGE_COLUMNS } from "@/lib/catalog/columns"
import type { OrderChannel } from "@/lib/integrations/types"

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function channelLabel(channel: OrderChannel): string {
  switch (channel) {
    case "wix":
      return "Wix"
    case "partner_api":
      return "Partner API"
    case "admin":
      return "Admin"
    default:
      return "Trade Portal"
  }
}

function skipOpportunityLineItems(): boolean {
  return process.env.SALESFORCE_ORDER_SKIP_LINE_ITEMS?.trim().toLowerCase() === "true"
}

/** DLRS / chained rollup failures are Salesforce config issues, not portal bugs. */
function isDlrsConfigError(e: unknown): boolean {
  if (!(e instanceof SalesforceApiError)) return false
  const m = e.message.toLowerCase()
  return (
    m.includes("dlrs_") ||
    m.includes("invalid_cross_reference_key") ||
    m.includes("cannot_insert_update_activate_entity")
  )
}

export async function syncOrderToSalesforce(orderId: string): Promise<{
  opportunityId: string
  quoteId: string | null
  lineItemsSkipped?: boolean
  lineItemPending?: boolean
}> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")

  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle()

  if (orderErr) throw new Error(orderErr.message)
  if (!order) throw new Error(`Order ${orderId} not found.`)

  const config = getSalesforceConfig()
  if (!config) throw new Error("Salesforce is not configured.")

  const skipLineItems = skipOpportunityLineItems()
  const lineItemAlreadyDone =
    order.salesforce_line_item_status === "synced" || order.salesforce_line_item_status === "skipped"

  // Opportunity already created AND line item resolved (or intentionally skipped) — nothing to do.
  if (order.salesforce_opportunity_id && (lineItemAlreadyDone || (skipLineItems && order.salesforce_line_item_status))) {
    return {
      opportunityId: order.salesforce_opportunity_id,
      quoteId: order.salesforce_quote_id ?? null,
      lineItemsSkipped: order.salesforce_line_item_status === "skipped" || undefined,
    }
  }

  const { data: pkg, error: pkgErr } = await admin
    .from("packages")
    .select(PACKAGE_COLUMNS)
    .eq("id", order.package_id)
    .maybeSingle()

  if (pkgErr || !pkg) throw new Error("Package not found for order.")

  const pkgRow = pkg as {
    name: string
    product_code: string | null
    salesforce_product_id: string | null
    event_date: string
    circuit: string
    race_id: string
  }

  const { data: race } = await admin.from("races").select("name, season").eq("id", pkgRow.race_id).maybeSingle()
  const season = race?.season ?? new Date(pkgRow.event_date).getFullYear()
  const raceName = race?.name ?? pkgRow.circuit ?? "Event"

  const product2Id = await resolveProduct2IdForPackage({
    productCode: pkgRow.product_code,
    salesforceProductId: pkgRow.salesforce_product_id,
  })

  const pbeRows = await salesforceQuery<{ Id: string; Pricebook2Id: string }>(
    `SELECT Id, Pricebook2Id FROM PricebookEntry WHERE Product2Id = '${escapeSoqlString(product2Id)}' AND Pricebook2.IsStandard = true AND IsActive = true LIMIT 1`,
  )
  const pricebookEntryId = pbeRows[0]?.Id
  const pricebook2Id = pbeRows[0]?.Pricebook2Id
  if (!pricebookEntryId || !pricebook2Id) {
    throw new Error("No Standard Pricebook Entry for this product in Salesforce. Sync the product first.")
  }

  // Keep the order reference at the end of the Name no matter how long the package name is —
  // it is the dedup key when there is no custom Portal Order Ref field on the Opportunity.
  const nameSuffix = ` (${order.reference})`
  const opportunityName =
    `${raceName} ${season} - ${pkgRow.name}`.slice(0, Math.max(0, 120 - nameSuffix.length)) + nameSuffix
  const closeDate = (pkgRow.event_date || new Date().toISOString()).slice(0, 10)
  const channel = (order.channel ?? "trade_portal") as OrderChannel
  const syncedClientEmail = clientEmailForSalesforce(order.client_email)

  let opportunityId: string | null = order.salesforce_opportunity_id ?? null
  let quoteId: string | null = order.salesforce_quote_id ?? null

  // --- 1) Create Opportunity once (idempotent: skip if it already exists) ---
  if (!opportunityId) {
    const { data: fresh } = await admin
      .from("orders")
      .select("salesforce_opportunity_id, salesforce_quote_id")
      .eq("id", orderId)
      .maybeSingle()
    if (fresh?.salesforce_opportunity_id) {
      opportunityId = fresh.salesforce_opportunity_id
      quoteId = fresh.salesforce_quote_id ?? null
    }
  }

  const { data: agent, error: agentErr } = await admin
    .from("profiles")
    .select("id, email, full_name, company_name, mobile")
    .eq("id", order.agent_profile_id)
    .maybeSingle()
  if (agentErr || !agent) throw new Error("Agent profile not found for order.")

  const { accountId, contactId: agentContactId } = await resolveAgentForSalesforce({
    companyOrAccountName: agent.company_name || agent.full_name || agent.email,
    fullName: agent.full_name || agent.company_name || agent.email,
    email: agent.email,
    phone: (agent as { mobile?: string | null }).mobile,
  })

  if (!opportunityId) {
    const oppBody: Record<string, unknown> = {
      Name: opportunityName,
      AccountId: accountId,
      StageName: config.opportunityStage,
      CloseDate: closeDate,
      Amount: Number(order.total_amount),
      Pricebook2Id: pricebook2Id,
      Description: [
        `Portal order: ${order.reference}`,
        `Channel: ${channelLabel(channel)}`,
        `End client: ${order.client_name}`,
        order.client_nationality?.trim() ? `Nationality: ${order.client_nationality.trim()}` : null,
        syncedClientEmail
          ? `Email: ${syncedClientEmail}`
          : order.client_email?.trim()
            ? `Email (portal, not synced to Contact): ${order.client_email.trim()}`
            : null,
        `Phone: ${order.client_phone}`,
        order.shipping_address_line1
          ? `Ship to: ${[order.shipping_address_line1, order.shipping_address_line2, order.shipping_city, order.shipping_postcode, order.shipping_country].filter(Boolean).join(", ")}`
          : null,
        order.po_number ? `PO: ${order.po_number}` : null,
        skipLineItems ? "(Line item skipped — portal env SALESFORCE_ORDER_SKIP_LINE_ITEMS)" : null,
      ]
        .filter(Boolean)
        .join("\n"),
    }

    if (config.defaultOwnerId) oppBody.OwnerId = config.defaultOwnerId
    if (config.fieldPortalRef) oppBody[config.fieldPortalRef] = order.reference
    if (config.fieldChannel) oppBody[config.fieldChannel] = channelLabel(channel)

    // Dedup before creating: re-check the DB id, then look for an existing Opportunity in
    // Salesforce by portal-ref field (if configured) or by the order reference embedded in the Name.
    if (!opportunityId) {
      const { data: fresh } = await admin
        .from("orders")
        .select("salesforce_opportunity_id, salesforce_quote_id")
        .eq("id", orderId)
        .maybeSingle()
      if (fresh?.salesforce_opportunity_id) {
        opportunityId = fresh.salesforce_opportunity_id
        quoteId = fresh.salesforce_quote_id ?? quoteId
      }
    }

    if (!opportunityId) {
      const existing = config.fieldPortalRef
        ? await findOpportunityByPortalReference(order.reference, config.fieldPortalRef)
        : await findOpportunityByOrderReference(order.reference)
      if (existing) opportunityId = existing
    }

    if (!opportunityId) {
      try {
        const opp = await salesforceRequest<{ id: string }>("POST", "/sobjects/Opportunity", { body: oppBody })
        opportunityId = opp.id
      } catch (e) {
        // A duplicate rule (or a racing worker) can reject the insert — recover the existing record.
        if (isSalesforceDuplicateError(e)) {
          const existing = config.fieldPortalRef
            ? await findOpportunityByPortalReference(order.reference, config.fieldPortalRef)
            : await findOpportunityByOrderReference(order.reference)
          if (existing) opportunityId = existing
        }
        if (!opportunityId) throw formatSalesforceSyncError(e, `Order ${order.reference}`)
      }
    }

    // Persist the Opportunity id immediately so a later line-item failure never re-creates it.
    await admin
      .from("orders")
      .update({
        salesforce_opportunity_id: opportunityId,
        salesforce_line_item_status: skipLineItems ? "skipped" : "pending",
        salesforce_synced_at: new Date().toISOString(),
      })
      .eq("id", orderId)
  }

  // Always link the trade agent as primary contact (also fixes opps that previously synced the end client).
  if (opportunityId) {
    try {
      await linkPrimaryContactToOpportunity(opportunityId, agentContactId)
    } catch (e) {
      console.warn("[salesforce] Contact role link skipped:", e instanceof Error ? e.message : e)
    }
  }

  // --- 2) Line item (idempotent; a chained DLRS failure here keeps the Opportunity) ---
  let lineItemStatus: "pending" | "synced" | "failed" | "skipped" = skipLineItems ? "skipped" : "pending"

  if (!skipLineItems) {
    try {
      const existing = await salesforceQuery<{ Id: string }>(
        `SELECT Id FROM OpportunityLineItem WHERE OpportunityId = '${escapeSoqlString(opportunityId)}' LIMIT 1`,
      )
      if (existing[0]?.Id) {
        lineItemStatus = "synced"
      } else {
        await salesforceRequest("POST", "/sobjects/OpportunityLineItem", {
          body: {
            OpportunityId: opportunityId,
            PricebookEntryId: pricebookEntryId,
            Quantity: Number(order.guests),
            UnitPrice: Number(order.unit_price),
          },
        })
        lineItemStatus = "synced"
      }
    } catch (e) {
      const friendly = formatSalesforceSyncError(e, `Order ${order.reference}`)
      // Keep the Opportunity; record the line item as failed so it can be retried after the SF fix.
      await admin
        .from("orders")
        .update({
          salesforce_opportunity_id: opportunityId,
          salesforce_sync_status: "failed",
          salesforce_line_item_status: "failed",
          salesforce_sync_error: friendly.message.slice(0, 1000),
        })
        .eq("id", orderId)

      if (isDlrsConfigError(e)) {
        throw new Error(
          `${friendly.message} The Opportunity ${opportunityId} WAS created in Salesforce (stage ${config.opportunityStage}); ` +
            `only the product line is blocked. Fix the Salesforce rollup, then re-run the sync queue — it will add the line to the existing Opportunity (no duplicate).`,
        )
      }
      throw friendly
    }
  }

  const { error: upErr } = await admin
    .from("orders")
    .update({
      salesforce_opportunity_id: opportunityId,
      salesforce_quote_id: quoteId,
      salesforce_sync_status: "synced",
      salesforce_line_item_status: lineItemStatus,
      salesforce_synced_at: new Date().toISOString(),
      salesforce_sync_error:
        lineItemStatus === "skipped"
          ? "Opportunity created without line items (SALESFORCE_ORDER_SKIP_LINE_ITEMS). Add products in Salesforce."
          : null,
    })
    .eq("id", orderId)

  if (upErr) throw new Error(upErr.message)

  if (lineItemStatus === "synced") {
    try {
      await syncProductValueSold({ product2Id, config })
    } catch (e) {
      console.warn("[salesforce] Value Sold sync skipped:", e instanceof Error ? e.message : e)
    }
  }

  const inv = await enqueuePackageInventoryChannelSyncServer(order.package_id, {
    trigger: `order-synced:${order.reference}`,
    scheduleDrain: false,
  })
  if (!inv.ok) console.warn("[salesforce] Post-order inventory sync not queued:", inv.message)

  if (order.channel === "wix") {
    const won = await syncOpportunityOutcomeForOrder(orderId, "won")
    if (!won.ok) {
      console.warn("[salesforce] Wix prepaid order — Closed Won not set:", won.message)
    }
  }

  return {
    opportunityId,
    quoteId,
    lineItemsSkipped: lineItemStatus === "skipped" || undefined,
  }
}

async function findOpportunityByPortalReference(
  portalReference: string,
  fieldApiName: string,
): Promise<string | null> {
  const ref = portalReference.trim()
  if (!ref || !/^[A-Za-z0-9_.]+$/.test(fieldApiName)) return null
  const rows = await salesforceQuery<{ Id: string }>(
    `SELECT Id FROM Opportunity WHERE ${fieldApiName} = '${escapeSoqlString(ref)}' LIMIT 1`,
  )
  return rows[0]?.Id ?? null
}

/**
 * Fallback dedup when there is no custom Portal Order Ref field.
 * The Opportunity Name always ends with " (<order reference>)", and Name is filterable in SOQL
 * (unlike Description, which is a long text area and cannot be used in WHERE).
 */
async function findOpportunityByOrderReference(portalReference: string): Promise<string | null> {
  const ref = portalReference.trim()
  if (!ref) return null
  const rows = await salesforceQuery<{ Id: string }>(
    `SELECT Id FROM Opportunity WHERE Name LIKE '%(${escapeSoqlString(ref)})%' ORDER BY CreatedDate DESC LIMIT 1`,
  )
  return rows[0]?.Id ?? null
}
