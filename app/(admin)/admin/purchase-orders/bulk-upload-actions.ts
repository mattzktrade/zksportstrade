"use server"

import type { SupabaseClient } from "@supabase/supabase-js"
import { revalidatePath } from "next/cache"
import { requireAdminAction } from "@/app/(admin)/actions"
import { generatePurchaseOrderNumber, setPurchaseOrderSupplierReference } from "@/lib/admin/purchase-orders"
import { generatePackageIdFromRaceAndName } from "@/lib/catalog/generate-package-id"
import { deriveInventoryGroupId } from "@/lib/catalog/inventory-group"
import { inferPackageDurationFromName, isValidPackageDuration } from "@/lib/catalog/package-duration"
import { isPaddockClubPackageName } from "@/lib/catalog/paddock-club"
import { enqueuePackageInventoryChannelSync } from "@/lib/integrations/enqueue"
import { recordPurchaseLedgerForLatestLayer } from "@/lib/inventory/ledger"
import { healLinkedGroupInBackground } from "@/lib/inventory/linked-group-inventory"
import {
  normalizeMatchText,
  parsePurchaseBulkCsv,
  parsePurchaseBulkRecords,
  type ParsedPurchaseBulkRow,
  type PurchaseBulkCatalog,
  type PurchaseBulkCatalogPackage,
  type PurchaseBulkCatalogRace,
} from "@/lib/inventory/purchase-bulk-upload"
import { ensureSupplierByName, linkPurchaseOrderSupplier } from "@/lib/inventory/suppliers"
import { createAdminClient } from "@/lib/supabase/admin"

const SPREADSHEET_MAX_BYTES = 20 * 1024 * 1024
const PO_DOCUMENT_BUCKET = "purchase-order-documents"
const PO_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024
const PO_DOCUMENT_ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
])

type PreviewResult =
  | {
      ok: true
      totalRows: number
      validRows: number
      errorRows: number
      sample: ParsedPurchaseBulkRow[]
    }
  | { ok: false; message: string }

type ApplyResult =
  | {
      ok: true
      message: string
      created: number
      packagesCreated: number
      contractsAttached: number
      skipped: number
      failed: number
    }
  | { ok: false; message: string }

function layerKey(packageId: string, purchaseOrderId: string, quantity: number, unitCost: number): string {
  return `${packageId}|${purchaseOrderId}|${quantity}|${unitCost.toFixed(2)}`
}

function createKey(raceId: string, name: string): string {
  return `${raceId}::${normalizeMatchText(name)}`
}

async function parseUploadedSpreadsheet(
  file: File,
  catalog: PurchaseBulkCatalog,
) {
  const name = file.name.toLowerCase()
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm") || name.endsWith(".xls")) {
    if (name.endsWith(".xls")) {
      throw new Error("Please save the workbook as .xlsx (Excel workbook), not the older .xls format.")
    }
    const { recordsFromXlsx } = await import("@/lib/inventory/purchase-bulk-xlsx")
    const records = await recordsFromXlsx(Buffer.from(await file.arrayBuffer()))
    return parsePurchaseBulkRecords(records, catalog)
  }
  return parsePurchaseBulkCsv(await file.text(), catalog)
}

async function fileFromForm(formData: FormData): Promise<File> {
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a CSV or Excel (.xlsx) file.")
  }
  if (file.size > SPREADSHEET_MAX_BYTES) {
    throw new Error("Please keep the spreadsheet to 20MB or smaller.")
  }
  return file
}

