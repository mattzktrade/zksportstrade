import { buildCatalogListingPayload } from "@/lib/catalog/listing-payload"
import { getSalesforceConfig } from "@/lib/integrations/salesforce/config"
import { applyListingContentToProduct2 } from "@/lib/integrations/salesforce/listing-content"
import { syncListingContentToWix } from "@/lib/integrations/wix/listing-content"
import { SalesforceApiError } from "@/lib/integrations/salesforce/client"
import { salesforceQuery, salesforceRequest } from "@/lib/integrations/salesforce/client"
import { isSalesforceDuplicateError } from "@/lib/integrations/salesforce/duplicate"
import { getProduct2UpdateableFields, getProduct2Fields } from "@/lib/integrations/salesforce/describe"
import {
  PROTECTED_SALESFORCE_PRODUCT_FIELDS,
  readSfInventorySnapshot,
} from "@/lib/integrations/salesforce/inventory-snapshot"
import { getStoredInstanceUrl } from "@/lib/integrations/salesforce/settings-store"
import { productCodeLookupVariants } from "@/lib/integrations/salesforce/product-code"
import { findEventId, linkProductToEvent, resolveEventLookup } from "@/lib/integrations/salesforce/events"
import {
  computeProductQuantitySoldFromWonLines,
  syncProductValueSold,
} from "@/lib/integrations/salesforce/sold-metrics"
import { syncSalesforcePackageItemsForLinkedGroup } from "@/lib/integrations/salesforce/package-items"
import { createAdminClient } from "@/lib/supabase/admin"
import { PACKAGE_COLUMNS, INVENTORY_COLUMNS } from "@/lib/catalog/columns"

type PackageRow = {
  id: string
  name: string
  description: string | null
  product_code: string | null
  salesforce_product_id: string | null
  salesforce_product_family: string | null
  duration: string | null
  inventory_group_id: string | null
  total_capacity: number | null
  trade_price: number | null
  currency: string
  is_enquiry: boolean
  race_id: string | null
}

export type ProductSyncResult = {
  product2Id: string
  productCode: string
  instanceUrl: string
  fieldsUpdated: string[]
  fieldsSkipped: string[]
  pricebookUpdated: boolean
}

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function numClose(a: number | null | undefined, b: number | null | undefined, eps = 0.01): boolean {
  if (a == null || b == null) return a == null && b == null
  return Math.abs(a - b) <= eps
}

function inferSalesforceProductFamily(row: PackageRow, fallback: string): string {
  const explicit = row.salesforce_product_family?.trim()
  if (explicit) return explicit
  const duration = row.duration?.trim()
  if (
    row.inventory_group_id?.trim() &&
    (duration === "friday_only" || duration === "saturday_only" || duration === "sunday_only")
  ) {
    return "Package"
  }
  if (duration === "friday_only" || duration === "saturday_only" || duration === "sunday_only") {
    return "Single Ticket"
  }
  if (duration === "3_day" || duration === "2_day") return "Package"
  return fallback
}

function buildStockSourceSummary(
  layers: Array<{ quantity: number | null; source: string | null; received_at?: string | null }>,
): string | null {
  const bySource = new Map<string, number>()
  for (const layer of layers) {
    const source = layer.source?.trim()
    if (!source) continue
    const quantity = Math.max(0, Math.floor(Number(layer.quantity) || 0))
    if (quantity <= 0) continue
    bySource.set(source, (bySource.get(source) ?? 0) + quantity)
  }

  if (bySource.size === 0) return null

  return [...bySource.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([source, quantity]) => `${source}: ${quantity} unit${quantity === 1 ? "" : "s"}`)
    .join("; ")
}

async function readLocalSoldForPackage(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  packageId: string,
): Promise<number> {
  const { data: orders } = await admin
    .from("orders")
    .select("guests")
    .eq("package_id", packageId)
    .neq("status", "cancelled")
  const portalSold = (orders ?? []).reduce((sum, row) => sum + (Math.floor(Number(row.guests) || 0)), 0)

  const { data: offlineRows } = await admin
    .from("salesforce_offline_sale_applications")
    .select("quantity")
    .eq("package_id", packageId)
  const offlineSold = (offlineRows ?? []).reduce(
    (sum, row) => sum + Math.max(0, Math.floor(Number(row.quantity) || 0)),
    0,
  )

  return Math.max(0, portalSold + offlineSold)
}

