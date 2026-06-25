/**
 * Import Salesforce product codes, prices, stock, and Family from Matt's mapping CSV.
 * Does NOT touch description, image, or gallery_images.
 *
 * Usage:
 *   npx tsx scripts/import-sf-product-mapping.ts [path-to-csv]           # dry run
 *   npx tsx scripts/import-sf-product-mapping.ts [path-to-csv] --apply    # write to DB
 */

import { config } from "dotenv"
import { readFileSync } from "fs"
import { resolve } from "path"
import { createClient } from "@supabase/supabase-js"

type SupabaseAnyClient = any

config({ path: resolve(process.cwd(), ".env.local") })

const DEFAULT_CSV = resolve(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  "Downloads/Book(Sheet1).csv",
)

/** Explicit SF product code → portal package id when fuzzy match is unreliable. */
const MANUAL_PACKAGE_BY_CODE: Record<string, string> = {
  "PR - 000065": "monaco-velocity-terrace-sun-sat-2026",
  "PR - 000144": "abudhabi-paddock-club-f1-experiences-2026",
  "PR - 000182": "china-paddock-club-suite-f1-2026",
  "PR - 000191": "japan-f1-experiences-paddock-club-2026",
  "PR - 000617": "abudhabi-marsa-box-sat-sun-2026",
  "PR - 000114": "abudhabi-skybridge-terrace-sunday-2026",
  "PR - 000115": "abudhabi-skybridge-terrace-saturday-2026",
  "PR - 000116": "abudhabi-skybridge-terrace-friday-2026",
  "PR - 000121": "abudhabi-marsa-box-friday-2026",
  "PR - 000122": "abudhabi-marsa-box-saturday-2026",
  "PR - 000123": "abudhabi-marsa-box-sunday-2026",
  "PR - 000732": "singapore-national-gallery-vip-sat-sun-2026",
}

type CsvRow = {
  productCode: string
  eventName: string
  productName: string
  unitPrice: number
  available: number
  stock: number
  sold: number
  family: string
}

type PortalPkg = {
  id: string
  name: string
  circuit: string
  event_date: string
  trade_price: number | null
  product_code: string | null
}

const EVENT_KEYWORDS: Array<{ keyword: string; circuits: string[] }> = [
  { keyword: "abu dhabi", circuits: ["Abu Dhabi Grand Prix"] },
  { keyword: "austria", circuits: ["Austrian Grand Prix"] },
  { keyword: "azerbaijan", circuits: ["Azerbaijan Grand Prix"] },
  { keyword: "barcelona", circuits: ["Barcelona Grand Prix", "Barcelona"] },
  { keyword: "spanish", circuits: ["Spanish Grand Prix", "Spain"] },
  { keyword: "madrid", circuits: ["Spanish Grand Prix", "Spain"] },
  { keyword: "british", circuits: ["British Grand Prix"] },
  { keyword: "canada", circuits: ["Canadian Grand Prix"] },
  { keyword: "china", circuits: ["Chinese Grand Prix"] },
  { keyword: "dutch", circuits: ["Netherlands"] },
  { keyword: "hungarian", circuits: ["Hungarian Grand Prix"] },
  { keyword: "japan", circuits: ["Japanese Grand Prix"] },
  { keyword: "miami", circuits: ["Miami Grand Prix"] },
  { keyword: "monaco", circuits: ["Monaco Grand Prix", "Monaco"] },
  { keyword: "qatar", circuits: ["Qatar Grand Prix"] },
  { keyword: "singapore", circuits: ["Singapore Grand Prix"] },
  { keyword: "usa", circuits: ["United States Grand Prix"] },
]

function parseMoney(raw: string): number {
  const n = Number(raw.replace(/[$,\s]/g, ""))
  return Number.isFinite(n) ? n : 0
}

function parseIntSafe(raw: string): number {
  const n = Number(String(raw).replace(/,/g, "").trim())
  return Number.isFinite(n) ? Math.floor(n) : 0
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (c === "," && !inQuotes) {
      cols.push(cur.trim())
      cur = ""
      continue
    }
    cur += c
  }
  cols.push(cur.trim())
  return cols
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const rows: CsvRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    if (cols.length < 9) continue
    const productCode = cols[0]?.trim()
    if (!productCode || !productCode.startsWith("PR")) continue
    rows.push({
      productCode,
      eventName: cols[1]?.trim() ?? "",
      productName: cols[2]?.trim() ?? "",
      unitPrice: parseMoney(cols[3] ?? "0"),
      available: parseIntSafe(cols[4] ?? "0"),
      stock: Math.max(0, parseIntSafe(cols[5] ?? "0")),
      sold: parseIntSafe(cols[6] ?? "0"),
      family: cols[8]?.trim() || "Package",
    })
  }
  return rows
}

