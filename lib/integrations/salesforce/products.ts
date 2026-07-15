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
  isLinkedSellableDayPackage,
  readSfInventorySnapshot,
} from "@/lib/integrations/salesforce/inventory-snapshot"
import { getStoredInstanceUrl } from "@/lib/integrations/salesforce/settings-store"
import { productCodeLookupVariants } from "@/lib/integrations/salesforce/product-code"
import { findEventId, linkProductToEvent, resolveEventLookup, ensureEventId } from "@/lib/integrations/salesforce/events"
import {
  computeProductCommittedQuantityFromLines,
  computeProductQuantitySoldFromWonLines,
  syncProductValueSold,
} from "@/lib/integrations/salesforce/sold-metrics"
import {
  resolvePackageItemConfig,
  syncSalesforcePackageItems,
  syncSalesforcePackageItemsForLinkedGroup,
} from "@/lib/integrations/salesforce/package-items"
import { syncStockSourcesForProduct } from "@/lib/integrations/salesforce/stock-sources"
import { createAdminClient } from "@/lib/supabase/admin"
import { PACKAGE_COLUMNS, INVENTORY_COLUMNS } from "@/lib/catalog/columns"
import {
  ensureShellSingleTicketsForParent,
  resolveShellInventorySource,
} from "@/lib/catalog/ensure-shell-single-tickets"
import { SHELL_SINGLE_TICKET_FAMILY } from "@/lib/catalog/shell-single-tickets"
import { readLocalSoldForPackage } from "@/lib/inventory/local-sold"
import { syncLinkedGroupInventoryFromSalesforce } from "@/lib/inventory/linked-group-inventory"