export async function syncPackageToSalesforce(packageId: string): Promise<ProductSyncResult> {
  const syncStarted = Date.now()
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")

  const instanceUrl = (await getStoredInstanceUrl()) ?? process.env.SALESFORCE_INSTANCE_URL?.trim() ?? ""
  const config = getSalesforceConfig(instanceUrl || undefined)
  if (!config) throw new Error("Salesforce is not configured.")

  const { data: pkg, error } = await admin.from("packages").select(PACKAGE_COLUMNS).eq("id", packageId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!pkg) throw new Error(`Package ${packageId} not found.`)

  const row = pkg as PackageRow
  const productCode = row.product_code?.trim() || null
  const preferredId = row.salesforce_product_id?.trim() || null

  const { data: inv } = await admin
    .from("package_inventory")
    .select(INVENTORY_COLUMNS)
    .eq("package_id", packageId)
    .maybeSingle()

  const qtyAvailable = inv?.qty_available ?? 0
  const qtyHeld = inv?.qty_held ?? 0
  const sellable = Math.max(0, qtyAvailable - qtyHeld)

  // Total stock = sum of all cost layers (units ever received). Grows when admin buys more
  // stock; never drops on a booking. This is what Salesforce "Stock Quantity" should mirror.
  const { data: layers } = await admin
    .from("package_cost_layers")
    .select("quantity, source, received_at")
    .eq("package_id", packageId)
  const totalReceived = (layers ?? []).reduce(
    (sum, l) => sum + (Number((l as { quantity: number | null }).quantity) || 0),
    0,
  )
  const totalCapacity = Math.max(0, Math.floor(Number(row.total_capacity) || 0))
  // total_capacity is the commercial stock bought for the package. Cost layers are supplier/cost
  // detail and can be partial or duplicated across linked packages, so only use them as a fallback.
  const stockTotal = totalCapacity > 0 ? totalCapacity : Math.max(totalReceived, sellable)

  const stockSource = buildStockSourceSummary(layers ?? [])
  const tradePrice = row.trade_price != null && !row.is_enquiry ? Number(row.trade_price) : null
  const desc = typeof row.description === "string" ? row.description.trim() : ""

  let raceName = ""
  let raceSeason: number | null = null
  if (row.race_id) {
    const { data: race } = await admin
      .from("races")
      .select("name, season")
      .eq("id", row.race_id)
      .maybeSingle()
    raceName = (race as { name?: string } | null)?.name?.trim() ?? ""
    const seasonVal = (race as { season?: number } | null)?.season
    raceSeason = typeof seasonVal === "number" ? seasonVal : null
  }

  const preSyncNotes: string[] = []
  let byCodeId: string | null = null
  // If an explicit Product Id is present, trust that over Product Code. Sandbox Product Codes can
  // collide with unrelated live products, so code lookup is event-checked before it is accepted.
  if (!preferredId && productCode) {
    const candidateByCode = await resolveProduct2IdByCode(productCode)
    if (candidateByCode) {
      const eventCheck = await productMatchesRaceEvent({
        product2Id: candidateByCode,
        config,
        season: raceSeason,
        raceName,
      })
      if (eventCheck?.matches === false) {
        preSyncNotes.push(
          `Product Code "${productCode}" belongs to another Salesforce event (${eventCheck.message}); creating/linking the correct event product instead.`,
        )
      } else {
        byCodeId = candidateByCode
      }
    } else {
      preSyncNotes.push(
        `Product Code "${productCode}" was not found in this Salesforce org; creating/linking a new live product instead.`,
      )
    }
  }

  const product2Id = await resolveProduct2IdForSync({
    productCode,
    preferredId,
    byCodeId,
    productName: row.name.trim(),
    productFamily: inferSalesforceProductFamily(row, config.productFamily),
    config,
    raceSeason,
    raceName,
    tradePrice,
    stockTotal,
    sellable,
  })

  if (product2Id !== preferredId) {
    await admin
      .from("packages")
      .update({
        salesforce_product_id: product2Id,
        integration_sync_status: "pending",
        integration_sync_error: null,
      })
      .eq("id", packageId)
  }

  const productFamily = inferSalesforceProductFamily(row, config.productFamily)
  const fieldsUpdated: string[] = []
  const fieldsSkipped: string[] = [...preSyncNotes]
  const sfSnapshot = await readSfInventorySnapshot(product2Id, config).catch((e) => {
    fieldsSkipped.push(`Salesforce inventory snapshot: ${e instanceof Error ? e.message : String(e)}`)
    return null
  })
  const wonLineQty = await computeProductQuantitySoldFromWonLines(product2Id, config.opportunityStageWon).catch((e) => {
    fieldsSkipped.push(`Closed Won line quantity: ${e instanceof Error ? e.message : String(e)}`)
    return 0
  })
  const existingSfSold = Math.max(0, Math.floor(sfSnapshot?.quantitySold ?? 0), wonLineQty)
  const localRecordedSold = await readLocalSoldForPackage(admin, packageId).catch(() => 0)
  let availableForSalesforce = sellable
  if (wonLineQty > localRecordedSold && stockTotal > wonLineQty) {
    availableForSalesforce = Math.max(sellable, stockTotal - wonLineQty)
    fieldsSkipped.push(
      `Available Quantity protected at ${availableForSalesforce} because Salesforce has ${wonLineQty} won line unit(s) but the portal has only recorded ${localRecordedSold}. Run Pull offline sales to import them.`,
    )
  } else if (existingSfSold > 0) {
    const availableBySold = Math.max(0, stockTotal - existingSfSold)
    const sfAvailable = sfSnapshot?.available == null ? null : Math.max(0, Math.floor(sfSnapshot.available))
    if (availableBySold < sellable && sfAvailable !== sellable) {
      availableForSalesforce = availableBySold
    }
  }
  if (existingSfSold > 0 && availableForSalesforce !== sellable) {
    fieldsSkipped.push(
      `Available Quantity capped at ${availableForSalesforce} to preserve ${existingSfSold} Salesforce sold unit(s).`,
    )
  }

  if (preferredId && byCodeId && preferredId !== byCodeId) {
    fieldsSkipped.push(
      `Product Code "${productCode}" is on a different Salesforce product (${byCodeId}). Syncing your chosen Id ${preferredId}.`,
    )
  }
  let pricebookUpdated = false

  if (tradePrice != null && Number.isFinite(tradePrice)) {
    await ensureStandardPricebookEntry(product2Id, tradePrice)
    pricebookUpdated = true
    fieldsUpdated.push("Standard PricebookEntry.UnitPrice")
  }

  const updateable = await getProduct2UpdateableFields()

  const fieldPatches: Array<{ api: string; value: unknown; label: string }> = []

  if (config.fieldUnitPrice && tradePrice != null) {
    fieldPatches.push({ api: config.fieldUnitPrice, value: tradePrice, label: "Unit Price" })
  }
  // Stock Quantity = total units received (cost layers). Available Quantity = sellable now.
  // Booking lowers Available only; buying more stock raises both.
  if (config.fieldStockQty) {
    fieldPatches.push({ api: config.fieldStockQty, value: stockTotal, label: "Stock Quantity" })
  }
  if (config.fieldAvailableQty) {
    fieldPatches.push({ api: config.fieldAvailableQty, value: availableForSalesforce, label: "Available Quantity" })
  }
  // Source (who we bought from). Only push when we actually have one so we never blank an
  // existing Salesforce value for products with no source recorded in the portal yet.
  if (stockSource) {
    const sourceField = await resolveSourceField(config)
    if (sourceField) {
      fieldPatches.push({ api: sourceField, value: stockSource, label: "Source" })
    } else {
      fieldsSkipped.push(
        "Source: no Source field found on Product (set SALESFORCE_FIELD_SOURCE in .env.local to the API name).",
      )
    }
  }

  fieldPatches.push({ api: "Name", value: row.name.trim(), label: "Name" })
  if (productFamily) fieldPatches.push({ api: "Family", value: productFamily, label: "Family" })
  if (desc) fieldPatches.push({ api: "Description", value: desc.slice(0, 32000), label: "Description" })

  for (const patch of fieldPatches) {
    if (PROTECTED_SALESFORCE_PRODUCT_FIELDS.has(patch.api)) {
      fieldsSkipped.push(`${patch.label} (${patch.api} is owned by Salesforce — not synced from portal)`)
      continue
    }
    if (!updateable.has(patch.api)) {
      fieldsSkipped.push(`${patch.label} (${patch.api} is read-only or invalid)`)
      continue
    }
    try {
      await salesforceRequest("PATCH", `/sobjects/Product2/${product2Id}`, {
        body: { [patch.api]: patch.value },
      })
      fieldsUpdated.push(patch.api)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      fieldsSkipped.push(`${patch.label}: ${msg}`)
    }
  }

  // Link the product to its Event record so Salesforce shows which event it is for (best-effort).
  if (raceName) {
    const evt = await linkProductToEvent({ product2Id, config, season: raceSeason, raceName })
    if (evt.ok) {
      fieldsUpdated.push(`${evt.field} (Event)`)
    } else {
      fieldsSkipped.push(`Event link: ${evt.message}`)
    }
  }

  // Keep Value Sold in step with Quantity Sold for portal bookings (DLRS often updates qty only).
  await syncProductValueSold({ product2Id, config, fieldsUpdated, fieldsSkipped })

  await syncSalesforcePackageItemsForLinkedGroup({
    packageId,
    product2Id,
    config,
    fieldsUpdated,
    fieldsSkipped,
  })

  const listingPayload = await buildCatalogListingPayload(admin, packageId)
  await applyListingContentToProduct2(product2Id, listingPayload, config, {
    updateable,
    fieldsUpdated,
    fieldsSkipped,
  })

  if (fieldsUpdated.length === 0 && !pricebookUpdated) {
    throw new Error(
      `Nothing could be updated in Salesforce. Skipped: ${fieldsSkipped.join("; ") || "all fields"}. ` +
        `Check field API names in .env.local match Setup → Object Manager → Product.`,
    )
  }

  await verifyProduct2Sync({
    product2Id,
    config,
    syncStarted,
    expected: {
      name: row.name.trim(),
      tradePrice,
      sellable: availableForSalesforce,
      stockTotal,
    },
    fieldsUpdated,
    pricebookUpdated,
    fieldsSkipped,
  })

  // Salesforce often assigns ProductCode via automation *after* insert — poll briefly before saving to portal.
  const sfProductCode = await readSalesforceProductCodeWithRetry(product2Id)
  const canonicalCode = sfProductCode ?? productCode
  if (sfProductCode && productCode && sfProductCode !== productCode) {
    fieldsSkipped.push(`Product Code updated from portal "${productCode}" to Salesforce "${sfProductCode}".`)
  }
  if (!canonicalCode) {
    fieldsSkipped.push(
      "Product Code not yet assigned in Salesforce — re-run sync in a minute if your org assigns codes via automation.",
    )
  }

  let packageProductCode: string | null = canonicalCode
  if (canonicalCode) {
    const { data: duplicateCode } = await admin
      .from("packages")
      .select("id, salesforce_product_id")
      .eq("product_code", canonicalCode)
      .neq("id", packageId)
      .maybeSingle()

    if (duplicateCode?.id) {
      const { error: clearErr } = await admin
        .from("packages")
        .update({ product_code: null })
        .eq("id", String(duplicateCode.id))

      if (clearErr) throw new Error(clearErr.message)

      packageProductCode = canonicalCode
      fieldsSkipped.push(
        `Product Code "${canonicalCode}" was moved from package "${duplicateCode.id}" to this linked Salesforce product.`,
      )
    }
  }

  const { error: upErr } = await admin
    .from("packages")
    .update({
      salesforce_product_id: product2Id,
      ...(canonicalCode ? { product_code: packageProductCode } : {}),
      integration_sync_status: "synced",
      integration_synced_at: new Date().toISOString(),
      integration_sync_error: null,
    })
    .eq("id", packageId)

  if (upErr) throw new Error(upErr.message)

  try {
    await syncListingContentToWix(packageId, listingPayload)
  } catch (e) {
    console.warn("[wix] Listing content sync skipped:", e instanceof Error ? e.message : e)
  }

  return {
    product2Id,
    productCode: canonicalCode ?? productCode ?? "",
    instanceUrl: instanceUrl.replace(/\/$/, ""),
    fieldsUpdated,
    fieldsSkipped,
    pricebookUpdated,
  }
}

