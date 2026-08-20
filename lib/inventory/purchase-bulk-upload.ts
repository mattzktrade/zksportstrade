import { parse } from "csv-parse/sync"

export const PURCHASE_BULK_MAX_ROWS = 2000

export const PURCHASE_BULK_TEMPLATE_HEADERS = [
  "Event",
  "Package",
  "QTY",
  "Total",
  "Cost Per Unit",
  "Parking",
  "Supplier",
  "Order / Contract",
  "Invoice Number",
  "Paid",
  "Sold",
  "Legend Day",
  "Tour Times",
  "Contact",
  "Contact Email",
] as const

export const PURCHASE_BULK_TEMPLATE_CSV = `${PURCHASE_BULK_TEMPLATE_HEADERS.join(",")}
Australia,Paddock Club 3-Days,12,64888,5299,NA,F1 Experiences,DJT 26-20,INV351345,,,,,
Miami,Turn 18 Grandstand | 3 Day,18,22617.6,1256.15,TBC,GPT,AGREED,,,,,,
Canada - Montreal,Paddock Club 3-Days | TGR HA,4,45432.8,11358.2,TBC,F1 Experiences,DJT 26-45.1,INV347975,,,,,
`

export type PurchaseBulkCatalogPackage = {
  id: string
  name: string
  duration: string | null
  inventoryGroupId: string | null
  shellParentPackageId: string | null
  currency: string | null
  raceId: string | null
  raceName: string
  raceShortName: string
  location: string
  country: string
  countryCode: string
  season: number | null
  eventDate: string | null
}

export type PurchaseBulkCatalogRace = {
  id: string
  name: string
  shortName: string
  location: string
  country: string
  countryCode: string
  season: number | null
  eventDate: string | null
  dateRange: string | null
  image: string | null
  category: string | null
}

export type PurchaseBulkCatalog = {
  packages: PurchaseBulkCatalogPackage[]
  races?: PurchaseBulkCatalogRace[]
  existingPoNumbers: string[]
  existingSupplierReferences?: string[]
}

export type PurchaseBulkCell = {
  value: string
  url: string | null
}

export type ParsedPurchaseBulkRow = {
  rowNumber: number
  eventLabel: string
  packageLabel: string
  quantity: number | null
  unitCost: number | null
  total: number | null
  supplierName: string
  poNumber: string
  supplierReference: string
  currency: string
  packageId: string | null
  packageName: string | null
  eventName: string | null
  raceId: string | null
  stockPackageId: string | null
  stockPackageName: string | null
  willCreatePackage: boolean
  createPackageName: string | null
  contractUrl: string | null
  contractLocal: boolean
  note: string | null
  errors: string[]
  warnings: string[]
}

export type ParsedPurchaseBulkUpload = {
  headers: string[]
  rows: ParsedPurchaseBulkRow[]
  totalRows: number
  validRows: number
  errorRows: number
}

function key(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function cellValue(row: Record<string, PurchaseBulkCell>, aliases: string[]): PurchaseBulkCell {
  const byKey = new Map(Object.entries(row).map(([header, value]) => [key(header), value]))
  for (const alias of aliases) {
    const found = byKey.get(key(alias))
    if (found && (found.value.trim() !== "" || found.url)) return found
  }
  return { value: "", url: null }
}

const LOCAL_PATH = /^(file:|[a-zA-Z]:\\|\\\\)/i
const HYPERLINK_FORMULA = /^=?HYPERLINK\(\s*"([^"]+)"/i
const URL_IN_TEXT = /https?:\/\/[^\s<>"'\\]+/i

export function packageDisplayName(label: string): string {
  return (label.split("|")[0] ?? label).trim() || label.trim()
}

export function extractContractLink(
  value: string,
  hyperlink?: string | null,
): { url: string | null; local: boolean } {
  const candidates = [hyperlink ?? "", value]
  for (const raw of candidates) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const formula = trimmed.match(HYPERLINK_FORMULA)
    const candidate = formula?.[1]?.trim() || trimmed.match(URL_IN_TEXT)?.[0]?.replace(/[),.;]+$/, "") || trimmed
    if (LOCAL_PATH.test(candidate)) return { url: null, local: true }
    try {
      const parsed = new URL(candidate)
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return { url: parsed.toString(), local: false }
      }
      if (parsed.protocol === "file:") return { url: null, local: true }
    } catch {
      /* not a URL */
    }
  }
  return { url: null, local: false }
}