type PackageRow = {
  id: string
  name: string
  description: string | null
  product_code: string | null
  salesforce_product_id: string | null
  salesforce_product_family: string | null
  duration: string | null
  inventory_group_id: string | null
  shell_parent_package_id: string | null
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
  if (row.shell_parent_package_id?.trim()) return SHELL_SINGLE_TICKET_FAMILY
  const duration = row.duration?.trim()
  const isDayDuration =
    duration === "thursday_only" ||
    duration === "friday_only" ||
    duration === "saturday_only" ||
    duration === "sunday_only"
  if (row.inventory_group_id?.trim() && isDayDuration) {
    return "Package"
  }
  if (isDayDuration) {
    return SHELL_SINGLE_TICKET_FAMILY
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

// readLocalSoldForPackage moved to @/lib/inventory/local-sold — shared with admin actions
// that reconstruct qty_available from cost-layer baselines.

/**
 * Salesforce Stock Quantity = units ever purchased (cost layers), never "sellable + sold".
 *
 * When the portal still shows full sellable (offline sales not yet applied to qty_available),
 * `sellable + sold` double-counts — e.g. bought 10, sold 4, sellable still 10 → Stock 14,
 * which then makes Quantity Sold look like 8 if Available stays at 6 (Stock − Available).
 *
 * Fall back to sellable + sold only when there are no cost layers (legacy / SF-only stock).
 */
function resolveSalesforceStockTotal(input: {
  totalReceived: number
  sellable: number
  sold: number
}): number {
  const received = Math.max(0, Math.floor(input.totalReceived))
  const sold = Math.max(0, Math.floor(input.sold))
  const sellable = Math.max(0, Math.floor(input.sellable))
  if (received > 0) {
    // Stock must at least cover closed-won even if layers under-count purchases.
    return Math.max(received, sold)
  }
  return Math.max(0, sellable + sold)
}

export async function syncPackageToSalesforce(
  packageId: string,
  options?: { skipLinkedInventoryHeal?: boolean },
): Promise<ProductSyncResult> {
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
  const isShellSingleTicket = !!row.shell_parent_package_id?.trim()
  let linkedGroupId = row.inventory_group_id?.trim() || null
  // Shells are not in inventory_group_id (so they don't min() the pool), but they still
  // share the parent's linked pool for Salesforce Stock/Available.
  if (!linkedGroupId && row.shell_parent_package_id?.trim()) {
    const { data: parentMeta } = await admin
      .from("packages")
      .select("inventory_group_id")
      .eq("id", row.shell_parent_package_id.trim())
      .maybeSingle()
    linkedGroupId = (parentMeta as { inventory_group_id?: string | null } | null)?.inventory_group_id?.trim() || null
  }
  const isLinkedPoolMember = !!linkedGroupId
  // Linked-group Stock/Available are owned by syncLinkedGroupInventoryFromSalesforce —
  // never push naive per-product Available (that reset Velocity 3-day/Sat&Sun to 200).
  const deferInventoryToLinkedHeal = isLinkedPoolMember
  // Only block auto-create for sellable linked day packages (not shells). Shells still
  // search thoroughly for an existing SF day product first; if none exists they are created.
  const blockSfAutoCreate = isLinkedSellableDayPackage(row)
  const productCode = row.product_code?.trim() || null
  const preferredId = row.salesforce_product_id?.trim() || null

  // Single Ticket shells have no independent stock — Available mirrors the matching day
  // sibling (or 3-day parent when there is no sellable day package); Stock mirrors the pool.
  let qtyPackageId = packageId
  let costLayerPackageId = packageId
  let inventorySourceNote: string | null = null
  if (row.shell_parent_package_id) {
    const source = await resolveShellInventorySource(admin, packageId).catch(() => null)
    if (source) {
      qtyPackageId = source.qtyAvailablePackageId
      costLayerPackageId = source.costLayerPackageId
      inventorySourceNote = source.description
    }
  }

  const { data: inv } = await admin
    .from("package_inventory")
    .select(INVENTORY_COLUMNS)
    .eq("package_id", qtyPackageId)
    .maybeSingle()

  const qtyAvailable = inv?.qty_available ?? 0
  const qtyHeld = inv?.qty_held ?? 0
  const sellable = Math.max(0, qtyAvailable - qtyHeld)

  // Total stock = sum of all cost layers (units ever received). Grows when admin buys more
  // stock; never drops on a booking. This is what Salesforce "Stock Quantity" should mirror.
  const { data: layers } = await admin
    .from("package_cost_layers")
    .select("quantity, source, received_at")
    .eq("package_id", costLayerPackageId)
  const totalReceived = (layers ?? []).reduce(
    (sum, l) => sum + (Number((l as { quantity: number | null }).quantity) || 0),
    0,
  )
  const localRecordedSold = await readLocalSoldForPackage(admin, qtyPackageId).catch(() => 0)
  let stockTotal = resolveSalesforceStockTotal({
    totalReceived,
    sellable,
    sold: localRecordedSold,
  })

  // Enquiry packages can still auto-create in Salesforce when a guide/trade price is set —
  // is_enquiry only blocks storefront checkout, not SF product creation.
  // Shell Single Tickets are always $0 — coerce null/missing to 0 so create never fails
  // when the portal row was just inserted and trade_price briefly reads empty.
  let tradePrice =
    row.trade_price != null && Number.isFinite(Number(row.trade_price))
      ? Number(row.trade_price)
      : null
  if (isShellSingleTicket && (tradePrice == null || tradePrice < 0)) {
    tradePrice = 0
  }
  const desc = typeof row.description === "string" ? row.description.trim() : ""

  let raceName = ""
  let raceSeason: number | null = null
  let raceLocation: string | null = null
  let raceShortName: string | null = null
  let raceEventDate: string | null = null
  let raceDateRange: string | null = null
  let parentPackageName: string | null = null
  if (row.shell_parent_package_id?.trim()) {
    const { data: parentRow } = await admin
      .from("packages")
      .select("name")
      .eq("id", row.shell_parent_package_id.trim())
      .maybeSingle()
    parentPackageName = (parentRow as { name?: string } | null)?.name?.trim() || null
  }
  if (row.race_id) {
    const { data: race } = await admin
      .from("races")
      .select("name, season, location, short_name, event_date, date_range")
      .eq("id", row.race_id)
      .maybeSingle()
    raceName = (race as { name?: string } | null)?.name?.trim() ?? ""
    const seasonVal = (race as { season?: number } | null)?.season
    raceSeason = typeof seasonVal === "number" ? seasonVal : null
    raceLocation = (race as { location?: string } | null)?.location?.trim() || null
    raceShortName = (race as { short_name?: string } | null)?.short_name?.trim() || null
    raceEventDate = (race as { event_date?: string } | null)?.event_date?.trim() || null
    raceDateRange = (race as { date_range?: string } | null)?.date_range?.trim() || null
  }

  const raceEventCtx = {
    season: raceSeason,
    raceName,
    location: raceLocation,
    shortName: raceShortName,
    eventDate: raceEventDate,
    dateRange: raceDateRange,
  }

  const preSyncNotes: string[] = []
  if (inventorySourceNote) {
    preSyncNotes.push(`Inventory ${inventorySourceNote} (shell has no independent stock).`)
  }
  let byCodeId: string | null = null
  let rejectStaleProductCode = false
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
        location: raceLocation,
        shortName: raceShortName,
        eventDate: raceEventDate,
        dateRange: raceDateRange,
      })
      if (raceName && eventCheck?.matches !== true) {
        rejectStaleProductCode = true
        preSyncNotes.push(
          `Product Code "${productCode}" belongs to another Salesforce event (${eventCheck?.message ?? "unverified"}); creating/linking the correct event product instead.`,
        )
      } else if (eventCheck?.matches === false) {
        rejectStaleProductCode = true
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

  // Don't carry a wrong-event Product Code into create/link (e.g. PR-000915 from Las Vegas
  // House 44 while syncing Mexico 2026).
  const effectiveProductCode = rejectStaleProductCode ? null : productCode

  const product2Id = await resolveProduct2IdForSync({
    productCode: effectiveProductCode,
    preferredId,
    byCodeId,
    productName: row.name.trim(),
    productFamily: inferSalesforceProductFamily(row, config.productFamily),
    duration: row.duration?.trim() || null,
    portalPackageId: packageId,
    config,
    raceSeason,
    raceName,
    raceLocation,
    raceShortName,
    raceEventDate,
    raceDateRange,
    tradePrice,
    stockTotal,
    sellable,
    skipInventoryPush: deferInventoryToLinkedHeal,
    blockSfAutoCreate,
    parentPackageName,
    shellParentPackageId: row.shell_parent_package_id?.trim() || null,
    isShellSingleTicket,
  })

  if (product2Id !== preferredId || rejectStaleProductCode) {
    await admin
      .from("packages")
      .update({
        salesforce_product_id: product2Id,
        ...(rejectStaleProductCode ? { product_code: null } : {}),
        integration_sync_status: "pending",
        integration_sync_error: null,
      })
      .eq("id", packageId)
  }

  const productFamily = inferSalesforceProductFamily(row, config.productFamily)
  const fieldsUpdated: string[] = []
  const fieldsSkipped: string[] = [...preSyncNotes]
  const [sfSnapshot, wonLineQty, committedLineQtyRaw] = await Promise.all([
    readSfInventorySnapshot(product2Id, config).catch((e) => {
      fieldsSkipped.push(`Salesforce inventory snapshot: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }),
    computeProductQuantitySoldFromWonLines(product2Id, config.opportunityStageWon).catch((e) => {
      fieldsSkipped.push(`Closed Won line quantity: ${e instanceof Error ? e.message : String(e)}`)
      return 0
    }),
    computeProductCommittedQuantityFromLines(product2Id, config.opportunityStageLost).catch((e) => {
      fieldsSkipped.push(`Non-lost line quantity: ${e instanceof Error ? e.message : String(e)}`)
      return -1
    }),
  ])
  const committedLineQty = committedLineQtyRaw === -1 ? wonLineQty : committedLineQtyRaw
  const openPipelineQty = Math.max(0, committedLineQty - wonLineQty)
  const sfStockTotal = sfSnapshot?.stock == null ? 0 : Math.max(0, Math.floor(sfSnapshot.stock))
  // Held units = closed-won (portal + SF) + open pipeline. Open opps hold Remaining until
  // Closed Lost; that Remaining is what we push as Salesforce Available so portal/Wix/SF match.
  const closedWonSold = Math.max(localRecordedSold, wonLineQty)
  const unitsHeldForRemaining = closedWonSold + openPipelineQty
  stockTotal = resolveSalesforceStockTotal({
    totalReceived,
    sellable,
    sold: closedWonSold,
  })
  // Preserve SF's higher stock only when the portal's cost layers can't account for all
  // closed-won sold units (indicating stock was added outside the portal).
  if (!isShellSingleTicket && sfStockTotal > stockTotal && totalReceived < closedWonSold) {
    stockTotal = sfStockTotal
  }
  let availableForSalesforce = Math.max(0, stockTotal - unitsHeldForRemaining)
  // Linked groups: never PATCH Stock/Available here — group heal owns the pool math
  // (Sat-only sales must reduce 3-day + Sat&Sun, not Fri, etc.).
  const skipLinkedInventory = deferInventoryToLinkedHeal
  if (skipLinkedInventory) {
    fieldsSkipped.push(
      "Stock/Available deferred to linked inventory group sync (pool + open-pipeline holds).",
    )
  } else if (availableForSalesforce !== sellable) {
    fieldsSkipped.push(
      `Available Quantity set to ${availableForSalesforce} (Stock ${stockTotal} − ${unitsHeldForRemaining} held: ${closedWonSold} closed-won + ${openPipelineQty} open pipeline). Portal sellable was ${sellable}.`,
    )
  }
  if (openPipelineQty > 0 && !skipLinkedInventory) {
    fieldsSkipped.push(
      `Salesforce has ${openPipelineQty} open pipeline unit(s) — reserved in Available so Remaining matches across channels.`,
    )
  }

  if (preferredId && byCodeId && preferredId !== byCodeId) {
    fieldsSkipped.push(
      `Product Code "${productCode}" is on a different Salesforce product (${byCodeId}). Syncing your chosen Id ${preferredId}.`,
    )
  }
  let pricebookUpdated = false

  const [, updateable] = await Promise.all([
    (async () => {
      if (tradePrice != null && Number.isFinite(tradePrice)) {
        await ensureStandardPricebookEntry(product2Id, tradePrice)
        pricebookUpdated = true
        fieldsUpdated.push("Standard PricebookEntry.UnitPrice")
      }
    })(),
    getProduct2UpdateableFields(),
  ])

  const fieldPatches: Array<{ api: string; value: unknown; label: string }> = []

  if (config.fieldUnitPrice && tradePrice != null) {
    fieldPatches.push({ api: config.fieldUnitPrice, value: tradePrice, label: "Unit Price" })
  }

  fieldPatches.push({ api: "Name", value: row.name.trim(), label: "Name" })
  if (productFamily) fieldPatches.push({ api: "Family", value: productFamily, label: "Family" })
  if (desc) fieldPatches.push({ api: "Description", value: desc.slice(0, 32000), label: "Description" })

  const batchBody: Record<string, unknown> = {}
  for (const patch of fieldPatches) {
    if (PROTECTED_SALESFORCE_PRODUCT_FIELDS.has(patch.api)) {
      fieldsSkipped.push(`${patch.label} (${patch.api} is owned by Salesforce — not synced from portal)`)
      continue
    }
    if (!updateable.has(patch.api)) {
      fieldsSkipped.push(`${patch.label} (${patch.api} is read-only or invalid)`)
      continue
    }
    batchBody[patch.api] = patch.value
  }

  // Inventory fields bypass the updateable check — they're explicitly configured env
  // variables and some orgs mark them as formula/rollup in describe yet still accept writes.
  // Sent in the same PATCH to avoid an extra roundtrip.
  if (!skipLinkedInventory) {
    if (config.fieldStockQty && !PROTECTED_SALESFORCE_PRODUCT_FIELDS.has(config.fieldStockQty)) {
      batchBody[config.fieldStockQty] = stockTotal
    }
    if (config.fieldAvailableQty && !PROTECTED_SALESFORCE_PRODUCT_FIELDS.has(config.fieldAvailableQty)) {
      batchBody[config.fieldAvailableQty] = availableForSalesforce
    }
  }

  if (Object.keys(batchBody).length > 0) {
    try {
      await salesforceRequest("PATCH", `/sobjects/Product2/${product2Id}`, { body: batchBody })
      for (const key of Object.keys(batchBody)) fieldsUpdated.push(key)
    } catch (e) {
      // If the combined PATCH failed (e.g. inventory field is truly read-only), retry
      // without inventory fields so the rest of the sync still succeeds.
      const inventoryFields = new Set([config.fieldStockQty, config.fieldAvailableQty].filter(Boolean))
      const hasInventory = Object.keys(batchBody).some((k) => inventoryFields.has(k))
      if (hasInventory) {
        const retryBody: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(batchBody)) {
          if (!inventoryFields.has(k)) retryBody[k] = v
        }
        try {
          if (Object.keys(retryBody).length > 0) {
            await salesforceRequest("PATCH", `/sobjects/Product2/${product2Id}`, { body: retryBody })
            for (const key of Object.keys(retryBody)) fieldsUpdated.push(key)
          }
          for (const f of inventoryFields) {
            if (f && f in batchBody) fieldsSkipped.push(`${f}: field is read-only in Salesforce`)
          }
        } catch (e2) {
          const msg = e2 instanceof Error ? e2.message : String(e2)
          fieldsSkipped.push(`Product2 update: ${msg}`)
        }
      } else {
        const msg = e instanceof Error ? e.message : String(e)
        fieldsSkipped.push(`Product2 update: ${msg}`)
      }
    }
  }

  // Event link + Value Sold are independent — run in parallel.
  await Promise.all([
    (async () => {
      if (raceName) {
        const evt = await linkProductToEvent({
          product2Id,
          config,
          season: raceSeason,
          raceName,
          location: raceLocation,
          shortName: raceShortName,
          eventDate: raceEventDate,
          dateRange: raceDateRange,
        })
        if (evt.ok) {
          fieldsUpdated.push(
            `${evt.field} (Event)${evt.createdEvent ? " — created Salesforce event" : ""}`,
          )
        } else {
          fieldsSkipped.push(`Event link: ${evt.message}`)
        }
      }
    })(),
    syncProductValueSold({ product2Id, config, fieldsUpdated, fieldsSkipped }),
  ])

  // 3-day parents need three Single Ticket children in Salesforce (Fri/Sat/Sun, or
  // Thu/Fri/Sat for LV-style races). Ensure shells exist and are themselves synced before
  // we link them. This also handles the backfill case for pre-existing 3-day packages:
  // shells are created for all three days even if a sellable single-day sibling already
  // covers that day — the sibling links to the same shell as its Phase 2 child so a
  // future single-day sale reports under the same day Single Ticket.
  if (row.duration === "3_day" && !row.shell_parent_package_id) {
    const ensured = await ensureShellSingleTicketsForParent(admin, packageId)
    // Sync shells one-at-a-time — parallel creates raced Salesforce price-book Flow and
    // left the parent showing "Sync failed" even though later outbox passes succeeded.
    const shellErrors: string[] = []
    let shellsSynced = 0
    for (const shellId of ensured.shellPackageIds) {
      try {
        await syncPackageToSalesforce(shellId, { skipLinkedInventoryHeal: true })
        shellsSynced++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        shellErrors.push(`${shellId}: ${msg}`)
      }
    }
    if (ensured.created.length > 0) {
      fieldsUpdated.push(`Shell single tickets (${ensured.created.length} portal rows created)`)
    }
    if (shellsSynced > 0) {
      fieldsUpdated.push(`Shell single tickets synced (${shellsSynced})`)
    }
    if (shellErrors.length > 0) {
      // Parent Product2 is already created — don't fail the whole sync. Queue shell retries
      // so the next cron/drain finishes children without a scary red error on the parent.
      fieldsSkipped.push(
        `Single ticket children pending retry (${shellErrors.length}): ${shellErrors.join(" | ")}`,
      )
      const { enqueuePackageInventorySyncServer } = await import("@/lib/integrations/enqueue-server")
      for (let i = 0; i < ensured.shellPackageIds.length; i++) {
        const shellId = ensured.shellPackageIds[i]
        if (!shellErrors.some((err) => err.startsWith(shellId))) continue
        await enqueuePackageInventorySyncServer(shellId, {
          trigger: "shell-retry-after-parent",
          scheduleDrain: true,
        }).catch(() => undefined)
      }
    }
  }

  // Package items, stock sources, and listing content are independent — run in parallel.
  await Promise.all([
    syncSalesforcePackageItemsForLinkedGroup({
      packageId,
      product2Id,
      config,
      fieldsUpdated,
      fieldsSkipped,
    }),
    ...(isShellSingleTicket
      ? []
      : [
          (async () => {
            try {
              const stockSourceResult = await syncStockSourcesForProduct({ admin, packageId, product2Id })
              if (stockSourceResult.groups > 0 || stockSourceResult.removed > 0) {
                fieldsUpdated.push(
                  `Stock sources (${stockSourceResult.upserted} upserted${stockSourceResult.removed > 0 ? `, ${stockSourceResult.removed} removed` : ""})`,
                )
              }
              if (stockSourceResult.errors.length > 0) {
                for (const err of stockSourceResult.errors) fieldsSkipped.push(`Stock source: ${err}`)
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              fieldsSkipped.push(`Stock sources: ${msg}`)
            }
          })(),
          (async () => {
            const listingPayload = await buildCatalogListingPayload(admin, packageId)
            await applyListingContentToProduct2(product2Id, listingPayload, config, {
              fieldsUpdated,
              fieldsSkipped,
            })
          })(),
        ]),
  ])

  if (fieldsUpdated.length === 0 && !pricebookUpdated && !deferInventoryToLinkedHeal) {
    throw new Error(
      `Nothing could be updated in Salesforce. Skipped: ${fieldsSkipped.join("; ") || "all fields"}. ` +
        `Check field API names in .env.local match Setup → Object Manager → Product.`,
    )
  }

  // Verify + product code read in parallel (independent of each other).
  let sfProductCode: string | null = null
  await Promise.all([
    (async () => {
      if (!isShellSingleTicket) {
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
          skipInventoryVerification: skipLinkedInventory,
        })
      }
    })(),
    (async () => {
      sfProductCode = await readSalesforceProductCode(product2Id)
      if (!sfProductCode && !productCode) {
        sfProductCode = await readSalesforceProductCodeWithRetry(product2Id)
      }
    })(),
  ])
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

  // When a shell Single Ticket gets its Salesforce Id (often on a retry after the parent
  // sync), re-link Package Items on the 3-day parent so SF Package Items is not left empty.
  if (isShellSingleTicket && row.shell_parent_package_id?.trim()) {
    const parentId = row.shell_parent_package_id.trim()
    try {
      const { data: parentPkg } = await admin
        .from("packages")
        .select("salesforce_product_id")
        .eq("id", parentId)
        .maybeSingle()
      const parentProduct2Id =
        (parentPkg as { salesforce_product_id?: string | null } | null)?.salesforce_product_id?.trim() ||
        null
      if (parentProduct2Id) {
        const parentItemNotes: string[] = []
        const parentItemSkipped: string[] = []
        await syncSalesforcePackageItems({
          parentPackageId: parentId,
          parentProduct2Id,
          config,
          fieldsUpdated: parentItemNotes,
          fieldsSkipped: parentItemSkipped,
        })
        if (parentItemNotes.length > 0) {
          fieldsUpdated.push(`Parent package items: ${parentItemNotes.join(", ")}`)
        }
        for (const note of parentItemSkipped) fieldsSkipped.push(`Parent package items: ${note}`)
      }
    } catch (e) {
      fieldsSkipped.push(
        `Parent package items refresh: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  if (!isShellSingleTicket) {
    try {
      await syncListingContentToWix(packageId, await buildCatalogListingPayload(admin, packageId))
    } catch (e) {
      console.warn("[wix] Listing content sync skipped:", e instanceof Error ? e.message : e)
    }
  }

  // After metadata sync, refresh the whole linked pool so Remaining matches on every
  // day / 3-day / 2-day / shell product (open pipeline holds included).
  if (linkedGroupId && !options?.skipLinkedInventoryHeal) {
    try {
      const healed = await syncLinkedGroupInventoryFromSalesforce(admin, linkedGroupId, config)
      fieldsUpdated.push(
        `Linked inventory group synced (${healed.updated.length} package${healed.updated.length === 1 ? "" : "s"})`,
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      fieldsSkipped.push(`Linked inventory group sync: ${msg}`)
      console.warn("[salesforce] Linked inventory heal after product sync:", msg)
    }
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

/** SF flows can assign ProductCode a moment after Product2 insert — short poll for new products only. */
async function readSalesforceProductCodeWithRetry(
  product2Id: string,
  maxAttempts = 4,
): Promise<string | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = await readSalesforceProductCode(product2Id)
    if (code) return code
    if (attempt < maxAttempts - 1) await new Promise((r) => setTimeout(r, 300))
  }
  return null
}

async function productMatchesRaceEvent(args: {
  product2Id: string
  config: NonNullable<ReturnType<typeof getSalesforceConfig>>
  season: number | null
  raceName: string
  location?: string | null
  shortName?: string | null
  eventDate?: string | null
  dateRange?: string | null
}): Promise<{ matches: boolean; message: string } | null> {
  const raceName = args.raceName.trim()
  if (!raceName) return null

  const lookup = await resolveEventLookup(args.config).catch(() => null)
  if (!lookup) return null

  const rows = await salesforceQuery<Record<string, unknown>>(
    `SELECT Id, Name, ${lookup.field} FROM Product2 WHERE Id = '${escapeSoqlString(args.product2Id)}' LIMIT 1`,
  )
  const row = rows[0]
  const actualEventId = row?.[lookup.field] == null ? "" : String(row[lookup.field]).trim()

  // Prefer ensure so a missing Mexico/etc. event is created rather than falling through to
  // "unknown" and accidentally reusing a same-named product on Las Vegas / another GP.
  const ensured = await ensureEventId(lookup.object, {
    season: args.season,
    raceName,
    location: args.location,
    shortName: args.shortName,
    eventDate: args.eventDate,
    dateRange: args.dateRange,
  }).catch(() => null)
  const expectedEventId =
    ensured?.eventId ??
    (await findEventId(lookup.object, args.season, raceName).catch(() => null))

  if (!expectedEventId) {
    if (!actualEventId) {
      return { matches: true, message: "candidate has no event set" }
    }
    return {
      matches: false,
      message: `no Salesforce event for ${args.season ?? ""} ${raceName}`.trim() +
        `; candidate is already on another event (${actualEventId})`,
    }
  }

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

function linkedSellableDayAutoCreateError(productName: string): Error {
  return new Error(
    `Cannot auto-create a Salesforce product for linked day package "${productName}". ` +
      `Paste the existing Product2 Id for this day on this event (Relink / Salesforce Product Id), ` +
      `or restore the product in Salesforce if it was deleted with the portal package. ` +
      `Auto-creating a blank duplicate shows 0 stock and breaks the whole linked group within a minute.`,
  )
}

async function resolveProduct2IdForSync(ctx: {
  productCode: string | null
  preferredId: string | null
  byCodeId: string | null
  productName: string
  productFamily: string
  duration: string | null
  portalPackageId: string
  config: NonNullable<ReturnType<typeof getSalesforceConfig>>
  raceSeason: number | null
  raceName: string
  raceLocation?: string | null
  raceShortName?: string | null
  raceEventDate?: string | null
  raceDateRange?: string | null
  tradePrice: number | null
  stockTotal: number
  sellable: number
  skipInventoryPush?: boolean
  blockSfAutoCreate?: boolean
  parentPackageName?: string | null
  shellParentPackageId?: string | null
  isShellSingleTicket?: boolean
}): Promise<string> {
  const isMultiDay = ctx.duration === "3_day" || ctx.duration === "2_day"

  if (ctx.preferredId) {
    const rows = await salesforceQuery<{
      Id: string
      ProductCode: string | null
      Name: string
      CreatedDate?: string
    }>(
      `SELECT Id, ProductCode, Name, CreatedDate FROM Product2 WHERE Id = '${escapeSoqlString(ctx.preferredId)}' LIMIT 1`,
    )
    const hit = rows[0]
    if (!hit?.Id) {
      if (isMultiDay) {
        if (ctx.blockSfAutoCreate) throw linkedSellableDayAutoCreateError(ctx.productName)
        return createProduct2({ ...ctx, productCode: null })
      }
      const existing = await findExistingProduct2ForCreate(ctx)
      if (existing) return existing
      if (ctx.blockSfAutoCreate) throw linkedSellableDayAutoCreateError(ctx.productName)
      return createProduct2({ ...ctx, productCode: null })
    }

    // Pre-season Product2 with the exact portal display name (e.g. 2024 Las Vegas House 44
    // record that linkProductToEvent later moved onto 2026 Mexico). Never keep reusing it.
    if (
      isMultiDay &&
      hit.Name &&
      isPreSeasonSameNameLeftover(ctx.productName, hit.Name, hit.CreatedDate, ctx.raceSeason)
    ) {
      if (ctx.blockSfAutoCreate) throw linkedSellableDayAutoCreateError(ctx.productName)
      return createProduct2({ ...ctx, productCode: null })
    }

    // Linked to a product on the wrong Salesforce event — create fresh for this race.
    if (ctx.raceName.trim()) {
      const eventCheck = await productMatchesRaceEvent({
        product2Id: hit.Id,
        config: ctx.config,
        season: ctx.raceSeason,
        raceName: ctx.raceName,
        location: ctx.raceLocation,
        shortName: ctx.raceShortName,
        eventDate: ctx.raceEventDate,
        dateRange: ctx.raceDateRange,
      })
      if (eventCheck?.matches === false) {
        if (ctx.blockSfAutoCreate) throw linkedSellableDayAutoCreateError(ctx.productName)
        return createProduct2({ ...ctx, productCode: null })
      }
    }

    // Shell linked to a portal-generated duplicate — prefer a legacy SF day product if one exists.
    if (ctx.isShellSingleTicket && hit.Name && looksLikePortalGeneratedSingleTicket(hit.Name)) {
      const rematch = await findExistingProduct2ForCreate(ctx)
      if (rematch && rematch !== hit.Id) return rematch
    }
    return hit.Id
  }

  if (ctx.byCodeId) {
    // Product codes can outlive a cleared Product Id. For multi-day packages, never accept a
    // code that resolves to a pre-season same-name leftover (PR-000915 → Vegas House 44).
    if (isMultiDay) {
      const codeRows = await salesforceQuery<{ Id: string; Name: string; CreatedDate?: string }>(
        `SELECT Id, Name, CreatedDate FROM Product2 WHERE Id = '${escapeSoqlString(ctx.byCodeId)}' LIMIT 1`,
      )
      const codeHit = codeRows[0]
      if (
        codeHit?.Id &&
        codeHit.Name &&
        isPreSeasonSameNameLeftover(ctx.productName, codeHit.Name, codeHit.CreatedDate, ctx.raceSeason)
      ) {
        if (ctx.blockSfAutoCreate) throw linkedSellableDayAutoCreateError(ctx.productName)
        return createProduct2({ ...ctx, productCode: null })
      }
    }
    return ctx.byCodeId
  }

  // No Product Id / code — match existing SF products first (name, shell Package Items, event).
  // Pre-season same-name leftovers are rejected inside findExisting* so Mexico House 44
  // cannot reattach, while Brazil "F1 Experiences" still links to "Paddock Club F1E Suite".
  const existing = await findExistingProduct2ForCreate(ctx)
  if (existing) return existing
  if (ctx.blockSfAutoCreate) throw linkedSellableDayAutoCreateError(ctx.productName)
  return createProduct2(ctx)
}

const DAY_DURATION_KEYWORD: Record<string, string> = {
  thursday_only: "Thursday",
  friday_only: "Friday",
  saturday_only: "Saturday",
  sunday_only: "Sunday",
}

/**
 * Token aliases for soft name matching.
 * IMPORTANT: do NOT equate "f1" with "f1e" — F1E / F1 Experiences Paddock Club is a
 * different product from Paddock Club Club Suite (which often just says "F1").
 */
const TOKEN_EQUIVALENCE_GROUPS: string[][] = [
  ["f1e", "experiences"],
]

/**
 * Brand spellings that are one word in Salesforce and two in the portal (or vice versa).
 * Applied before tokenization so "Redbull" ↔ "Red Bull" soft-match.
 */
function canonicalizeBrandSpelling(name: string): string {
  return name
    .replace(/\bredbull\b/gi, "red bull")
    .replace(/\bmercedesbenz\b/gi, "mercedes benz")
}

/** Portal-generated shells always include "Single Ticket"; legacy SF day lines usually do not. */
function looksLikePortalGeneratedSingleTicket(name: string): boolean {
  return /\bsingle\s+ticket\b/i.test(name)
}

/**
 * True when the linked SF product name is essentially the portal package name
 * (exact or near-exact) — typical of an auto-created duplicate rather than a
 * legacy SF product with a different naming style.
 */
function namesLookLikeSamePortalPackage(portalName: string, sfName: string): boolean {
  const a = portalName.trim().toLowerCase().replace(/\s+/g, " ")
  const b = sfName.trim().toLowerCase().replace(/\s+/g, " ")
  if (!a || !b) return false
  if (a === b) return true
  // Portal often creates with the exact display name; allow minor punctuation drift.
  const norm = (s: string) => s.replace(/[^a-z0-9]+/g, " ").trim()
  return norm(a) === norm(b)
}

/**
 * Pre-season Product2 with the same portal display name (e.g. 2024 Vegas House 44 later
 * moved onto 2026 Mexico). Soft-matching those reattaches the wrong legacy record.
 * Legacy SF products with a *different* naming style (F1E Suite vs F1 Experiences) are fine.
 */
function isPreSeasonSameNameLeftover(
  portalName: string,
  sfName: string,
  createdDate: string | undefined | null,
  raceSeason: number | null,
): boolean {
  if (raceSeason == null || !createdDate) return false
  if (!namesLookLikeSamePortalPackage(portalName, sfName)) return false
  const createdMs = new Date(createdDate).getTime()
  const seasonStartMs = Date.UTC(raceSeason, 0, 1)
  return Number.isFinite(createdMs) && createdMs < seasonStartMs
}

type SingleTicketCandidate = { Id: string; Name: string; CreatedDate?: string }

/**
 * Filter and rank single ticket candidates using soft name compatibility
 * (optional fluff ignored on both sides; brand tokens still required).
 * Prefer legacy SF naming (no "Single Ticket" suffix), then oldest record.
 */
function rankSingleTicketCandidates(
  candidates: SingleTicketCandidate[],
  ctx: {
    productName: string
    parentPackageName?: string | null
    dayKeyword: string
  },
): SingleTicketCandidate[] {
  const combinedPortalName = [ctx.parentPackageName?.trim(), ctx.productName.trim()]
    .filter(Boolean)
    .join(" ")

  return candidates
    .filter((c) => softBidirectionalNameCompatible(combinedPortalName, c.Name))
    .map((c) => ({
      ...c,
      portalStyle: looksLikePortalGeneratedSingleTicket(c.Name) ? 1 : 0,
    }))
    .sort((a, b) => {
      if (a.portalStyle !== b.portalStyle) return a.portalStyle - b.portalStyle
      const aTime = a.CreatedDate ? new Date(a.CreatedDate).getTime() : 0
      const bTime = b.CreatedDate ? new Date(b.CreatedDate).getTime() : 0
      return aTime - bTime
    })
    .map(({ Id, Name }) => ({ Id, Name }))
}

async function findExistingShellViaParentPackageItems(args: {
  shellParentPackageId: string
  dayKeyword: string
  portalPackageId: string
  productName: string
  parentPackageName?: string | null
  config: NonNullable<ReturnType<typeof getSalesforceConfig>>
}): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null

  const { data: parent } = await admin
    .from("packages")
    .select("salesforce_product_id, name")
    .eq("id", args.shellParentPackageId)
    .maybeSingle()
  const parentSfId = (parent as { salesforce_product_id?: string | null } | null)?.salesforce_product_id?.trim()
  if (!parentSfId) return null

  const parentName = args.parentPackageName ?? (parent as { name?: string } | null)?.name?.trim() ?? null

  const itemConfig = resolvePackageItemConfig(args.config)
  if (!itemConfig) return null

  const itemRows = await salesforceQuery<Record<string, unknown>>(
    `SELECT Id, ${itemConfig.child} FROM ${itemConfig.object} WHERE ${itemConfig.parent} = '${escapeSoqlString(parentSfId)}'`,
  )
  const childIds = [
    ...new Set(itemRows.map((row) => String(row[itemConfig.child] ?? "")).filter(Boolean)),
  ]
  if (childIds.length === 0) return null

  const inList = childIds.map((id) => `'${escapeSoqlString(id)}'`).join(", ")
  const products = await salesforceQuery<SingleTicketCandidate>(
    `SELECT Id, Name, CreatedDate FROM Product2 WHERE Id IN (${inList}) AND IsActive = true`,
  )
  if (products.length === 0) return null

  const dayMatches = products.filter((p) => p.Name.toLowerCase().includes(args.dayKeyword.toLowerCase()))
  const pool = dayMatches.length > 0 ? dayMatches : products.length === 1 ? products : []
  if (pool.length === 0) return null

  // Parent Package Items already link these day products to the 3-day — that graph is
  // stronger than soft name matching. "Redbull Racing…" vs portal "Red Bull" used to
  // fail soft-match and auto-create duplicate Single Tickets (PR-001021…).
  const variantSafe = pool.filter((p) =>
    paddockClubVariantsCompatible(
      [args.parentPackageName, args.productName].filter(Boolean).join(" "),
      p.Name,
    ),
  )
  const trustPool = variantSafe.length > 0 ? variantSafe : pool
  const unclaimedTrusted = await filterUnclaimedProduct2Candidates(trustPool, args.portalPackageId)
  if (unclaimedTrusted.length === 1) return unclaimedTrusted[0].Id

  const ranked = rankSingleTicketCandidates(trustPool, {
    productName: args.productName,
    parentPackageName: parentName,
    dayKeyword: args.dayKeyword,
  })
  const unclaimed = await filterUnclaimedProduct2Candidates(
    ranked.length > 0 ? ranked : trustPool,
    args.portalPackageId,
  )
  return resolveUniqueProduct2Match(args.productName, unclaimed)
}


/** Generic words that don't distinguish one product from another within the same event/day. */
const NAME_MATCH_STOPWORDS = new Set([
  "only", "single", "ticket", "tickets", "day", "days", "package", "the", "and",
  "1", "2", "3", "f1", "gp", "grand", "prix",
  "thursday", "friday", "saturday", "sunday",
])

/**
 * Optional fluff that may appear on either portal or Salesforce names without
 * changing which product it is. Used for soft multi-day / day matching.
 *
 * Examples:
 *   portal "3 Day Paddock Club - Team Haas"
 *   SF     "Paddock Club 3-Days | TGR Haas F1 Team Suite"
 * Brand tokens (haas, alpine, champions, …) are never optional.
 *
 * "experiences" is NOT fluff — it marks F1 Experiences / F1E vs Club Suite.
 */
const NAME_MATCH_OPTIONAL_FLUFF = new Set([
  "team",
  "hospitality",
  "exclusive",
  "oracle",
  "racing",
  "suite",
  "tgr",
  "toyota",
  "gazoo",
  "all",
  "inclusive",
])

/**
 * Paddock Club has two distinct Salesforce product lines that must never soft-match:
 *   - F1 Experiences / F1E  (Paddock Club name contains "f1e" or "f1 experiences")
 *   - Club Suite            (Paddock Club without those markers)
 *
 * Only applies to actual Paddock Club products. "F1 Experiences Lounge" and similar
 * non-paddock packages return null so they can auto-create without being blocked by
 * unrelated Alpine/Red Bull Paddock Club rows on the same event.
 */
type PaddockClubVariant = "f1_experiences" | "club_suite"

function paddockClubVariant(name: string): PaddockClubVariant | null {
  const n = name.trim().toLowerCase()
  if (!n) return null
  const tokens = new Set(nameTokens(n))
  // Must be Paddock Club — "F1 Experiences Lounge" is a different product family.
  if (!tokens.has("paddock") || !tokens.has("club")) return null

  const isF1Experiences =
    tokens.has("f1e") ||
    /\bf1\s*experiences?\b/.test(n) ||
    tokens.has("experiences")

  return isF1Experiences ? "f1_experiences" : "club_suite"
}

function paddockClubVariantsCompatible(portalName: string, candidateName: string): boolean {
  const a = paddockClubVariant(portalName)
  const b = paddockClubVariant(candidateName)
  if (a == null || b == null) return true
  return a === b
}

function paddockClubVariantLabel(variant: PaddockClubVariant): string {
  return variant === "f1_experiences" ? "F1 Experiences / F1E" : "Paddock Club Club Suite"
}

function nameTokens(name: string): string[] {
  return canonicalizeBrandSpelling(name)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function distinctiveNameTokens(name: string, treatAsOptional?: ReadonlySet<string>): string[] {
  return nameTokens(name).filter(
    (t) => !NAME_MATCH_STOPWORDS.has(t) && !(treatAsOptional?.has(t) ?? false),
  )
}

/**
 * Check if token `a` appears in `tokens` either directly or via TOKEN_EQUIVALENCE_GROUPS.
 */
function tokenPresentWithEquivalence(a: string, tokens: Set<string>): boolean {
  if (tokens.has(a)) return true
  for (const group of TOKEN_EQUIVALENCE_GROUPS) {
    if (group.includes(a)) {
      for (const equiv of group) {
        if (tokens.has(equiv)) return true
      }
    }
  }
  return false
}

/**
 * A Salesforce candidate is compatible when every distinctive word in ITS name also appears in
 * the portal package name (with token equivalence). e.g. portal "Sunday Paddock Club - Club
 * Suite (F1)" accepts SF "Paddock Club Club Suite SUNDAY ONLY" but rejects "F1E Suite Paddock
 * Club - Sunday" because F1 Experiences ≠ Club Suite (and f1e ≢ f1).
 */
function candidateNameCompatible(portalName: string, candidateName: string): boolean {
  if (!paddockClubVariantsCompatible(portalName, candidateName)) return false
  const portalTokens = new Set(nameTokens(portalName))
  const distinctive = distinctiveNameTokens(candidateName)
  if (distinctive.length === 0) return false
  return distinctive.every((t) => tokenPresentWithEquivalence(t, portalTokens))
}

/**
 * Soft bidirectional match: ignore optional fluff on both sides, but require every
 * remaining distinctive token to appear in the other name. Prevents Alpine↔Haas,
 * Haas↔Club Suite, and F1 Experiences↔Club Suite, while allowing
 * "Team Haas" ↔ "TGR Haas F1 Team Suite" and "F1 Experiences" ↔ "F1E Suite".
 */
function softBidirectionalNameCompatible(portalName: string, candidateName: string): boolean {
  if (!paddockClubVariantsCompatible(portalName, candidateName)) return false
  const portalRequired = distinctiveNameTokens(portalName, NAME_MATCH_OPTIONAL_FLUFF)
  const candidateRequired = distinctiveNameTokens(candidateName, NAME_MATCH_OPTIONAL_FLUFF)
  if (portalRequired.length === 0 || candidateRequired.length === 0) return false
  const portalTokens = new Set(nameTokens(portalName))
  const candidateTokens = new Set(nameTokens(candidateName))
  return (
    candidateRequired.every((t) => tokenPresentWithEquivalence(t, portalTokens)) &&
    portalRequired.every((t) => tokenPresentWithEquivalence(t, candidateTokens))
  )
}

/** Both names must share the same distinctive tokens (handles "3 Day X" vs "X - 3 days"). */
function packageNamesCompatible(portalName: string, candidateName: string): boolean {
  return candidateNameCompatible(portalName, candidateName) && candidateNameCompatible(candidateName, portalName)
}

/** Multi-day Package matching — soft fluff-aware bidirectional check. */
function multiDayPackageNamesCompatible(portalName: string, candidateName: string): boolean {
  return softBidirectionalNameCompatible(portalName, candidateName)
}

function sfNameMatchesMultiDayDuration(name: string, duration: "3_day" | "2_day"): boolean {
  const n = name.toLowerCase()
  if (duration === "3_day") {
    return /\b3\s*-?\s*days?\b/.test(n) || (/\bthree\b/.test(n) && /\bdays?\b/.test(n))
  }
  return /\b2\s*-?\s*days?\b/.test(n) || (/\btwo\b/.test(n) && /\bdays?\b/.test(n))
}

function looksLikeSingleDayProductName(name: string): boolean {
  const n = name.toLowerCase()
  if (/\bsingle\s+ticket\b/.test(n)) return true
  return /\b(thursday|friday|saturday|sunday)\b/.test(n) && !sfNameMatchesMultiDayDuration(name, "3_day") && !sfNameMatchesMultiDayDuration(name, "2_day")
}

async function filterUnclaimedProduct2Candidates(
  compatible: Array<{ Id: string; Name: string }>,
  portalPackageId: string,
): Promise<Array<{ Id: string; Name: string }>> {
  const admin = createAdminClient()
  const unclaimed: Array<{ Id: string; Name: string }> = []
  for (const c of compatible) {
    if (admin) {
      const { data: owner } = await admin
        .from("packages")
        .select("id")
        .eq("salesforce_product_id", c.Id)
        .neq("id", portalPackageId)
        .limit(1)
        .maybeSingle()
      if (owner) continue
    }
    unclaimed.push(c)
  }
  return unclaimed
}

function resolveUniqueProduct2Match(
  productName: string,
  unclaimed: Array<{ Id: string; Name: string }>,
): string | null {
  if (unclaimed.length === 0) return null
  if (unclaimed.length > 1) {
    const list = unclaimed.map((c) => `"${c.Name}" (${c.Id})`).join(", ")
    throw new Error(
      `Found ${unclaimed.length} existing Salesforce products that could match "${productName}": ${list}. ` +
        `Pick the right one and paste its Id via the Relink option (or Salesforce Product Id field) — a duplicate was NOT created.`,
    )
  }
  return unclaimed[0].Id
}

async function findExistingProduct2ForCreate(ctx: {
  productName: string
  productFamily: string
  duration: string | null
  portalPackageId: string
  config: NonNullable<ReturnType<typeof getSalesforceConfig>>
  raceSeason: number | null
  raceName: string
  raceLocation?: string | null
  raceShortName?: string | null
  raceEventDate?: string | null
  raceDateRange?: string | null
  tradePrice: number | null
  parentPackageName?: string | null
  shellParentPackageId?: string | null
}): Promise<string | null> {
  const name = ctx.productName.trim()
  if (!name) return null

  const isShellSingleTicket = !!ctx.shellParentPackageId?.trim()

  if (!isShellSingleTicket) {
    const select = ["Id", "Name", "CreatedDate"]
    if (ctx.config.fieldUnitPrice) select.push(ctx.config.fieldUnitPrice)

    const rows = await salesforceQuery<Record<string, unknown>>(
      `SELECT ${select.join(", ")} FROM Product2 WHERE Name = '${escapeSoqlString(name)}' ORDER BY CreatedDate DESC LIMIT 10`,
    )

    const eventSafeRows: Record<string, unknown>[] = []
    for (const row of rows) {
      const id = typeof row.Id === "string" ? row.Id : ""
      if (!id) continue
      const sfName = typeof row.Name === "string" ? row.Name : ""
      const createdDate = typeof row.CreatedDate === "string" ? row.CreatedDate : null
      if (isPreSeasonSameNameLeftover(name, sfName, createdDate, ctx.raceSeason)) continue
      const eventCheck = await productMatchesRaceEvent({
        product2Id: id,
        config: ctx.config,
        season: ctx.raceSeason,
        raceName: ctx.raceName,
        location: ctx.raceLocation,
        shortName: ctx.raceShortName,
        eventDate: ctx.raceEventDate,
        dateRange: ctx.raceDateRange,
      })
      // Require an explicit event match when the portal package has a race. Previously
      // eventCheck=null (expected event missing) kept same-named products on other GPs.
      if (ctx.raceName.trim()) {
        if (eventCheck?.matches !== true) continue
      } else if (eventCheck?.matches === false) {
        continue
      }
      eventSafeRows.push(row)
    }

    if (eventSafeRows.length > 0) {
      if (ctx.config.fieldUnitPrice && ctx.tradePrice != null) {
        const priceMatch = eventSafeRows.find((row) =>
          numClose(Number(row[ctx.config.fieldUnitPrice!]), ctx.tradePrice),
        )
        if (priceMatch?.Id) return String(priceMatch.Id)
      }
      if (typeof eventSafeRows[0]?.Id === "string") return eventSafeRows[0].Id
    }
  }

  // Multi-day Package products — Salesforce often uses "Champions Club - 3 days" while the portal
  // uses "3 Day Champions Club". Prefer resolving via already-linked Single Ticket shells (those
  // usually match first), then fall back to event + soft name matching.
  if (ctx.duration === "3_day" || ctx.duration === "2_day") {
    const viaShells = await findExistingMultiDayViaShellPackageItems(ctx)
    if (viaShells) return viaShells
    const multiDay = await findExistingMultiDayProductOnEvent(ctx)
    if (multiDay) return multiDay
  }

  // No exact-name match. For day-specific products (Friday-only packages, Single Ticket day
  // shells) the Salesforce org usually already has the record under a different naming style
  // (e.g. "Paddock Club Club Suite SUNDAY ONLY"). Search the event for same-family products
  // that mention the same day and whose name is compatible, instead of creating a duplicate.
  return findExistingDayProductOnEvent(ctx)
}

/**
 * Match 3-day / 2-day Package products on the same Salesforce event when names differ in style.
 * e.g. portal "3 Day Champions Club" ↔ SF "Champions Club - 3 days" (PR-000819)
 *      portal "3 Day Paddock Club - Alpine Team" ↔ SF "Alpine Paddock Club - 3 days" (PR-000744)
 */
async function findExistingMultiDayProductOnEvent(ctx: {
  productName: string
  productFamily: string
  duration: string | null
  portalPackageId: string
  config: NonNullable<ReturnType<typeof getSalesforceConfig>>
  raceSeason: number | null
  raceName: string
  raceLocation?: string | null
  raceShortName?: string | null
  raceEventDate?: string | null
  raceDateRange?: string | null
  tradePrice: number | null
}): Promise<string | null> {
  const duration = ctx.duration?.trim()
  if (duration !== "3_day" && duration !== "2_day") return null
  const family = ctx.productFamily.trim()
  if (!family) return null
  const raceName = ctx.raceName.trim()
  if (!raceName) return null

  const lookup = await resolveEventLookup(ctx.config).catch(() => null)
  if (!lookup) return null
  const ensured = await ensureEventId(lookup.object, {
    season: ctx.raceSeason,
    raceName,
    location: ctx.raceLocation,
    shortName: ctx.raceShortName,
    eventDate: ctx.raceEventDate,
    dateRange: ctx.raceDateRange,
  }).catch(() => null)
  const eventId = ensured?.eventId ?? null
  if (!eventId) return null

  const select = ["Id", "Name", "CreatedDate", "Family"]
  if (ctx.config.fieldUnitPrice) select.push(ctx.config.fieldUnitPrice)

  // Prefer same Family, but fall back to all event products when Family is blank/mismatched
  // in Salesforce (legacy rows) so soft name matching can still find F1E Suite etc.
  let candidates = await salesforceQuery<Record<string, unknown>>(
    `SELECT ${select.join(", ")} FROM Product2 WHERE ${lookup.field} = '${escapeSoqlString(eventId)}' ` +
      `AND Family = '${escapeSoqlString(family)}' LIMIT 100`,
  )
  if (candidates.length === 0) {
    candidates = await salesforceQuery<Record<string, unknown>>(
      `SELECT ${select.join(", ")} FROM Product2 WHERE ${lookup.field} = '${escapeSoqlString(eventId)}' LIMIT 100`,
    )
  }
  if (candidates.length === 0) return null

  let compatible = candidates.filter((row) => {
    const name = typeof row.Name === "string" ? row.Name : ""
    if (!name) return false
    if (looksLikeSingleDayProductName(name)) return false
    if (!sfNameMatchesMultiDayDuration(name, duration)) return false
    const createdDate = typeof row.CreatedDate === "string" ? row.CreatedDate : null
    if (isPreSeasonSameNameLeftover(ctx.productName, name, createdDate, ctx.raceSeason)) return false
    return multiDayPackageNamesCompatible(ctx.productName, name)
  })

  if (compatible.length === 0) {
    // Club Suite vs F1 Experiences: related Paddock products exist but wrong variant.
    // Do NOT fall through to auto-create — that is how PR-000961 was duplicated after an
    // earlier ambiguous match left Club Suite claimed and the retry saw 0 candidates.
    const portalVariant = paddockClubVariant(ctx.productName)
    if (portalVariant) {
      const related = candidates
        .map((row) => ({
          Id: String(row.Id ?? ""),
          Name: typeof row.Name === "string" ? row.Name : "",
        }))
        .filter((row) => {
          if (!row.Id || !row.Name) return false
          if (looksLikeSingleDayProductName(row.Name)) return false
          if (!sfNameMatchesMultiDayDuration(row.Name, duration)) return false
          const v = paddockClubVariant(row.Name)
          return v != null && v !== portalVariant
        })
      if (related.length > 0) {
        const list = related.map((c) => `"${c.Name}" (${c.Id})`).join(", ")
        throw new Error(
          `No Salesforce ${paddockClubVariantLabel(portalVariant)} package matches "${ctx.productName}" on this event. ` +
            `Related Paddock Club products exist but are a different variant (Club Suite ≠ F1 Experiences / F1E): ${list}. ` +
            `Paste the correct Product2 Id to link, or create the product manually in Salesforce — a duplicate was NOT created.`,
        )
      }
    }
    return null
  }

  // Prefer legacy SF naming over a portal-exact auto-create duplicate on the same event.
  if (compatible.length > 1) {
    const legacy = compatible.filter(
      (row) => typeof row.Name === "string" && !namesLookLikeSamePortalPackage(ctx.productName, row.Name),
    )
    if (legacy.length > 0) compatible = legacy
  }

  if (ctx.config.fieldUnitPrice && ctx.tradePrice != null) {
    const priceMatches = compatible.filter((row) =>
      numClose(Number(row[ctx.config.fieldUnitPrice!]), ctx.tradePrice),
    )
    if (priceMatches.length === 1) {
      compatible = priceMatches
    } else if (priceMatches.length > 1) {
      compatible = priceMatches
    }
  }

  const unclaimed = await filterUnclaimedProduct2Candidates(
    compatible.map((row) => ({ Id: String(row.Id), Name: String(row.Name) })),
    ctx.portalPackageId,
  )
  return resolveUniqueProduct2Match(ctx.productName, unclaimed)
}

/**
 * When Single Ticket shells are already linked to legacy SF day products, walk Package Items
 * upward to find the parent Package Product2. This is the reverse of
 * findExistingShellViaParentPackageItems and catches cases where the 3-day SF name differs
 * enough that soft name matching alone would miss it (or create a duplicate).
 */
async function findExistingMultiDayViaShellPackageItems(ctx: {
  productName: string
  productFamily: string
  duration: string | null
  portalPackageId: string
  config: NonNullable<ReturnType<typeof getSalesforceConfig>>
  tradePrice: number | null
  raceSeason?: number | null
  raceName?: string
  raceLocation?: string | null
  raceShortName?: string | null
  raceEventDate?: string | null
  raceDateRange?: string | null
}): Promise<string | null> {
  const duration = ctx.duration?.trim()
  if (duration !== "3_day" && duration !== "2_day") return null

  const admin = createAdminClient()
  if (!admin) return null

  const { data: shells } = await admin
    .from("packages")
    .select("id, salesforce_product_id")
    .eq("shell_parent_package_id", ctx.portalPackageId)
  const shellSfIds = [
    ...new Set(
      (shells ?? [])
        .map((s) => String((s as { salesforce_product_id?: string | null }).salesforce_product_id ?? "").trim())
        .filter(Boolean),
    ),
  ]
  if (shellSfIds.length === 0) return null

  const itemConfig = resolvePackageItemConfig(ctx.config)
  if (!itemConfig) return null

  const parentVotes = new Map<string, number>()
  for (let i = 0; i < shellSfIds.length; i += 50) {
    const batch = shellSfIds.slice(i, i + 50)
    const inList = batch.map((id) => `'${escapeSoqlString(id)}'`).join(", ")
    const itemRows = await salesforceQuery<Record<string, unknown>>(
      `SELECT Id, ${itemConfig.parent}, ${itemConfig.child} FROM ${itemConfig.object} ` +
        `WHERE ${itemConfig.child} IN (${inList})`,
    )
    for (const row of itemRows) {
      const parentId = String(row[itemConfig.parent] ?? "").trim()
      if (!parentId) continue
      parentVotes.set(parentId, (parentVotes.get(parentId) ?? 0) + 1)
    }
  }
  if (parentVotes.size === 0) return null

  // Prefer the parent linked to the most of our shells (usually all three).
  const rankedParents = [...parentVotes.entries()].sort((a, b) => b[1] - a[1])
  const topCount = rankedParents[0][1]
  const topParentIds = rankedParents.filter(([, n]) => n === topCount).map(([id]) => id)

  const inList = topParentIds.map((id) => `'${escapeSoqlString(id)}'`).join(", ")
  const select = ["Id", "Name", "Family", "CreatedDate"]
  if (ctx.config.fieldUnitPrice) select.push(ctx.config.fieldUnitPrice)
  const products = await salesforceQuery<Record<string, unknown>>(
    `SELECT ${select.join(", ")} FROM Product2 WHERE Id IN (${inList}) AND IsActive = true`,
  )

  // Drop parents on the wrong Salesforce event (e.g. Mexico 2026 shells still hanging
  // off a Las Vegas House 44 package via Package Items → kept re-linking to PR-000915).
  const eventSafeProducts: Record<string, unknown>[] = []
  for (const row of products) {
    const id = typeof row.Id === "string" ? row.Id : ""
    if (!id) continue
    const name = typeof row.Name === "string" ? row.Name : ""
    const createdDate = typeof row.CreatedDate === "string" ? row.CreatedDate : null
    if (name && isPreSeasonSameNameLeftover(ctx.productName, name, createdDate, ctx.raceSeason ?? null)) {
      continue
    }
    if (ctx.raceName?.trim()) {
      const eventCheck = await productMatchesRaceEvent({
        product2Id: id,
        config: ctx.config,
        season: ctx.raceSeason ?? null,
        raceName: ctx.raceName,
        location: ctx.raceLocation,
        shortName: ctx.raceShortName,
        eventDate: ctx.raceEventDate,
        dateRange: ctx.raceDateRange,
      })
      if (eventCheck?.matches !== true) continue
    }
    eventSafeProducts.push(row)
  }
  if (eventSafeProducts.length === 0) return null

  let compatible = eventSafeProducts.filter((row) => {
    const name = typeof row.Name === "string" ? row.Name : ""
    if (!name) return false
    if (looksLikeSingleDayProductName(name)) return false
    const family = typeof row.Family === "string" ? row.Family.trim() : ""
    if (ctx.productFamily.trim() && family && family !== ctx.productFamily.trim()) return false
    if (!sfNameMatchesMultiDayDuration(name, duration)) return false
    return multiDayPackageNamesCompatible(ctx.productName, name)
  })

  // If name soft-match still fails but every shell points at one unique parent on THIS
  // event, trust that Package Item graph.
  // Never trust across Club Suite ↔ F1 Experiences / F1E.
  if (compatible.length === 0 && eventSafeProducts.length === 1 && topCount >= 2) {
    const only = eventSafeProducts[0]
    if (
      only?.Id &&
      typeof only.Name === "string" &&
      !looksLikeSingleDayProductName(only.Name) &&
      paddockClubVariantsCompatible(ctx.productName, only.Name)
    ) {
      compatible = [only]
    }
  }

  if (compatible.length === 0) return null

  // When a prior auto-create duplicate also linked the same shells, prefer the legacy SF
  // naming style over a portal-exact duplicate name (e.g. F1E Suite vs "3 Day F1 Experiences…").
  if (compatible.length > 1) {
    const legacy = compatible.filter(
      (row) => typeof row.Name === "string" && !namesLookLikeSamePortalPackage(ctx.productName, row.Name),
    )
    if (legacy.length > 0) compatible = legacy
  }

  if (ctx.config.fieldUnitPrice && ctx.tradePrice != null && compatible.length > 1) {
    const priceMatches = compatible.filter((row) =>
      numClose(Number(row[ctx.config.fieldUnitPrice!]), ctx.tradePrice),
    )
    if (priceMatches.length === 1) compatible = priceMatches
    else if (priceMatches.length > 1) compatible = priceMatches
  }

  const unclaimed = await filterUnclaimedProduct2Candidates(
    compatible.map((row) => ({ Id: String(row.Id), Name: String(row.Name) })),
    ctx.portalPackageId,
  )
  return resolveUniqueProduct2Match(ctx.productName, unclaimed)
}

async function pickDayProductMatch(
  dayFiltered: SingleTicketCandidate[],
  ctx: {
    productName: string
    parentPackageName?: string | null
    dayKeyword: string
    portalPackageId: string
    isSingleTicket: boolean
  },
): Promise<string | null> {
  if (dayFiltered.length === 0) return null

  if (ctx.isSingleTicket) {
    const ranked = rankSingleTicketCandidates(dayFiltered, {
      productName: ctx.productName,
      parentPackageName: ctx.parentPackageName,
      dayKeyword: ctx.dayKeyword,
    })
    if (ranked.length === 0) return null
    const unclaimed = await filterUnclaimedProduct2Candidates(ranked, ctx.portalPackageId)
    return resolveUniqueProduct2Match(ctx.productName, unclaimed)
  }

  const compatible = dayFiltered.filter((c) => softBidirectionalNameCompatible(ctx.productName, c.Name))
  if (compatible.length === 0) return null
  const unclaimed = await filterUnclaimedProduct2Candidates(compatible, ctx.portalPackageId)
  return resolveUniqueProduct2Match(ctx.productName, unclaimed)
}

/**
 * Day-aware fallback matching:
 *   1 compatible candidate  -> reuse it (this is the "automatically find it" case)
 *   2+ compatible candidates -> fail the sync with the list, so the admin picks one via the
 *                              Relink box. Creating a duplicate is never the right outcome.
 *   0 candidates            -> return null; callers must not auto-create shell single tickets.
 */
async function findExistingDayProductOnEvent(ctx: {
  productName: string
  productFamily: string
  duration: string | null
  portalPackageId: string
  config: NonNullable<ReturnType<typeof getSalesforceConfig>>
  raceSeason: number | null
  raceName: string
  raceLocation?: string | null
  raceShortName?: string | null
  raceEventDate?: string | null
  raceDateRange?: string | null
  parentPackageName?: string | null
  shellParentPackageId?: string | null
}): Promise<string | null> {
  const dayKeyword = ctx.duration ? DAY_DURATION_KEYWORD[ctx.duration] : undefined
  if (!dayKeyword) return null
  const family = ctx.productFamily.trim()
  if (!family) return null
  const raceName = ctx.raceName.trim()
  if (!raceName) return null

  const isSingleTicket =
    family === SHELL_SINGLE_TICKET_FAMILY || family.toLowerCase() === "single ticket"

  if (isSingleTicket && ctx.shellParentPackageId?.trim()) {
    const viaParentItems = await findExistingShellViaParentPackageItems({
      shellParentPackageId: ctx.shellParentPackageId.trim(),
      dayKeyword,
      portalPackageId: ctx.portalPackageId,
      productName: ctx.productName,
      parentPackageName: ctx.parentPackageName,
      config: ctx.config,
    })
    if (viaParentItems) return viaParentItems
  }

  const lookup = await resolveEventLookup(ctx.config).catch(() => null)
  const ensured = lookup
    ? await ensureEventId(lookup.object, {
        season: ctx.raceSeason,
        raceName,
        location: ctx.raceLocation,
        shortName: ctx.raceShortName,
        eventDate: ctx.raceEventDate,
        dateRange: ctx.raceDateRange,
      }).catch(() => null)
    : null
  const eventId = ensured?.eventId ?? null

  const matchCtx = {
    productName: ctx.productName,
    parentPackageName: ctx.parentPackageName,
    dayKeyword,
    portalPackageId: ctx.portalPackageId,
    isSingleTicket,
  }

  // Prefer products already linked to this event.
  if (lookup && eventId) {
    const eventRows = await salesforceQuery<SingleTicketCandidate>(
      `SELECT Id, Name, CreatedDate FROM Product2 WHERE ${lookup.field} = '${escapeSoqlString(eventId)}' ` +
        `AND Family = '${escapeSoqlString(family)}' LIMIT ${isSingleTicket ? 100 : 50}`,
    )
    const dayFiltered = eventRows.filter((c) =>
      c.Name.toLowerCase().includes(dayKeyword.toLowerCase()),
    )
    const eventMatch = await pickDayProductMatch(dayFiltered, matchCtx)
    if (eventMatch) return eventMatch
    // Event exists (or was just created) and has no matching day product — create a new one.
    // Do NOT fall back to other events' House 44 / Paddock Club day lines.
    if (isSingleTicket) return null
  }

  // Legacy Single Ticket products often have no Event lookup set. Only use this when we
  // could not resolve/create an event for the race.
  if (isSingleTicket && !eventId) {
    const eventField = lookup?.field
    const select = eventField
      ? `Id, Name, CreatedDate, ${eventField}`
      : "Id, Name, CreatedDate"
    const fallbackRows = await salesforceQuery<Record<string, unknown>>(
      `SELECT ${select} FROM Product2 WHERE Family = '${escapeSoqlString(family)}' ` +
        `AND Name LIKE '%${escapeSoqlString(dayKeyword)}%' ORDER BY CreatedDate ASC LIMIT 100`,
    )
    const allowed: SingleTicketCandidate[] = []
    for (const row of fallbackRows) {
      const id = typeof row.Id === "string" ? row.Id : ""
      const name = typeof row.Name === "string" ? row.Name : ""
      if (!id || !name) continue
      if (eventField) {
        const actual = row[eventField] == null ? "" : String(row[eventField]).trim()
        // Only blank-event legacy rows — never another event's products.
        if (actual) continue
      }
      allowed.push({
        Id: id,
        Name: name,
        CreatedDate: typeof row.CreatedDate === "string" ? row.CreatedDate : undefined,
      })
    }
    return pickDayProductMatch(allowed, matchCtx)
  }

  return null
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
  skipInventoryPush?: boolean
}): Promise<string> {
  const { productName, productFamily, config, tradePrice, stockTotal, sellable } = ctx
  const label = productName.trim() || "package"

  // Single Ticket day-children carry no value (a $0 Product2 that only exists so the SF
  // Package Item link can attribute each race day to the parent). Every other family still
  // requires a positive trade price so the Standard Price Book entry is meaningful.
  const familyNormalized = productFamily.trim().toLowerCase()
  const isZeroValueSingleTicket =
    productFamily === SHELL_SINGLE_TICKET_FAMILY || familyNormalized === "single ticket"
  const effectiveTradePrice =
    isZeroValueSingleTicket && (tradePrice == null || !Number.isFinite(tradePrice) || tradePrice < 0)
      ? 0
      : tradePrice
  const priceIsValid =
    effectiveTradePrice != null &&
    Number.isFinite(effectiveTradePrice) &&
    (isZeroValueSingleTicket ? effectiveTradePrice >= 0 : effectiveTradePrice > 0)

  if (!priceIsValid) {
    throw new Error(
      `Cannot auto-create "${label}" in Salesforce without a trade price. ` +
        `Set the package trade price, or create the product manually in Salesforce and paste its 18-character Id under Salesforce Product Id.`,
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
    [config.fieldUnitPrice]: effectiveTradePrice,
  }
  if (productFamily) body.Family = productFamily
  // Single Ticket shells must get Stock/Available on INSERT — Salesforce ProductTrigger
  // PackageInventoryManager NPEs when Available is PATCHed while Package Item junctions exist.
  // Insert happens before junctions are created, so inventory fields write cleanly here.
  const writeInventoryOnCreate = !ctx.skipInventoryPush || isZeroValueSingleTicket
  if (writeInventoryOnCreate) {
    if (config.fieldStockQty) body[config.fieldStockQty] = stockTotal
    if (config.fieldAvailableQty) body[config.fieldAvailableQty] = sellable
  }

  try {
    const created = await salesforceRequest<{ id: string }>("POST", "/sobjects/Product2", { body })
    const product2Id = created.id

    // Belt-and-suspenders: ensure Standard Price Book entry exists even if the SF flow is disabled later.
    try {
      await ensureStandardPricebookEntry(product2Id, effectiveTradePrice!)
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
  skipInventoryVerification?: boolean
}): Promise<void> {
  const selectFields = ["Id", "Name", "LastModifiedDate"]
  if (ctx.config.fieldUnitPrice) selectFields.push(ctx.config.fieldUnitPrice)
  if (ctx.config.fieldStockQty) selectFields.push(ctx.config.fieldStockQty)
  if (ctx.config.fieldAvailableQty) selectFields.push(ctx.config.fieldAvailableQty)
  if (ctx.config.fieldQuantitySold) selectFields.push(ctx.config.fieldQuantitySold)

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

  if (!ctx.skipInventoryVerification) {
    const sfStock =
      ctx.config.fieldStockQty != null ? Number(sf[ctx.config.fieldStockQty]) : Number.NaN
    const sfAvailable =
      ctx.config.fieldAvailableQty != null ? Number(sf[ctx.config.fieldAvailableQty]) : Number.NaN
    const sfSold =
      ctx.config.fieldQuantitySold != null ? Number(sf[ctx.config.fieldQuantitySold]) : Number.NaN

    if (
      ctx.config.fieldStockQty &&
      ctx.fieldsUpdated.includes(ctx.config.fieldStockQty) &&
      !numClose(sfStock, ctx.expected.stockTotal)
    ) {
      problems.push(
        `Stock Quantity in SF is ${sfStock} but portal purchased stock is ${ctx.expected.stockTotal}.`,
      )
    }

    if (
      ctx.config.fieldAvailableQty &&
      ctx.fieldsUpdated.includes(ctx.config.fieldAvailableQty) &&
      !numClose(sfAvailable, ctx.expected.sellable)
    ) {
      // Many orgs use Available = Stock − Quantity Sold (formula). If Stock stuck and Sold
      // explains Available, don't fail the sync — the Available write is not authoritative.
      const explainedBySoldFormula =
        Number.isFinite(sfStock) &&
        Number.isFinite(sfSold) &&
        Number.isFinite(sfAvailable) &&
        numClose(sfStock, ctx.expected.stockTotal) &&
        numClose(sfAvailable, Math.max(0, sfStock - sfSold))
      if (!explainedBySoldFormula) {
        problems.push(
          `Available Quantity in SF is ${sfAvailable} but sync expected ${ctx.expected.sellable} (Stock ${ctx.expected.stockTotal} − closed-won).`,
        )
      } else {
        ctx.fieldsSkipped.push(
          `Available Quantity in SF is ${sfAvailable} (Stock ${sfStock} − Sold ${sfSold}); treated as formula — not flagged as a sync failure.`,
        )
      }
    }
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
