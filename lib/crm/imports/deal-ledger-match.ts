import { normalizeMatchText } from "@/lib/inventory/purchase-bulk-upload"
import {
  planDealLedgerStageUpdate,
  recountDealLedger,
  type ParsedDealLedger,
  type ParsedDealLedgerRow,
} from "@/lib/crm/imports/deal-ledger"

export type DealLedgerCandidateLine = {
  packageId: string
  packageName: string
  raceId: string | null
  raceName: string
  raceShortName: string
  location: string
  country: string
  countryCode: string
  season: number | null
  eventDate: string | null
  quantity: number
  unitSalePrice: number
  supplierName: string | null
}

export type DealLedgerCandidate = {
  id: string
  reference: string
  accountName: string | null
  contactName: string | null
  stage: string
  totalAmount: number
  expectedCloseDate: string | null
  createdAt: string | null
  ledgerInvoiceNumber: string | null
  lines: DealLedgerCandidateLine[]
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
  { keys: ["madrid"], extra: ["madrid"] },
  { keys: ["spain", "spanish", "barcelona", "catalunya"], extra: ["spain", "spanish", "barcelona"] },
  { keys: ["britain", "british", "silverstone"], extra: ["britain", "british", "silverstone"] },
  { keys: ["hungary", "hungarian", "budapest"], extra: ["hungary", "hungarian", "budapest"] },
  { keys: ["belgium", "belgian", "spa"], extra: ["belgium", "belgian", "spa"] },
  { keys: ["italy", "italian", "monza"], extra: ["italy", "italian", "monza"] },
  { keys: ["netherlands", "dutch", "zandvoort"], extra: ["netherlands", "dutch", "zandvoort"] },
  { keys: ["azerbaijan", "baku"], extra: ["azerbaijan", "baku"] },
  { keys: ["singapore"], extra: ["singapore"] },
  { keys: ["austin", "cota"], extra: ["austin"] },
  { keys: ["mexico", "mexican"], extra: ["mexico", "mexican"] },
  { keys: ["brazil", "sao paulo", "interlagos", "brazilian"], extra: ["brazil", "paulo"] },
  { keys: ["vegas", "las vegas"], extra: ["vegas", "las"] },
  { keys: ["qatar", "lusail"], extra: ["qatar", "lusail"] },
  { keys: ["abu dhabi", "yas"], extra: ["dhabi", "yas"] },
  { keys: ["imola", "emilia"], extra: ["imola", "emilia"] },
]

const COMPANY_STOP = new Set([
  "ltd",
  "limited",
  "inc",
  "llc",
  "plc",
  "co",
  "company",
  "uk",
  "gmbh",
  "hospitality",
  "sales",
  "the",
  "and",
  "for",
  "group",
])

const EVENT_STOP = new Set(["f1", "gp", "grand", "prix", "formula", "one", "race", "the", "and"])

function tokens(value: string, stop: Set<string> = COMPANY_STOP): string[] {
  return normalizeMatchText(value)
    .split(" ")
    .filter((part) => part.length > 1 && !stop.has(part))
}

function collapseRepeatTokens(value: string): string {
  return normalizeMatchText(value).replace(/\b(\w+)(?:\s+\1)+\b/g, "$1")
}

function expandEventQuery(query: string): string {
  const normalized = normalizeMatchText(query)
  const extras: string[] = []
  for (const group of EVENT_NICKNAMES) {
    if (group.keys.some((key) => normalized.includes(key))) extras.push(...group.extra)
  }
  return extras.length ? `${normalized} ${extras.join(" ")}` : normalized
}