export function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[|/]+/g, " ")
    .replace(/\b3[\s-]*days?\b/g, "3 day")
    .replace(/\bpaddock\s*club\b/g, "paddock club")
    .replace(/\bgrand\s*prix\b/g, "gp")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokens(value: string): string[] {
  return normalizeMatchText(value)
    .split(" ")
    .filter((part) => part.length > 1 && part !== "the" && part !== "and" && part !== "for")
}

const EVENT_NICKNAMES: Array<{ keys: string[]; extra: string[] }> = [
  { keys: ["australia", "australian", "melbourne"], extra: ["australia", "australian", "melbourne"] },
  { keys: ["china", "chinese", "shanghai"], extra: ["china", "chinese", "shanghai"] },
  { keys: ["japan", "japanese", "suzuka"], extra: ["japan", "japanese", "suzuka"] },
  { keys: ["bahrain", "sakhir"], extra: ["bahrain", "sakhir"] },
  { keys: ["jeddah", "saudi"], extra: ["jeddah", "saudi", "arabia"] },
  { keys: ["miami"], extra: ["miami"] },
  { keys: ["canada", "canadian", "montreal"], extra: ["canada", "canadian", "montreal"] },
  { keys: ["monaco", "monte"], extra: ["monaco", "monte"] },
  { keys: ["spain", "spanish", "barcelona", "catalunya"], extra: ["spain", "spanish", "barcelona"] },
  { keys: ["monaco"], extra: ["monaco"] },
  { keys: ["britain", "british", "silverstone", "uk"], extra: ["britain", "british", "silverstone"] },
  { keys: ["hungary", "hungarian", "budapest"], extra: ["hungary", "hungarian", "budapest"] },
  { keys: ["belgium", "belgian", "spa"], extra: ["belgium", "belgian", "spa"] },
  { keys: ["italy", "italian", "monza"], extra: ["italy", "italian", "monza"] },
  { keys: ["netherlands", "dutch", "zandvoort"], extra: ["netherlands", "dutch", "zandvoort"] },
  { keys: ["azerbaijan", "baku"], extra: ["azerbaijan", "baku"] },
  { keys: ["singapore"], extra: ["singapore"] },
  { keys: ["austin", "cota", "united states", "usa"], extra: ["austin", "united", "states"] },
  { keys: ["mexico", "mexican"], extra: ["mexico", "mexican"] },
  { keys: ["brazil", "sao paulo", "interlagos"], extra: ["brazil", "paulo"] },
  { keys: ["vegas", "las vegas"], extra: ["vegas", "las"] },
  { keys: ["qatar", "lusail"], extra: ["qatar", "lusail"] },
  { keys: ["abu dhabi", "yas"], extra: ["dhabi", "yas"] },
]

function expandEventQuery(query: string): string {
  const normalized = normalizeMatchText(query)
  const extras: string[] = []
  for (const group of EVENT_NICKNAMES) {
    if (group.keys.some((key) => normalized.includes(key))) extras.push(...group.extra)
  }
  return extras.length ? `${normalized} ${extras.join(" ")}` : normalized
}