let cachedSourceField: { at: number; field: string | null } | null = null

/**
 * Resolve the Product2 field that stores the stock "Source". Prefers the explicit env override
 * (SALESFORCE_FIELD_SOURCE); otherwise auto-detects a writable text/picklist field named or
 * labelled "Source". Cached briefly to avoid repeated describe calls.
 */
async function resolveSourceField(
  config: NonNullable<ReturnType<typeof getSalesforceConfig>>,
): Promise<string | null> {
  if (config.fieldSource) return config.fieldSource
  if (cachedSourceField && Date.now() - cachedSourceField.at < 5 * 60_000) {
    return cachedSourceField.field
  }
  const fields = await getProduct2Fields()
  const candidate = fields.find(
    (f) =>
      f.updateable &&
      !f.calculated &&
      (f.type === "string" || f.type === "picklist" || f.type === "textarea") &&
      (/^source(__c)?$/i.test(f.name) || f.label.trim().toLowerCase() === "source"),
  )
  const field = candidate?.name ?? null
  cachedSourceField = { at: Date.now(), field }
  return field
}

async function resolveProduct2IdByCode(productCode: string): Promise<string | null> {
  const matches: Array<{ Id: string; Name: string }> = []
  const seen = new Set<string>()
  const codeFields = await getProductCodeFieldNames()

  for (const variant of productCodeLookupVariants(productCode)) {
    const esc = escapeSoqlString(variant)
    const where = codeFields.map((f) => `${f} = '${esc}'`).join(" OR ")
    const rows = await salesforceQuery<{ Id: string; Name: string }>(
      `SELECT Id, Name FROM Product2 WHERE (${where}) LIMIT 10`,
    )
    for (const row of rows) {
      if (!seen.has(row.Id)) {
        seen.add(row.Id)
        matches.push({ Id: row.Id, Name: row.Name })
      }
    }
  }

  if (matches.length > 1) {
    const list = matches.map((m) => `${m.Id} (${m.Name})`).join("; ")
    throw new Error(
      `Product Code "${productCode}" matches multiple Salesforce products: ${list}. ` +
        `Set Salesforce Product Id on this package to the record you use in the Sales List.`,
    )
  }

  return matches[0]?.Id ?? null
}