export function scoreLedgerName(query: string, candidate: string): number {
  const q = normalizeMatchText(query)
  const c = normalizeMatchText(candidate)
  if (!q || !c) return 0
  if (q === c) return 100
  const qTokens = tokens(q)
  const cTokens = tokens(c)
  const qCore = qTokens.join(" ")
  const cCore = cTokens.join(" ")
  if (qCore && qCore === cCore) return 96
  if (c.includes(q) || q.includes(c)) return 86
  if (qCore && cCore && (cCore.includes(qCore) || qCore.includes(cCore))) return 82
  if (qTokens.length === 0 || cTokens.length === 0) return 0
  const cSet = new Set(cTokens)
  const hits = qTokens.filter((token) => cSet.has(token)).length
  if (hits === 0) return 0
  return Math.round((hits / qTokens.length) * 74)
}

function scoreEvent(query: string, line: DealLedgerCandidateLine): number {
  const q = normalizeMatchText(query)
  if (!q) return 0
  const fields = [
    line.raceName,
    line.raceShortName,
    line.location,
    line.country,
    line.countryCode,
    line.season == null ? "" : String(line.season),
  ]
    .map((field) => normalizeMatchText(field))
    .filter(Boolean)
  if (fields.some((field) => field === q)) return 100
  if (fields.some((field) => field.length > 2 && (field.includes(q) || q.includes(field)))) return 84
  const queryTokens = [...new Set([...tokens(q, EVENT_STOP), ...tokens(expandEventQuery(q), EVENT_STOP)])]
  if (queryTokens.length === 0) return 0
  const hay = fields.join(" ")
  const hits = queryTokens.filter((token) => hay.includes(token)).length
  if (hits === 0) return 0
  return Math.round((hits / queryTokens.length) * 72)
}

function scoreProduct(query: string, line: DealLedgerCandidateLine): number {
  const variant = collapseRepeatTokens(query)
  const name = collapseRepeatTokens(line.packageName)
  if (!variant || !name) return 0
  if (name === variant) return 100
  if (name.includes(variant) || variant.includes(name)) return 86
  const queryTokens = tokens(variant, new Set(["the", "and", "for", "at", "f1", "with"]))
  if (queryTokens.length === 0) return 0
  const nameTokens = new Set(tokens(name, new Set(["the", "and", "for", "at", "f1", "with"])))
  const hits = queryTokens.filter((token) => nameTokens.has(token) || name.includes(token)).length
  if (hits === 0) return 0
  return Math.round((hits / queryTokens.length) * 72)
}

function amountClose(expected: number | null, actual: number, tolerance = 0.025): boolean {
  if (expected == null || expected <= 0 || actual <= 0) return false
  return Math.abs(expected - actual) / Math.max(actual, expected) <= tolerance
}