const PLACEHOLDER = /^(na|n\/a|tbc|tba|-|none|nil|not set|from above|same as above|as above)$/i
const BLANK_QTY = /^(no completed|not completed|incomplete|pending)$/i
const USELESS_PO = /^(agreed|agreeed|awaiting|tbc|tba|na|n\/a|from above|same as above|as above|can'?t find|missing)$/i

export function parseMoneyAmount(raw: string): number | null {
  const value = raw.trim()
  if (!value || PLACEHOLDER.test(value) || BLANK_QTY.test(value)) return null
  let textValue = value.replace(/[$£€]/g, "").replace(/,/g, "").trim()
  const paren = textValue.match(/^\((.+)\)$/)
  if (paren) textValue = paren[1]
  const number = Number(textValue)
  if (!Number.isFinite(number)) return null
  return Math.abs(number)
}

export function parseQuantity(raw: string): number | null {
  const value = raw.trim()
  if (!value || PLACEHOLDER.test(value) || BLANK_QTY.test(value)) return null
  const number = Number(value.replace(/,/g, ""))
  if (!Number.isFinite(number) || number <= 0) return null
  return Math.floor(number)
}

function looksLikePoNumber(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || USELESS_PO.test(trimmed) || trimmed.length < 3) return false
  if (/awaiting|can'?t find|signed doc|from above/i.test(trimmed)) return false
  if (/^https?:\/\//i.test(trimmed) || LOCAL_PATH.test(trimmed) || HYPERLINK_FORMULA.test(trimmed)) return false
  return true
}

type EventMatchFields = {
  raceName: string
  raceShortName: string
  location: string
  country: string
  countryCode: string
  eventDate?: string | null
  season?: number | null
}

function scoreEvent(query: string, pkg: EventMatchFields): number {
  const q = normalizeMatchText(query)
  if (!q) return 0
  const fields = [
    pkg.raceName,
    pkg.raceShortName,
    pkg.location,
    pkg.country,
    pkg.countryCode,
  ]
    .map(normalizeMatchText)
    .filter(Boolean)
  if (fields.some((field) => field === q)) return 100
  if (fields.some((field) => field.length > 2 && (field.includes(q) || q.includes(field)))) return 80
  const queryTokens = [...new Set([...tokens(query), ...tokens(expandEventQuery(query))])]
  if (queryTokens.length === 0) return 0
  const hay = fields.join(" ")
  const hits = queryTokens.filter((token) => hay.includes(token)).length
  if (hits === 0) return 0
  return Math.round((hits / queryTokens.length) * 70)
}

function scorePackage(query: string, pkg: PurchaseBulkCatalogPackage): number {
  const variants = [query, query.split("|")[0] ?? query]
    .map((value) => normalizeMatchText(value))
    .filter(Boolean)
  const name = normalizeMatchText(pkg.name)
  if (!name) return 0
  for (const variant of variants) {
    if (name === variant) return 100
    if (name.includes(variant) || variant.includes(name)) return 85
  }
  const queryTokens = tokens(variants[0] ?? query)
  if (queryTokens.length === 0) return 0
  const nameTokens = new Set(tokens(pkg.name))
  const hits = queryTokens.filter((token) => nameTokens.has(token) || name.includes(token)).length
  if (hits === 0) return 0
  let score = Math.round((hits / queryTokens.length) * 70)
  if (/\b3 day\b/.test(variants[0] ?? "") && pkg.duration === "3_day") score += 8
  return score
}

function eventRecency(pkg: EventMatchFields, now = Date.now()): number {
  if (pkg.eventDate) {
    const time = new Date(pkg.eventDate).getTime()
    if (!Number.isNaN(time)) {
      if (time >= now) return 1_000_000_000 - time
      return time
    }
  }
  return pkg.season ?? 0
}

export function matchPurchaseRace(
  eventLabel: string,
  races: PurchaseBulkCatalogRace[],
): PurchaseBulkCatalogRace | null {
  const scored = races
    .map((race) => ({
      race,
      score: scoreEvent(eventLabel, {
        raceName: race.name,
        raceShortName: race.shortName,
        location: race.location,
        country: race.country,
        countryCode: race.countryCode,
        eventDate: race.eventDate,
        season: race.season,
      }),
    }))
    .filter((row) => row.score >= 40)
    .sort(
      (a, b) =>
        b.score - a.score ||
        eventRecency({
          raceName: b.race.name,
          raceShortName: b.race.shortName,
          location: b.race.location,
          country: b.race.country,
          countryCode: b.race.countryCode,
          eventDate: b.race.eventDate,
          season: b.race.season,
        }) -
          eventRecency({
            raceName: a.race.name,
            raceShortName: a.race.shortName,
            location: a.race.location,
            country: a.race.country,
            countryCode: a.race.countryCode,
            eventDate: a.race.eventDate,
            season: a.race.season,
          }),
    )
  return scored[0]?.race ?? null
}

function racesFromCatalog(catalog: PurchaseBulkCatalog): PurchaseBulkCatalogRace[] {
  if (catalog.races?.length) return catalog.races
  const byId = new Map<string, PurchaseBulkCatalogRace>()
  for (const pkg of catalog.packages) {
    if (!pkg.raceId || byId.has(pkg.raceId)) continue
    byId.set(pkg.raceId, {
      id: pkg.raceId,
      name: pkg.raceName,
      shortName: pkg.raceShortName,
      location: pkg.location,
      country: pkg.country,
      countryCode: pkg.countryCode,
      season: pkg.season,
      eventDate: pkg.eventDate,
      dateRange: null,
      image: null,
      category: "formula_1",
    })
  }
  return [...byId.values()]
}

function toCells(record: Record<string, string | PurchaseBulkCell>): Record<string, PurchaseBulkCell> {
  return Object.fromEntries(
    Object.entries(record).map(([header, value]) => {
      if (value && typeof value === "object" && "value" in value) {
        const cell = value as PurchaseBulkCell
        const extracted = extractContractLink(cell.value, cell.url)
        return [header, { value: cell.value, url: extracted.url }]
      }
      const textValue = String(value ?? "")
      return [header, { value: textValue, url: extractContractLink(textValue).url }]
    }),
  )
}

export function matchPurchaseEvent(
  eventLabel: string,
  packages: PurchaseBulkCatalogPackage[],
): PurchaseBulkCatalogPackage[] {
  const scored = packages
    .map((pkg) => ({ pkg, score: scoreEvent(eventLabel, pkg) }))
    .filter((row) => row.score >= 40)
    .sort((a, b) => b.score - a.score || eventRecency(b.pkg) - eventRecency(a.pkg))
  const best = scored[0]?.score ?? 0
  const raceIds = new Set(
    scored.filter((row) => row.score >= best - 5).map((row) => row.pkg.raceId).filter(Boolean),
  )
  if (raceIds.size <= 1) {
    const raceId = [...raceIds][0]
    return packages.filter((pkg) => (raceId ? pkg.raceId === raceId : scored.some((row) => row.pkg.id === pkg.id)))
  }
  const preferredRaceId = scored[0]?.pkg.raceId
  return packages.filter((pkg) => pkg.raceId === preferredRaceId)
}

export function matchPurchasePackage(
  packageLabel: string,
  candidates: PurchaseBulkCatalogPackage[],
): { pkg: PurchaseBulkCatalogPackage; ambiguous: PurchaseBulkCatalogPackage[] } | { error: string } {
  const usable = candidates.filter((pkg) => !pkg.shellParentPackageId)
  const scored = usable
    .map((pkg) => ({ pkg, score: scorePackage(packageLabel, pkg) }))
    .filter((row) => row.score >= 45)
    .sort((a, b) => b.score - a.score || a.pkg.name.localeCompare(b.pkg.name))
  if (scored.length === 0) {
    return { error: `No catalog product matched "${packageLabel}".` }
  }
  const best = scored[0]!.score
  const ties = scored.filter((row) => row.score >= best - 3).map((row) => row.pkg)
  if (ties.length > 1) {
    const threeDay = ties.find((pkg) => pkg.duration === "3_day")
    if (threeDay && /\b3[\s-]*days?\b/i.test(packageLabel)) {
      return { pkg: threeDay, ambiguous: [] }
    }
    return {
      error: `Several products matched "${packageLabel}": ${ties
        .slice(0, 4)
        .map((pkg) => pkg.name)
        .join("; ")}.`,
    }
  }
  return { pkg: scored[0]!.pkg, ambiguous: [] }
}

export function resolveStockPackage(
  pkg: PurchaseBulkCatalogPackage,
  catalog: PurchaseBulkCatalogPackage[],
): { pkg: PurchaseBulkCatalogPackage; warning: string | null } {
  if (pkg.shellParentPackageId) {
    const parent = catalog.find((row) => row.id === pkg.shellParentPackageId)
    if (parent) {
      return {
        pkg: parent,
        warning: `Stock will be added to ${parent.name} (linked 3-day parent), not the shell product.`,
      }
    }
  }
  if (pkg.inventoryGroupId && pkg.duration && pkg.duration !== "3_day") {
    const parent = catalog.find(
      (row) =>
        row.inventoryGroupId === pkg.inventoryGroupId &&
        row.duration === "3_day" &&
        !row.shellParentPackageId,
    )
    if (parent && parent.id !== pkg.id) {
      return {
        pkg: parent,
        warning: `This product shares linked stock with ${parent.name}. The purchase will be added to that 3-day parent.`,
      }
    }
  }
  return { pkg, warning: null }
}

function buildNote(parts: Array<[string, string]>): string | null {
  const lines = parts
    .map(([label, value]) => {
      const trimmed = value.trim()
      if (!trimmed || PLACEHOLDER.test(trimmed)) return null
      return `${label}: ${trimmed}`
    })
    .filter((line): line is string => Boolean(line))
  return lines.length ? lines.join(" · ").slice(0, 5000) : null
}

export function parsePurchaseBulkCsv(
  csvText: string,
  catalog: PurchaseBulkCatalog,
): ParsedPurchaseBulkUpload {
  const textValue = csvText.replace(/^\uFEFF/, "").trim()
  if (!textValue) {
    return {
      headers: [...PURCHASE_BULK_TEMPLATE_HEADERS],
      rows: [],
      totalRows: 0,
      validRows: 0,
      errorRows: 0,
    }
  }

  let records: Record<string, string>[]
  try {
    records = parse(textValue, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    }) as Record<string, string>[]
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "The CSV file could not be read.")
  }

  return parsePurchaseBulkRecords(records.map(toCells), catalog)
}