let cachedCodeFields: { at: number; fields: string[] } | null = null

/**
 * Fields that hold the human "Product Code". Always includes the standard ProductCode, plus any
 * custom field whose API name or label looks like a product code (some orgs auto-number into a
 * custom field and leave standard ProductCode blank).
 */
async function getProductCodeFieldNames(): Promise<string[]> {
  if (cachedCodeFields && Date.now() - cachedCodeFields.at < 5 * 60 * 1000) {
    return cachedCodeFields.fields
  }
  const names = new Set<string>(["ProductCode"])
  try {
    const fields = await getProduct2Fields()
    for (const f of fields) {
      if (f.type !== "string" && f.type !== "textarea" && f.type !== "auto" && f.type !== "autonumber") continue
      const nameMatch = /product.?code/i.test(f.name) || /^product_code__c$/i.test(f.name)
      const labelMatch = /product\s*code/i.test(f.label ?? "")
      if (nameMatch || labelMatch) names.add(f.name)
    }
  } catch {
    // describe unavailable — standard field only
  }
  const list = [...names]
  cachedCodeFields = { at: Date.now(), fields: list }
  return list
}

async function readSalesforceProductCode(product2Id: string): Promise<string | null> {
  const fields = await getProductCodeFieldNames()
  const selectList = ["Id", ...fields].join(", ")
  const rows = await salesforceQuery<Record<string, unknown>>(
    `SELECT ${selectList} FROM Product2 WHERE Id = '${escapeSoqlString(product2Id)}' LIMIT 1`,
  )
  const row = rows[0]
  if (!row) return null

  // Prefer the standard ProductCode, then any custom code field that has a value.
  for (const field of fields) {
    const raw = row[field]
    const code = typeof raw === "string" ? raw.trim() : raw != null ? String(raw).trim() : ""
    if (code) return code
  }
  return null
}