async function loadCatalog(supabase: SupabaseClient): Promise<PurchaseBulkCatalog | { ok: false; message: string }> {
  const [packagesRes, racesRes, posRes] = await Promise.all([
    supabase
      .from("packages")
      .select(
        "id, name, duration, inventory_group_id, shell_parent_package_id, currency, race_id, location, country, country_code, event_date",
      ),
    supabase
      .from("races")
      .select("id, name, short_name, location, country, country_code, event_date, date_range, image, season, category"),
    supabase.from("purchase_orders").select("po_number, supplier, supplier_reference"),
  ])
  if (packagesRes.error) return { ok: false, message: packagesRes.error.message }
  if (racesRes.error) return { ok: false, message: racesRes.error.message }
  let poRows: Array<{ po_number?: string | null; supplier_reference?: string | null }> = posRes.data ?? []
  if (posRes.error) {
    const fallback = await supabase.from("purchase_orders").select("po_number, supplier")
    if (fallback.error) return { ok: false, message: posRes.error.message }
    poRows = fallback.data ?? []
  }

  const races: PurchaseBulkCatalogRace[] = (racesRes.data ?? []).map((race) => ({
    id: String(race.id),
    name: String(race.name ?? ""),
    shortName: String(race.short_name ?? ""),
    location: String(race.location ?? ""),
    country: String(race.country ?? ""),
    countryCode: String(race.country_code ?? ""),
    eventDate: race.event_date ? String(race.event_date) : null,
    dateRange: race.date_range ? String(race.date_range) : null,
    image: race.image ? String(race.image) : null,
    season: typeof race.season === "number" ? race.season : Number(race.season) || null,
    category: race.category ? String(race.category) : null,
  }))
  const raceById = new Map(races.map((race) => [race.id, race]))

  const packages: PurchaseBulkCatalogPackage[] = (packagesRes.data ?? []).map((pkg) => {
    const race = raceById.get(String(pkg.race_id ?? ""))
    return {
      id: String(pkg.id),
      name: String(pkg.name ?? ""),
      duration: pkg.duration ? String(pkg.duration) : null,
      inventoryGroupId: pkg.inventory_group_id ? String(pkg.inventory_group_id) : null,
      shellParentPackageId: pkg.shell_parent_package_id ? String(pkg.shell_parent_package_id) : null,
      currency: pkg.currency ? String(pkg.currency) : null,
      raceId: pkg.race_id ? String(pkg.race_id) : null,
      raceName: race?.name ?? "",
      raceShortName: race?.shortName ?? "",
      location: race?.location || String(pkg.location ?? ""),
      country: race?.country || String(pkg.country ?? ""),
      countryCode: race?.countryCode || String(pkg.country_code ?? ""),
      season: race?.season ?? null,
      eventDate: race?.eventDate ?? (pkg.event_date ? String(pkg.event_date) : null),
    }
  })

  return {
    packages,
    races,
    existingPoNumbers: poRows.map((row) => String(row.po_number ?? "")).filter(Boolean),
    existingSupplierReferences: poRows
      .map((row) => String(row.supplier_reference ?? ""))
      .filter(Boolean),
  }
}