function daysApart(isoA: string | null, isoB: string | null): number | null {
  if (!isoA || !isoB) return null
  const a = Date.parse(`${isoA.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${isoB.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.abs(a - b) / 86_400_000
}

type ScoredDeal = {
  deal: DealLedgerCandidate
  score: number
  clientScore: number
  eventScore: number
  productScore: number
  summary: string
}

function scoreDeal(row: ParsedDealLedgerRow, deal: DealLedgerCandidate): ScoredDeal | null {
  const clientScore = Math.max(
    scoreLedgerName(row.client, deal.accountName ?? ""),
    scoreLedgerName(row.client, deal.contactName ?? "") * 0.92,
  )
  if (clientScore < 52) return null

  const eventScores = deal.lines.map((line) => ({ line, score: row.event ? scoreEvent(row.event, line) : 50 }))
  const productScores = deal.lines.map((line) => ({ line, score: row.product ? scoreProduct(row.product, line) : 0 }))
  const eventScore = row.event ? Math.max(0, ...eventScores.map((item) => item.score)) : 50
  const productScore = row.product ? Math.max(0, ...productScores.map((item) => item.score)) : 0
  if (row.event && eventScore < 38) return null
  if (row.product && productScore < 40) return null
  if (!row.product && eventScore < 70) return null

  const bestProductLine = productScores.sort((a, b) => b.score - a.score)[0]?.line
  const matchedLineQty = bestProductLine?.quantity ?? deal.lines.reduce((sum, line) => sum + line.quantity, 0)
  const matchedLineAmount =
    bestProductLine != null
      ? bestProductLine.quantity * bestProductLine.unitSalePrice
      : deal.totalAmount

  let score = clientScore * 3 + eventScore * 2.5 + productScore * 2
  const reasons: string[] = []
  if (row.quantity != null && row.quantity === matchedLineQty) {
    score += 18
    reasons.push(`qty ${row.quantity}`)
  }
  if (amountClose(row.amount, deal.totalAmount) || amountClose(row.amount, matchedLineAmount)) {
    score += 22
    reasons.push("amount")
  }
  if (row.supplier && bestProductLine?.supplierName && scoreLedgerName(row.supplier, bestProductLine.supplierName) >= 70) {
    score += 10
    reasons.push("supplier")
  }
  if (
    row.invoiceNumber &&
    deal.ledgerInvoiceNumber &&
    normalizeMatchText(row.invoiceNumber) === normalizeMatchText(deal.ledgerInvoiceNumber)
  ) {
    score += 40
    reasons.push("invoice")
  }
  const closeGap = daysApart(row.dealDate, deal.expectedCloseDate ?? deal.createdAt?.slice(0, 10) ?? null)
  if (closeGap != null && closeGap <= 21) {
    score += 6
    reasons.push("date")
  }

  return {
    deal,
    score,
    clientScore,
    eventScore,
    productScore,
    summary: `${deal.reference} · ${deal.accountName || "No account"} · match ${Math.round(score)}${reasons.length ? ` (${reasons.join(", ")})` : ""}`,
  }
}

function candidatesForRow(row: ParsedDealLedgerRow, deals: DealLedgerCandidate[]): ScoredDeal[] {
  return deals
    .map((deal) => scoreDeal(row, deal))
    .filter((item): item is ScoredDeal => item != null)
    .sort((a, b) => b.score - a.score || a.deal.reference.localeCompare(b.deal.reference))
}

export function matchDealLedgerRows(
  parsed: ParsedDealLedger,
  deals: DealLedgerCandidate[],
): ParsedDealLedger {
  const pending = parsed.rows
    .map((row, index) => ({ row, index, scored: row.errors.length ? [] : candidatesForRow(row, deals) }))
    .filter((item) => item.row.errors.length === 0)

  pending.sort((a, b) => {
    const aBest = a.scored[0]?.score ?? 0
    const aSecond = a.scored[1]?.score ?? 0
    const bBest = b.scored[0]?.score ?? 0
    const bSecond = b.scored[1]?.score ?? 0
    return bBest - bSecond - (aBest - aSecond) || bBest - aBest
  })

  const used = new Set<string>()
  for (const item of pending) {
    const available = item.scored.filter((candidate) => !used.has(candidate.deal.id))
    const best = available[0]
    const second = available[1]
    if (!best) {
      item.row.errors.push(
        `No deal matched ${item.row.client}${item.row.event ? ` / ${item.row.event}` : ""}${item.row.product ? ` / ${item.row.product}` : ""}.`,
      )
      continue
    }
    const uniqueByCommercials =
      item.row.quantity != null &&
      item.row.amount != null &&
      (!second || best.score - second.score >= 8)
    if (second && best.score - second.score < 18 && !uniqueByCommercials) {
      item.row.errors.push(
        `Several deals could match this row (${best.deal.reference} and ${second.deal.reference}). Left off so it can be checked.`,
      )
      item.row.matchSummary = [best.summary, second.summary].join(" | ")
      continue
    }
    used.add(best.deal.id)
    item.row.dealId = best.deal.id
    item.row.dealReference = best.deal.reference
    item.row.matchScore = Math.round(best.score)
    item.row.matchSummary = best.summary
    item.row.stagePlan = planDealLedgerStageUpdate({
      currentStage: best.deal.stage,
      paymentStatus: item.row.paymentStatus,
    })
    if (item.row.stagePlan.action === "skip_status" && item.row.stagePlan.warning) {
      item.row.warnings.push(item.row.stagePlan.warning)
    }
  }

  return recountDealLedger(parsed)
}