/** SF flows can assign ProductCode a moment after Product2 insert — retry before writing back to the portal. */
async function readSalesforceProductCodeWithRetry(
  product2Id: string,
  maxAttempts = 20,
): Promise<string | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = await readSalesforceProductCode(product2Id)
    if (code) return code
    if (attempt < maxAttempts - 1) await new Promise((r) => setTimeout(r, 750))
  }
  return null
}

async function productMatchesRaceEvent(args: {
  product2Id: string
  config: NonNullable<ReturnType<typeof getSalesforceConfig>>
  season: number | null
  raceName: string
}): Promise<{ matches: boolean; message: string } | null> {
  const raceName = args.raceName.trim()
  if (!raceName) return null

  const lookup = await resolveEventLookup(args.config).catch(() => null)
  if (!lookup) return null

  const expectedEventId = await findEventId(lookup.object, args.season, raceName).catch(() => null)
  if (!expectedEventId) return null

  const rows = await salesforceQuery<Record<string, unknown>>(
    `SELECT Id, Name, ${lookup.field} FROM Product2 WHERE Id = '${escapeSoqlString(args.product2Id)}' LIMIT 1`,
  )
  const row = rows[0]
  const actualEventId = row?.[lookup.field] == null ? "" : String(row[lookup.field]).trim()
  if (!actualEventId) {
    return {
      matches: false,
      message: `expected ${expectedEventId}, candidate product has no Salesforce event set`,
    }
  }

  return {
    matches: actualEventId === expectedEventId,
    message:
      actualEventId === expectedEventId
        ? `${args.season ?? ""} ${raceName}`.trim()
        : `expected ${expectedEventId}, found ${actualEventId}`,
  }
}