async function resolvePurchaseOrderId(
  supabase: SupabaseClient,
  cache: Map<string, string>,
  groupKey: string,
  supplierName: string,
  supplierReference: string,
  note: string | null,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const key = `${supplierName.trim().toLowerCase()}::${groupKey.trim().toLowerCase()}`
  const cached = cache.get(key)
  if (cached) return { ok: true, id: cached }

  const ref = supplierReference.trim()
  if (ref) {
    const { data: byRef, error: refErr } = await supabase
      .from("purchase_orders")
      .select("id, supplier, supplier_reference")
      .ilike("supplier_reference", ref)
      .limit(20)
    if (refErr && !refErr.message.toLowerCase().includes("supplier_reference")) {
      return { ok: false, message: refErr.message }
    }
    const refMatch =
      (byRef ?? []).find((row) => String(row.supplier ?? "").toLowerCase() === supplierName.trim().toLowerCase()) ??
      (byRef ?? [])[0]
    if (refMatch?.id) {
      const id = String(refMatch.id)
      const linked = await linkPurchaseOrderSupplier(supabase, id, supplierName)
      if (!linked.ok) return linked
      cache.set(key, id)
      return { ok: true, id }
    }

    const { data: byPo, error: poErr } = await supabase
      .from("purchase_orders")
      .select("id, supplier, supplier_reference")
      .ilike("po_number", ref)
      .limit(20)
    if (poErr) return { ok: false, message: poErr.message }
    const poMatch =
      (byPo ?? []).find((row) => String(row.supplier ?? "").toLowerCase() === supplierName.trim().toLowerCase()) ??
      (byPo ?? [])[0]
    if (poMatch?.id) {
      const id = String(poMatch.id)
      const linked = await linkPurchaseOrderSupplier(supabase, id, supplierName)
      if (!linked.ok) return linked
      if (!String((poMatch as { supplier_reference?: string | null }).supplier_reference ?? "").trim()) {
        await setPurchaseOrderSupplierReference(supabase, id, ref)
      }
      cache.set(key, id)
      return { ok: true, id }
    }
  }

  const poNumber = generatePurchaseOrderNumber()
  const { data, error } = await supabase.rpc("admin_create_purchase_order", {
    p_po_number: poNumber,
    p_supplier: supplierName,
    p_issued_at: null,
    p_note: note,
  })
  if (error) {
    return { ok: false, message: error.message }
  }

  const id = String(data)
  const linked = await linkPurchaseOrderSupplier(supabase, id, supplierName)
  if (!linked.ok) return linked
  if (ref) {
    const referenced = await setPurchaseOrderSupplierReference(supabase, id, ref)
    if (!referenced.ok) return referenced
  }
  cache.set(key, id)
  return { ok: true, id }
}

async function createImportedPackage(
  supabase: SupabaseClient,
  catalog: PurchaseBulkCatalog,
  row: ParsedPurchaseBulkRow,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const race = catalog.races?.find((item) => item.id === row.raceId)
  if (!race) return { ok: false, message: "Event not found for the new product." }
  const name = (row.createPackageName ?? row.packageLabel).trim()
  if (!name) return { ok: false, message: "Package name is missing." }

  let id = generatePackageIdFromRaceAndName(race.id, name)
  if (!/^[a-z0-9][a-z0-9-]{1,126}$/.test(id)) {
    return { ok: false, message: `Could not create a product id from "${name}".` }
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? id : `${id.slice(0, 118)}-${attempt}`
    const { data: dup } = await supabase.from("packages").select("id").eq("id", candidate).maybeSingle()
    if (!dup) {
      id = candidate
      break
    }
    if (attempt === 49) return { ok: false, message: `A product named "${name}" already exists on this event.` }
  }

  const inferred = inferPackageDurationFromName(name)
  const isFormula1 = (race.category ?? "formula_1") === "formula_1"
  const duration = inferred || (isFormula1 ? "3_day" : "")
  if (duration && !isValidPackageDuration(duration)) {
    return { ok: false, message: "Could not infer a valid duration for the new product." }
  }
  const inventoryGroupId = duration ? deriveInventoryGroupId(id, duration, race.id) : null
  const eventDate = race.eventDate || new Date().toISOString().slice(0, 10)
  const quantity = row.quantity ?? 0

  const { error: insErr } = await supabase.from("packages").insert({
    id,
    race_id: race.id,
    name,
    circuit: race.shortName || race.location || race.name,
    location: race.location || race.name,
    country: race.country || "",
    country_code: (race.countryCode || "").toUpperCase().slice(0, 8),
    event_date: eventDate,
    date_range: race.dateRange || eventDate,
    description: `Created from inventory purchase import (${row.packageLabel})`,
    image: race.image || "/placeholder.svg",
    gallery_images: [],
    currency: "USD",
    total_capacity: Math.max(quantity, 0),
    is_enquiry: false,
    is_hidden: true,
    tier: "paddock",
    duration: duration || null,
    inventory_group_id: inventoryGroupId,
    requires_booking_approval: isPaddockClubPackageName(name),
    includes: [],
    featured: false,
    sort_order: 0,
    trade_price: null,
    brochure_url: null,
    sell_on_trade_portal: false,
    sell_on_wix: false,
    sell_on_partners: false,
    integration_sync_status: "pending",
  })
  if (insErr) return { ok: false, message: insErr.message }

  const { error: invErr } = await supabase.from("package_inventory").insert({
    package_id: id,
    qty_available: 0,
    qty_held: 0,
  })
  if (invErr) {
    await supabase.from("packages").delete().eq("id", id)
    return { ok: false, message: invErr.message }
  }

  catalog.packages.push({
    id,
    name,
    duration: duration || null,
    inventoryGroupId,
    shellParentPackageId: null,
    currency: "USD",
    raceId: race.id,
    raceName: race.name,
    raceShortName: race.shortName,
    location: race.location,
    country: race.country,
    countryCode: race.countryCode,
    season: race.season,
    eventDate: race.eventDate,
  })
  return { ok: true, id }
}

function rewriteDownloadUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.includes("drive.google.com")) {
      const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/)
      const id = fileMatch?.[1] || parsed.searchParams.get("id")
      if (id) return `https://drive.google.com/uc?export=download&id=${id}`
    }
    if (parsed.hostname.includes("dropbox.com")) {
      parsed.searchParams.set("dl", "1")
      return parsed.toString()
    }
    return parsed.toString()
  } catch {
    return url
  }
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true
  if (host === "127.0.0.1" || host === "::1" || host.startsWith("127.")) return true
  if (/^(10\.|192\.168\.|169\.254\.)/.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true
  return false
}

function filenameFromDisposition(header: string | null, url: string, contentType: string): string {
  const match = header?.match(/filename\*?=(?:UTF-8''|"([^"]+)"|([^;]+))/i)
  const raw = match?.[1] || match?.[2]
  if (raw) {
    try {
      return decodeURIComponent(raw.replace(/['"]/g, "")).split(/[/\\]/).pop() || "contract"
    } catch {
      return raw.replace(/['"]/g, "")
    }
  }
  try {
    const pathName = new URL(url).pathname.split("/").filter(Boolean).pop()
    if (pathName && /\.[a-z0-9]{2,8}$/i.test(pathName)) return pathName
  } catch {
    /* ignore */
  }
  if (contentType.includes("pdf")) return "contract.pdf"
  if (contentType.includes("wordprocessingml")) return "contract.docx"
  if (contentType.includes("msword")) return "contract.doc"
  if (contentType.includes("jpeg")) return "contract.jpg"
  if (contentType.includes("png")) return "contract.png"
  return "contract.pdf"
}

function cleanFileName(name: string): string {
  return name.trim().replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, "-").slice(0, 120) || "contract"
}

async function attachContractFromUrl(input: {
  supabase: SupabaseClient
  profileId: string
  purchaseOrderId: string
  url: string
  seen: Set<string>
}): Promise<"attached" | "skipped" | "failed"> {
  const key = `${input.purchaseOrderId}::${input.url}`
  if (input.seen.has(key)) return "skipped"
  let parsed: URL
  try {
    parsed = new URL(input.url)
  } catch {
    return "failed"
  }
  if (parsed.protocol !== "https:" || isBlockedHost(parsed.hostname)) return "failed"

  const admin = createAdminClient()
  if (!admin) return "failed"

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  let response: Response
  try {
    response = await fetch(rewriteDownloadUrl(parsed.toString()), {
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "application/pdf,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*" },
    })
  } catch {
    return "failed"
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) return "failed"
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase()
  if (contentType.includes("text/html")) return "failed"
  const type = PO_DOCUMENT_ALLOWED_TYPES.has(contentType) ? contentType : contentType === "application/octet-stream" ? "application/pdf" : null
  if (!type) return "failed"
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length || bytes.length > PO_DOCUMENT_MAX_BYTES) return "failed"

  const fileName = cleanFileName(
    filenameFromDisposition(response.headers.get("content-disposition"), parsed.toString(), type),
  )
  const filePath = `${input.purchaseOrderId}/${Date.now()}-${crypto.randomUUID()}-${fileName}`
  const { error: uploadErr } = await admin.storage.from(PO_DOCUMENT_BUCKET).upload(filePath, bytes, {
    contentType: type,
    upsert: false,
  })
  if (uploadErr) return "failed"
  const { error: insertErr } = await input.supabase.from("purchase_order_documents").insert({
    purchase_order_id: input.purchaseOrderId,
    file_bucket: PO_DOCUMENT_BUCKET,
    file_path: filePath,
    file_name: fileName,
    file_content_type: type,
    file_size: bytes.length,
    uploaded_by: input.profileId,
  })
  if (insertErr) {
    await admin.storage.from(PO_DOCUMENT_BUCKET).remove([filePath])
    return "failed"
  }
  input.seen.add(key)
  return "attached"
}

export async function previewPurchaseBulkUpload(formData: FormData): Promise<PreviewResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const catalog = await loadCatalog(gate.supabase)
  if ("ok" in catalog) return catalog
  try {
    const parsed = await parseUploadedSpreadsheet(await fileFromForm(formData), catalog)
    return {
      ok: true,
      totalRows: parsed.totalRows,
      validRows: parsed.validRows,
      errorRows: parsed.errorRows,
      sample: parsed.rows.slice(0, 80),
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not read that file." }
  }
}

export async function applyPurchaseBulkUpload(formData: FormData): Promise<ApplyResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate

  const catalog = await loadCatalog(gate.supabase)
  if ("ok" in catalog) return catalog

  let parsed
  try {
    parsed = await parseUploadedSpreadsheet(await fileFromForm(formData), catalog)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not read that file." }
  }
  if (parsed.validRows === 0) {
    return { ok: false, message: "There are no valid rows to import." }
  }

  const valid = parsed.rows.filter((row) => row.errors.length === 0)
  const packageIds = [...new Set(valid.map((row) => row.stockPackageId).filter((id): id is string => Boolean(id)))]
  const existingKeys = new Set<string>()
  if (packageIds.length) {
    const { data: layers, error: layerErr } = await gate.supabase
      .from("package_cost_layers")
      .select("package_id, purchase_order_id, quantity, unit_cost")
      .in("package_id", packageIds)
    if (layerErr) return { ok: false, message: layerErr.message }
    for (const layer of layers ?? []) {
      if (!layer.purchase_order_id) continue
      existingKeys.add(
        layerKey(
          String(layer.package_id),
          String(layer.purchase_order_id),
          Number(layer.quantity),
          Number(layer.unit_cost),
        ),
      )
    }
  }

  const poCache = new Map<string, string>()
  const supplierCache = new Map<string, string>()
  const createdPackageIds = new Map<string, string>()
  const attachedContracts = new Set<string>()
  const touchedPackages = new Set<string>()
  const touchedGroups = new Set<string>()
  let created = 0
  let packagesCreated = 0
  let contractsAttached = 0
  let skipped = parsed.errorRows
  let failed = 0

  for (const row of valid) {
    if (row.quantity == null || row.unitCost == null || !row.poNumber || !row.supplierName) {
      failed += 1
      continue
    }
    try {
      let packageId = row.stockPackageId
      if (row.willCreatePackage && row.raceId && row.createPackageName) {
        const key = createKey(row.raceId, row.createPackageName)
        const existingId = createdPackageIds.get(key)
        if (existingId) {
          packageId = existingId
        } else {
          const made = await createImportedPackage(gate.supabase, catalog, row)
          if (!made.ok) throw new Error(made.message)
          packageId = made.id
          createdPackageIds.set(key, packageId)
          packagesCreated += 1
        }
      }
      if (!packageId) throw new Error("Package could not be resolved.")

      const supplierKey = row.supplierName.toLowerCase()
      let supplierId = supplierCache.get(supplierKey)
      if (!supplierId) {
        const ensured = await ensureSupplierByName(gate.supabase, row.supplierName)
        if (!ensured.ok) throw new Error(ensured.message)
        supplierId = ensured.id
        supplierCache.set(supplierKey, supplierId)
      }

      const po = await resolvePurchaseOrderId(
        gate.supabase,
        poCache,
        row.poNumber,
        row.supplierName,
        row.supplierReference,
        row.note,
      )
      if (!po.ok) throw new Error(po.message)

      if (row.contractUrl) {
        const attached = await attachContractFromUrl({
          supabase: gate.supabase,
          profileId: gate.profile.id,
          purchaseOrderId: po.id,
          url: row.contractUrl,
          seen: attachedContracts,
        })
        if (attached === "attached") contractsAttached += 1
      }

      const dedupe = layerKey(packageId, po.id, row.quantity, row.unitCost)
      if (existingKeys.has(dedupe)) {
        skipped += 1
        continue
      }

      const { error } = await gate.supabase.rpc("admin_add_cost_layer", {
        p_package_id: packageId,
        p_quantity: row.quantity,
        p_unit_cost: row.unitCost,
        p_currency: row.currency,
        p_note: row.note,
        p_received_at: null,
        p_source: "bulk_upload",
        p_purchase_order_id: po.id,
        p_fulfilment_block_id: null,
      })
      if (error) throw new Error(error.message)

      existingKeys.add(dedupe)
      touchedPackages.add(packageId)
      const pkg = catalog.packages.find((item) => item.id === packageId)
      if (pkg?.inventoryGroupId) touchedGroups.add(pkg.inventoryGroupId)

      try {
        await recordPurchaseLedgerForLatestLayer(gate.supabase, packageId, row.quantity, {
          purchaseOrderId: po.id,
          supplierId,
          reason: "Bulk stock purchase upload",
        })
      } catch (error) {
        console.warn(
          "[purchase-bulk-upload] ledger append skipped:",
          error instanceof Error ? error.message : error,
        )
      }
      created += 1
    } catch {
      failed += 1
    }
  }

  for (const packageId of touchedPackages) {
    const { error: bfErr } = await gate.supabase.rpc("admin_backfill_package_order_costs", {
      p_package_id: packageId,
    })
    if (bfErr) {
      console.warn("[purchase-bulk-upload] cost backfill skipped:", bfErr.message)
    }
  }

  for (const groupId of touchedGroups) {
    await healLinkedGroupInBackground(groupId).catch((error) => {
      console.warn(
        "[purchase-bulk-upload] linked-group heal skipped:",
        error instanceof Error ? error.message : error,
      )
    })
  }

  for (const packageId of touchedPackages) {
    const pkg = catalog.packages.find((item) => item.id === packageId)
    if (pkg?.inventoryGroupId) continue
    await enqueuePackageInventoryChannelSync(gate.supabase, packageId).catch((error) => {
      console.warn(
        "[purchase-bulk-upload] inventory sync skipped:",
        error instanceof Error ? error.message : error,
      )
    })
  }

  revalidatePath("/admin/purchase-orders")
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/suppliers")
  revalidatePath("/packages")
  revalidatePath("/")

  const bits: string[] = []
  if (created) bits.push(`${created} stock purchase${created === 1 ? "" : "s"} added`)
  if (packagesCreated) bits.push(`${packagesCreated} new product${packagesCreated === 1 ? "" : "s"} created`)
  if (contractsAttached) {
    bits.push(`${contractsAttached} contract${contractsAttached === 1 ? "" : "s"} attached`)
  }
  let message = bits.length ? `${bits.join(", ")}.` : "No new stock purchases were added."
  if (skipped) message += ` ${skipped} row${skipped === 1 ? "" : "s"} skipped.`
  if (failed) message += ` ${failed} row${failed === 1 ? "" : "s"} failed.`

  return { ok: true, message, created, packagesCreated, contractsAttached, skipped, failed }
}