export function parsePurchaseBulkRecords(
  records: Record<string, PurchaseBulkCell>[],
  catalog: PurchaseBulkCatalog,
): ParsedPurchaseBulkUpload {
  if (records.length > PURCHASE_BULK_MAX_ROWS) {
    throw new Error(`Please keep the upload to ${PURCHASE_BULK_MAX_ROWS} rows or fewer.`)
  }

  const races = racesFromCatalog(catalog)
  const headers = records[0] ? Object.keys(records[0]) : [...PURCHASE_BULK_TEMPLATE_HEADERS]
  let lastSupplier = ""
  let lastSupplierReference = ""
  let lastContractUrl: string | null = null
  const generatedPoBySupplier = new Map<string, string>()
  const existingRefKeys = new Set(
    [...catalog.existingPoNumbers, ...(catalog.existingSupplierReferences ?? [])]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )

  const rows: ParsedPurchaseBulkRow[] = records.flatMap((record, index) => {
    const rowNumber = index + 2
    const errors: string[] = []
    const warnings: string[] = []
    const eventCell = cellValue(record, ["Event", "Race", "Grand Prix", "GP"])
    const packageCell = cellValue(record, ["Package", "Product", "Ticket", "Hospitality"])
    const supplierCell = cellValue(record, ["Supplier", "Vendor", "Source"])
    const qtyCell = cellValue(record, ["QTY", "Qty", "Quantity", "Units"])
    const unitCell = cellValue(record, ["Cost Per Unit", "Unit cost", "Cost/Unit", "Buy price", "Unit Cost"])
    const totalCell = cellValue(record, ["Total", "Total cost", "Amount"])
    const invoiceCell = cellValue(record, ["Invoice Number", "Invoice", "Invoice No", "Invoice #"])
    const orderCell = cellValue(record, [
      "Order / Contract",
      "Order",
      "Contract",
      "PO",
      "PO Number",
      "Purchase order",
    ])
    const parking = cellValue(record, ["Parking"]).value
    const paid = cellValue(record, ["Paid"]).value
    const soldRaw = cellValue(record, ["Sold"]).value
    const legendDay = cellValue(record, ["Legend Day", "Legend"]).value
    const tourTimes = cellValue(record, ["Tour Times", "Tours"]).value
    const contact = cellValue(record, ["Contact", "Contact name"]).value
    const contactEmail = cellValue(record, ["Contact Email", "Email"]).value

    const eventLabel = eventCell.value.trim()
    const packageLabel = packageCell.value.trim()
    const supplierRaw = supplierCell.value.trim()
    const qtyRaw = qtyCell.value.trim()
    const unitRaw = unitCell.value.trim()
    const totalRaw = totalCell.value.trim()
    const invoiceRaw = invoiceCell.value.trim()
    const orderRaw = orderCell.value.trim()

    if (!eventLabel && !packageLabel && !qtyRaw && !supplierRaw && !invoiceRaw && !orderRaw && !orderCell.url) {
      return []
    }

    let supplierName = supplierRaw
    if (!supplierName || PLACEHOLDER.test(supplierName)) {
      supplierName = lastSupplier
      if (supplierName) warnings.push("Supplier taken from the row above.")
    } else {
      lastSupplier = supplierName
    }
    if (!supplierName) errors.push("Supplier is required.")

    const quantity = parseQuantity(qtyRaw)
    if (quantity == null) errors.push("Quantity is missing or not a whole number.")

    const total = parseMoneyAmount(totalRaw)
    let unitCost = parseMoneyAmount(unitRaw)
    if (unitCost == null && total != null && quantity) {
      unitCost = Math.round((total / quantity) * 100) / 100
      warnings.push("Unit cost was calculated from Total ÷ QTY.")
    }
    if (unitCost == null) {
      unitCost = 0
      warnings.push("No buy price on this row — stock will be added at $0 until you edit the purchase.")
    }

    let supplierReference = ""
    if (looksLikePoNumber(invoiceRaw)) supplierReference = invoiceRaw
    else if (looksLikePoNumber(orderRaw)) supplierReference = orderRaw
    else if (PLACEHOLDER.test(invoiceRaw) || PLACEHOLDER.test(orderRaw)) {
      supplierReference = lastSupplierReference
      if (supplierReference) warnings.push("Contract/invoice taken from the row above.")
    }

    let poNumber = ""
    if (supplierReference) {
      poNumber = supplierReference
      if (existingRefKeys.has(supplierReference.toLowerCase())) {
        warnings.push(`Will add this stock onto the existing purchase order for ${supplierReference}.`)
      }
    } else if (supplierName) {
      const existing = generatedPoBySupplier.get(supplierName.toLowerCase())
      if (existing) {
        poNumber = existing
        warnings.push("Grouped onto one purchase order for this supplier.")
      } else {
        poNumber = `IMP-${(key(supplierName) || "SUP").slice(0, 24).toUpperCase()}`
        generatedPoBySupplier.set(supplierName.toLowerCase(), poNumber)
        warnings.push("No supplier invoice or contract number — a new internal purchase order will be created for this supplier.")
      }
    }
    if (supplierReference) lastSupplierReference = supplierReference

    const extracted = extractContractLink(orderRaw, orderCell.url)
    let contractUrl = extracted.url
    const contractLocal = extracted.local
    if ((!contractUrl && !contractLocal && PLACEHOLDER.test(orderRaw)) || /^from above$/i.test(orderRaw)) {
      contractUrl = lastContractUrl
      if (contractUrl) warnings.push("Contract link taken from the row above.")
    }
    if (contractUrl) lastContractUrl = contractUrl
    if (contractLocal) {
      warnings.push(
        "Contract is a local file link. Upload the Excel workbook (.xlsx) or paste an https link — a path on your computer cannot be downloaded.",
      )
    } else if (contractUrl) {
      warnings.push("Contract link will be saved on the purchase order and downloaded if the file is publicly reachable.")
    }

    let packageId: string | null = null
    let packageName: string | null = null
    let eventName: string | null = null
    let raceId: string | null = null
    let stockPackageId: string | null = null
    let stockPackageName: string | null = null
    let willCreatePackage = false
    let createPackageName: string | null = null

    if (!eventLabel) {
      errors.push("Event is required.")
    } else if (!packageLabel) {
      errors.push("Package is required.")
    } else {
      const eventPackages = matchPurchaseEvent(eventLabel, catalog.packages)
      const race =
        (eventPackages[0]?.raceId ? races.find((item) => item.id === eventPackages[0]?.raceId) : null) ??
        matchPurchaseRace(eventLabel, races)
      if (!race && eventPackages.length === 0) {
        errors.push(`No catalog event matched "${eventLabel}".`)
      } else {
        raceId = race?.id ?? eventPackages[0]?.raceId ?? null
        eventName = race?.name ?? eventPackages[0]?.raceName ?? null
        const candidates = raceId
          ? catalog.packages.filter((pkg) => pkg.raceId === raceId)
          : eventPackages
        const matched = matchPurchasePackage(packageLabel, candidates)
        if ("error" in matched) {
          if (matched.error.startsWith("No catalog product matched") && raceId) {
            willCreatePackage = true
            createPackageName = packageDisplayName(packageLabel)
            packageName = createPackageName
            stockPackageName = createPackageName
            warnings.push(
              `No matching product — will create "${createPackageName}" on ${eventName ?? "this event"} (hidden from the portal) and add this stock.`,
            )
          } else {
            errors.push(matched.error)
          }
        } else {
          packageId = matched.pkg.id
          packageName = matched.pkg.name
          eventName = matched.pkg.raceName
          raceId = matched.pkg.raceId
          const stock = resolveStockPackage(matched.pkg, catalog.packages)
          stockPackageId = stock.pkg.id
          stockPackageName = stock.pkg.name
          if (stock.warning) warnings.push(stock.warning)
        }
      }
    }

    const sold = parseQuantity(soldRaw)
    if (sold != null) {
      warnings.push(
        `Sold quantity ${sold} is recorded in the note only. Imported remaining stock is the purchased quantity.`,
      )
    }

    const note = buildNote([
      ["Order/contract", orderRaw],
      ["Contract link", contractUrl ?? ""],
      ["Invoice", invoiceRaw],
      ["Parking", parking],
      ["Paid", paid],
      ["Sold", soldRaw],
      ["Legend day", legendDay],
      ["Tour times", tourTimes],
      ["Contact", contact],
      ["Email", contactEmail],
      ["Sheet event", eventLabel],
      ["Sheet package", packageLabel],
    ])

    return [
      {
        rowNumber,
        eventLabel,
        packageLabel,
        quantity,
        unitCost,
        total,
        supplierName,
        poNumber,
        supplierReference,
        currency: "USD",
        packageId,
        packageName,
        eventName,
        raceId,
        stockPackageId,
        stockPackageName,
        willCreatePackage,
        createPackageName,
        contractUrl,
        contractLocal,
        note,
        errors,
        warnings,
      },
    ]
  })

  return {
    headers,
    rows,
    totalRows: rows.length,
    validRows: rows.filter((row) => row.errors.length === 0).length,
    errorRows: rows.filter((row) => row.errors.length > 0).length,
  }
}