async function resolveProduct2IdForSync(ctx: {
  productCode: string | null
  preferredId: string | null
  byCodeId: string | null
  productName: string
  productFamily: string
  config: NonNullable<ReturnType<typeof getSalesforceConfig>>
  raceSeason: number | null
  raceName: string
  tradePrice: number | null
  stockTotal: number
  sellable: number
}): Promise<string> {
  if (ctx.preferredId) {
    const rows = await salesforceQuery<{ Id: string; ProductCode: string | null; Name: string }>(
      `SELECT Id, ProductCode, Name FROM Product2 WHERE Id = '${escapeSoqlString(ctx.preferredId)}' LIMIT 1`,
    )
    const hit = rows[0]
    if (!hit?.Id) {
      const existing = await findExistingProduct2ForCreate(ctx)
      return existing ?? createProduct2({ ...ctx, productCode: null })
    }
    return hit.Id
  }

  if (ctx.byCodeId) return ctx.byCodeId

  // Auto-create the Product2 so a new portal package appears in Salesforce without manual setup.
  const existing = await findExistingProduct2ForCreate(ctx)
  return existing ?? createProduct2(ctx)
}

async function findExistingProduct2ForCreate(ctx: {
  productName: string
  config: NonNullable<ReturnType<typeof getSalesforceConfig>>
  raceSeason: number | null
  raceName: string
  tradePrice: number | null
}): Promise<string | null> {
  const name = ctx.productName.trim()
  if (!name) return null

  const select = ["Id", "Name", "CreatedDate"]
  if (ctx.config.fieldUnitPrice) select.push(ctx.config.fieldUnitPrice)

  const rows = await salesforceQuery<Record<string, unknown>>(
    `SELECT ${select.join(", ")} FROM Product2 WHERE Name = '${escapeSoqlString(name)}' ORDER BY CreatedDate DESC LIMIT 10`,
  )
  if (rows.length === 0) return null

  const eventSafeRows: Record<string, unknown>[] = []
  for (const row of rows) {
    const id = typeof row.Id === "string" ? row.Id : ""
    if (!id) continue
    const eventCheck = await productMatchesRaceEvent({
      product2Id: id,
      config: ctx.config,
      season: ctx.raceSeason,
      raceName: ctx.raceName,
    })
    if (eventCheck?.matches === false) continue
    eventSafeRows.push(row)
  }
  if (eventSafeRows.length === 0) return null

  if (ctx.config.fieldUnitPrice && ctx.tradePrice != null) {
    const priceMatch = eventSafeRows.find((row) => numClose(Number(row[ctx.config.fieldUnitPrice!]), ctx.tradePrice))
    if (priceMatch?.Id) return String(priceMatch.Id)
  }

  return typeof eventSafeRows[0]?.Id === "string" ? eventSafeRows[0].Id : null
}