function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/national gallery vip/g, "velocity terrace")
    .replace(/\btgr\b/g, "team")
    .replace(/redbull/g, "red bull")
    .replace(/\bf1e\b/g, "f1 experiences")
    .replace(/by zk/g, "")
    .replace(/clubhouse-/g, "clubhouse")
    .replace(/trackside lounge/g, "trackside terrace")
    .replace(/trackside terrace/g, "trackside lounge")
    .replace(/superyacht hospitality/g, "trackside superyacht")
    .replace(/paddock club f1e suite/g, "f1 experiences paddock club")
    .replace(/paddock club clubhouse/g, "paddock club clubhouse")
    .replace(/paddock club club suite/g, "paddock club club suite")
    .replace(/legend paddock club/g, "legend paddock club")
    .replace(/house 44/g, "house 44")
    .replace(/team haas/g, "team haas")
    .replace(/alpine racing/g, "alpine")
    .replace(/alpine paddock/g, "alpine paddock")
    .replace(/[^\w\s&/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

type DurationKey =
  | "3day"
  | "2day"
  | "sunday"
  | "saturday"
  | "friday"
  | "thursday"
  | "satsun"
  | "frisun"
  | "other"

function extractDuration(raw: string): DurationKey {
  const s = normalizeName(raw)
  if (/\b3\s*days?\b/.test(s) || s.startsWith("3 day")) return "3day"
  if (/\b2\s*days?\b/.test(s) || s.includes("2 day") || s.includes("sat sun") || s.includes("saturday sunday"))
    return "2day"
  if (s.includes("saturday sunday") || s.includes("sat sun") || s.includes("saturday & sunday")) return "satsun"
  if (s.includes("friday sunday") || s.includes("fri sun")) return "frisun"
  if (s.includes("sunday only") || (s.includes("sunday") && !s.includes("saturday"))) return "sunday"
  if (s.includes("saturday only") || (s.includes("saturday") && !s.includes("sunday"))) return "saturday"
  if (s.includes("friday only") || (/\bfriday\b/.test(s) && !s.includes("saturday") && !s.includes("sunday")))
    return "friday"
  if (/\bthursday\b/.test(s)) return "thursday"
  return "other"
}

function productCore(raw: string): string {
  let s = normalizeName(raw)
  s = s
    .replace(/^\d+\s*days?\s+/i, "")
    .replace(/^\d+\s*day\s+/i, "")
    .replace(/\s*-\s*\d+\s*days?$/i, "")
    .replace(/\s*-\s*\d+\s*day$/i, "")
    .replace(/\s+\d+\s*days?$/i, "")
    .replace(/\s+\d+\s*day$/i, "")
    .replace(/\s+(friday|saturday|sunday|thursday)\s+only$/i, "")
    .replace(/\s+(friday|saturday|sunday)\s*$/i, "")
    .replace(/\s+saturday\s*&\s*sunday$/i, "")
    .replace(/\s+saturday\s+and\s+sunday$/i, "")
    .replace(/\s+only$/i, "")
    .trim()
  return s
}

function eventCircuits(eventName: string): string[] {
  const e = eventName.toLowerCase()
  for (const { keyword, circuits } of EVENT_KEYWORDS) {
    if (e.includes(keyword)) return circuits
  }
  return []
}

function eventYear(eventName: string): number | null {
  const m = eventName.match(/\b(20\d{2})\b/)
  return m ? Number(m[1]) : null
}

function durationPortalLabel(d: DurationKey): string[] {
  switch (d) {
    case "3day":
      return ["3 day", "3 days"]
    case "2day":
      return ["2 day", "2 days", "saturday sunday", "sat sun"]
    case "satsun":
      return ["saturday sunday", "sat sun", "saturday & sunday"]
    case "frisun":
      return ["friday sunday", "fri sun"]
    case "sunday":
      return ["sunday"]
    case "saturday":
      return ["saturday"]
    case "friday":
      return ["friday"]
    case "thursday":
      return ["thursday"]
    default:
      return []
  }
}

function matchScore(csv: CsvRow, pkg: PortalPkg): number {
  const circuits = eventCircuits(csv.eventName)
  if (circuits.length === 0) return 0
  if (!circuits.includes(pkg.circuit)) return 0

  const year = eventYear(csv.eventName)
  const pkgYear = pkg.event_date ? Number(pkg.event_date.slice(0, 4)) : null
  if (year && pkgYear && year !== pkgYear) return 0

  const csvCore = productCore(csv.productName)
  const pkgCore = productCore(pkg.name)
  if (!csvCore || !pkgCore) return 0

  const csvDur = extractDuration(csv.productName)
  const pkgDur = extractDuration(pkg.name)
  let score = 0

  // Avoid matching generic "paddock club" to a specific variant (legend, house 44, etc.)
  const variantWords = ["legend", "house 44", "red bull", "alpine", "haas", "clubhouse", "f1 experiences", "velocity", "marsa", "skybridge", "marina views", "trackside"]
  const csvVariant = variantWords.find((w) => csvCore.includes(w))
  const pkgVariant = variantWords.find((w) => pkgCore.includes(w))
  if (csvVariant && pkgVariant && csvVariant !== pkgVariant) return 0
  if ((csvVariant && !pkgVariant) || (!csvVariant && pkgVariant)) score -= 20

  if (csvCore === pkgCore) score += 80
  else if (csvCore.includes(pkgCore) || pkgCore.includes(csvCore)) score += 50
  else {
    const csvTokens = new Set(csvCore.split(" ").filter((t) => t.length > 2))
    const pkgTokens = new Set(pkgCore.split(" ").filter((t) => t.length > 2))
    let overlap = 0
    for (const t of csvTokens) if (pkgTokens.has(t)) overlap++
    if (overlap < 2) return 0
    score += overlap * 8
  }

  if (csvDur === pkgDur) score += 25
  else if (csvDur !== "other" && pkgDur !== "other") score -= 15

  const pkgNorm = normalizeName(pkg.name)
  for (const hint of durationPortalLabel(csvDur)) {
    if (pkgNorm.includes(hint)) score += 5
  }

  // Prefer sellable packages (price on CSV or portal)
  if (csv.unitPrice > 0) score += 3
  if (pkg.trade_price != null && pkg.trade_price > 0) score += 2

  return score
}

function findBestMatch(csv: CsvRow, packages: PortalPkg[]): { pkg: PortalPkg; score: number } | null {
  let best: { pkg: PortalPkg; score: number } | null = null
  for (const pkg of packages) {
    const score = matchScore(csv, pkg)
    if (score < 55) continue
    if (!best || score > best.score) best = { pkg, score }
  }
  return best
}

async function ensureColumn(admin: SupabaseAnyClient) {
  const { error } = await admin.rpc("exec_sql" as never, {} as never)
  void error
  // Column added via migration; if missing, updates will fail with a clear error.
}

async function syncInventory(
  admin: SupabaseAnyClient,
  packageId: string,
  stock: number,
  available: number,
): Promise<string | null> {
  const avail = Math.max(0, available)

  const { data: inv } = await admin
    .from("package_inventory")
    .select("qty_available, qty_held")
    .eq("package_id", packageId)
    .maybeSingle()

  if (!inv) {
    await admin.from("package_inventory").insert({ package_id: packageId, qty_available: avail, qty_held: 0 })
  } else {
    const held = Number(inv.qty_held ?? 0)
    if (avail < held) {
      return `available ${avail} < held ${held} — inventory not changed`
    }
    await admin.from("package_inventory").update({ qty_available: avail }).eq("package_id", packageId)
  }

  const { data: layers } = await admin
    .from("package_cost_layers")
    .select("id, quantity, quantity_remaining")
    .eq("package_id", packageId)
    .order("received_at", { ascending: true })

  if (!layers?.length) {
    const { data: pkg } = await admin.from("packages").select("currency").eq("id", packageId).maybeSingle()
    await admin.from("package_cost_layers").insert({
      package_id: packageId,
      quantity: stock,
      quantity_remaining: avail,
      unit_cost: 0,
      currency: pkg?.currency ?? "USD",
      note: "SF import baseline",
      source: null,
    })
    return null
  }

  if (layers.length === 1) {
    const layer = layers[0]
    const consumed = Number(layer.quantity) - Number(layer.quantity_remaining)
    const newQty = Math.max(stock, consumed)
    const newRemaining = Math.max(0, Math.min(avail, newQty - consumed))
    await admin
      .from("package_cost_layers")
      .update({ quantity: newQty, quantity_remaining: newRemaining })
      .eq("id", layer.id)
    return null
  }

  return `${layers.length} cost layers — stock not auto-adjusted (manual review)`
}

async function main() {
  const csvPath = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : DEFAULT_CSV
  const apply = process.argv.includes("--apply")

  const text = readFileSync(csvPath, "utf8")
  const csvRows = parseCsv(text)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const admin = createClient(url, key)

  await ensureColumn(admin)

  const { data: packages, error } = await admin
    .from("packages")
    .select("id, name, circuit, event_date, trade_price, product_code")
    .order("circuit")
    .order("name")

  if (error || !packages) throw new Error(error?.message ?? "Failed to load packages")

  const portalPkgs = packages as PortalPkg[]
  const matched: Array<{
    csv: CsvRow
    pkg: PortalPkg
    score: number
    stockNote: string | null
  }> = []
  const unmatchedCsv: CsvRow[] = []
  const usedPackageIds = new Set<string>()

  const pkgById = new Map(portalPkgs.map((p) => [p.id, p]))

  for (const csv of csvRows) {
    const manualId = MANUAL_PACKAGE_BY_CODE[csv.productCode]
    if (manualId) {
      const pkg = pkgById.get(manualId)
      if (pkg && !usedPackageIds.has(pkg.id)) {
        usedPackageIds.add(pkg.id)
        matched.push({ csv, pkg, score: 200, stockNote: null })
        continue
      }
    }

    // Skip SF-only single-ticket shells with no price unless we'd match a day package
    if (csv.family === "Single Ticket" && csv.unitPrice === 0) {
      unmatchedCsv.push(csv)
      continue
    }

    const best = findBestMatch(csv, portalPkgs)
    if (!best) {
      unmatchedCsv.push(csv)
      continue
    }

    if (usedPackageIds.has(best.pkg.id)) {
      unmatchedCsv.push(csv)
      continue
    }

    usedPackageIds.add(best.pkg.id)
    matched.push({ csv, pkg: best.pkg, score: best.score, stockNote: null })
  }

  const unmatchedPortal = portalPkgs.filter(
    (p) => !usedPackageIds.has(p.id) && p.event_date?.startsWith("2026") && !p.id.includes("test"),
  )

  console.log(`CSV rows: ${csvRows.length}`)
  console.log(`Matched: ${matched.length}${apply ? " (applying)" : " (dry run)"}`)
  console.log("")

  const { error: familyProbeErr } = await admin.from("packages").select("salesforce_product_family").limit(1)
  const hasFamilyColumn = !familyProbeErr?.message?.includes("does not exist")
  if (!hasFamilyColumn) {
    console.warn(
      "Note: run supabase/migrations/20250609120000_salesforce_product_family.sql in Supabase SQL editor to store Product Family per package.",
    )
  }

  if (apply) {
    for (const { csv, pkg } of matched) {
      const updates: Record<string, unknown> = {
        product_code: csv.productCode,
        total_capacity: csv.stock,
      }
      if (hasFamilyColumn) updates.salesforce_product_family = csv.family
      if (csv.unitPrice > 0) updates.trade_price = csv.unitPrice

      const { error: upErr } = await admin.from("packages").update(updates).eq("id", pkg.id)
      if (upErr) {
        console.error(`FAIL ${pkg.id}: ${upErr.message}`)
        continue
      }

      const stockNote = await syncInventory(admin, pkg.id, csv.stock, csv.available)
      const entry = matched.find((m) => m.pkg.id === pkg.id)
      if (entry) entry.stockNote = stockNote
    }
  }

  console.log("=== MATCHED ===")
  for (const { csv, pkg, score, stockNote } of matched.sort((a, b) => a.pkg.circuit.localeCompare(b.pkg.circuit))) {
    console.log(
      `${csv.productCode} → ${pkg.id} (${pkg.name}) [${pkg.circuit}] score=${score}` +
        (csv.unitPrice > 0 ? ` price=$${csv.unitPrice}` : "") +
        ` stock=${csv.stock} avail=${csv.available}` +
        (stockNote ? ` ⚠ ${stockNote}` : ""),
    )
  }

  console.log("\n=== CSV NOT MATCHED (review — SF-only or name mismatch) ===")
  for (const csv of unmatchedCsv) {
    console.log(`${csv.productCode} | ${csv.eventName} | ${csv.productName} | ${csv.family}`)
  }

  console.log("\n=== PORTAL 2026 PACKAGES NOT MATCHED (no SF row in this CSV) ===")
  for (const pkg of unmatchedPortal.sort((a, b) => a.circuit.localeCompare(b.circuit))) {
    if (pkg.name.toLowerCase().includes("test")) continue
    console.log(`${pkg.id} | ${pkg.circuit} | ${pkg.name}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