/**
 * Creates Product2 in Salesforce. Your org's flow "Product_AutoCreationOfPBE_SingleTicketAndInclusion"
 * runs on insert and requires Unit_Price__c (mapped via SALESFORCE_FIELD_UNIT_PRICE) so it can
 * create the Standard Price Book entry with a UnitPrice.
 */
async function createProduct2(ctx: {
  productCode: string | null
  productName: string
  productFamily: string
  config: NonNullable<ReturnType<typeof getSalesforceConfig>>
  raceSeason: number | null
  raceName: string
  tradePrice: number | null
  stockTotal: number
  sellable: number
}): Promise<string> {
  const { productName, productFamily, config, tradePrice, stockTotal, sellable } = ctx
  const label = productName.trim() || "package"

  if (tradePrice == null || !Number.isFinite(tradePrice) || tradePrice <= 0) {
    throw new Error(
      `Cannot auto-create "${label}" in Salesforce without a trade price. ` +
        `Set the package trade price (enquiry-only packages cannot auto-create), or create the product manually in Salesforce and paste its 18-character Id under Salesforce Product Id.`,
    )
  }

  if (!config.fieldUnitPrice) {
    throw new Error(
      `Cannot auto-create "${label}" in Salesforce: SALESFORCE_FIELD_UNIT_PRICE is not set in .env.local. ` +
        `Your org's product Flow needs Unit_Price__c on insert. Add the field API name to .env.local, or create the product manually in Salesforce.`,
    )
  }

  // Do not send ProductCode — Salesforce assigns the next number via its own automation.
  const body: Record<string, unknown> = {
    Name: productName.slice(0, 255) || "Portal package",
    IsActive: true,
    [config.fieldUnitPrice]: tradePrice,
  }
  if (productFamily) body.Family = productFamily
  if (config.fieldStockQty) body[config.fieldStockQty] = stockTotal
  if (config.fieldAvailableQty) body[config.fieldAvailableQty] = sellable

  try {
    const created = await salesforceRequest<{ id: string }>("POST", "/sobjects/Product2", { body })
    const product2Id = created.id

    // Belt-and-suspenders: ensure Standard Price Book entry exists even if the SF flow is disabled later.
    try {
      await ensureStandardPricebookEntry(product2Id, tradePrice)
    } catch (pbeErr) {
      console.warn(
        "[salesforce] Pricebook entry after auto-create:",
        pbeErr instanceof Error ? pbeErr.message : pbeErr,
      )
    }

    return product2Id
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const flowHint = msg.includes("UnitPrice") || msg.includes("Product_AutoCreationOfPBE")
      ? " Ensure the package has a trade price set — Salesforce uses it to create the price book entry."
      : ""
    throw new Error(
      `Could not auto-create the Salesforce product for "${label}": ${msg}.${flowHint} ` +
        `Or create the product manually in Salesforce, paste its 18-character Id (01t…) under Salesforce Product Id, and sync again.`,
    )
  }
}

async function verifyProduct2Sync(ctx: {
  product2Id: string
  config: NonNullable<ReturnType<typeof getSalesforceConfig>>
  syncStarted: number
  expected: {
    name: string
    tradePrice: number | null
    sellable: number
    stockTotal: number
  }
  fieldsUpdated: string[]
  pricebookUpdated: boolean
  fieldsSkipped: string[]
}): Promise<void> {
  const selectFields = ["Id", "Name", "LastModifiedDate"]
  if (ctx.config.fieldUnitPrice) selectFields.push(ctx.config.fieldUnitPrice)
  if (ctx.config.fieldStockQty) selectFields.push(ctx.config.fieldStockQty)
  if (ctx.config.fieldAvailableQty) selectFields.push(ctx.config.fieldAvailableQty)

  const rows = await salesforceQuery<Record<string, unknown>>(
    `SELECT ${selectFields.join(", ")} FROM Product2 WHERE Id = '${escapeSoqlString(ctx.product2Id)}' LIMIT 1`,
  )
  const sf = rows[0]
  if (!sf) throw new Error("Salesforce product vanished after sync (verify query returned nothing).")

  const lastMod = sf.LastModifiedDate ? new Date(String(sf.LastModifiedDate)).getTime() : 0
  const productTouched = ctx.fieldsUpdated.some((f) => f !== "Standard PricebookEntry.UnitPrice")

  if (productTouched && lastMod < ctx.syncStarted - 2000) {
    throw new Error(
      `Salesforce product was not saved (Last Modified is still ${String(sf.LastModifiedDate)}). ` +
        `A background Flow may be rolling back changes. Ask your SF admin about flow "Product_AutoCreationOfPBE_SingleTicketAndInclusion". ` +
        `Skipped fields: ${ctx.fieldsSkipped.join("; ") || "none"}.`,
    )
  }

  const problems: string[] = []

  if (ctx.config.fieldUnitPrice && ctx.fieldsUpdated.includes(ctx.config.fieldUnitPrice)) {
    const sfPrice = Number(sf[ctx.config.fieldUnitPrice])
    if (!numClose(sfPrice, ctx.expected.tradePrice)) {
      problems.push(
        `Unit Price in SF is ${sfPrice} but portal trade price is ${ctx.expected.tradePrice}`,
      )
    }
  }

  if (
    ctx.config.fieldAvailableQty &&
    ctx.fieldsUpdated.includes(ctx.config.fieldAvailableQty) &&
    !numClose(Number(sf[ctx.config.fieldAvailableQty]), ctx.expected.sellable)
  ) {
    problems.push(`Available Quantity in SF does not match portal sellable (${ctx.expected.sellable}).`)
  }

  if (
    ctx.config.fieldStockQty &&
    ctx.fieldsUpdated.includes(ctx.config.fieldStockQty) &&
    !numClose(Number(sf[ctx.config.fieldStockQty]), ctx.expected.stockTotal)
  ) {
    problems.push(`Stock Quantity in SF does not match portal total received (${ctx.expected.stockTotal}).`)
  }

  if (problems.length > 0) {
    throw new Error(
      `Salesforce did not reflect portal values: ${problems.join(" ")} ` +
        `Updated: ${ctx.fieldsUpdated.join(", ") || "none"}. Skipped: ${ctx.fieldsSkipped.join("; ") || "none"}.`,
    )
  }

  if (ctx.pricebookUpdated && ctx.expected.tradePrice != null) {
    const pbe = await salesforceQuery<{ UnitPrice: number }>(
      `SELECT UnitPrice FROM PricebookEntry WHERE Product2Id = '${escapeSoqlString(ctx.product2Id)}' AND Pricebook2.IsStandard = true LIMIT 1`,
    )
    const pbePrice = pbe[0]?.UnitPrice != null ? Number(pbe[0].UnitPrice) : null
    if (pbePrice != null && !numClose(pbePrice, ctx.expected.tradePrice)) {
      throw new Error(
        `Standard Price Book list price is ${pbePrice} but portal trade price is ${ctx.expected.tradePrice}.`,
      )
    }
  }
}

async function ensureStandardPricebookEntry(product2Id: string, unitPrice: number): Promise<void> {
  const existing = await salesforceQuery<{ Id: string }>(
    `SELECT Id FROM PricebookEntry WHERE Product2Id = '${escapeSoqlString(product2Id)}' AND Pricebook2.IsStandard = true LIMIT 1`,
  )

  if (existing[0]?.Id) {
    await salesforceRequest("PATCH", `/sobjects/PricebookEntry/${existing[0].Id}`, {
      body: { UnitPrice: unitPrice, IsActive: true },
    })
    return
  }

  const pbs = await salesforceQuery<{ Id: string }>("SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1")
  const pricebook2Id = pbs[0]?.Id
  if (!pricebook2Id) throw new Error("Standard Price Book not found in Salesforce.")

  await salesforceRequest("POST", "/sobjects/PricebookEntry", {
    body: {
      Product2Id: product2Id,
      Pricebook2Id: pricebook2Id,
      UnitPrice: unitPrice,
      IsActive: true,
    },
  })
}

export async function findProduct2IdByCode(productCode: string): Promise<string | null> {
  return resolveProduct2IdByCode(productCode)
}
