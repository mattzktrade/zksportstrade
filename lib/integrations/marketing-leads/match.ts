import { inferPackageDurationFromName } from "@/lib/catalog/package-duration"
import {
  normalizeMarketingAlias,
  type MarketingLeadPayload,
} from "@/lib/integrations/marketing-leads/parse"

export type MarketingRaceCandidate = {
  id: string
  name: string
  season: number | null
  location: string | null
  country: string | null
  short_name: string | null
}

export type MarketingPackageCandidate = {
  id: string
  name: string
  race_id: string | null
  duration: string | null
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
  { keys: ["malaysia", "sepang"], extra: ["malaysia", "sepang"] },
]

const QUERY_STOP = new Set([
  "the",
  "and",
  "for",
  "at",
  "of",
  "a",
  "an",
  "per",
  "guest",
  "guests",
  "each",
  "is",
  "with",
  "f1",
  "formula",
  "one",
  "race",
  "ticket",
  "tickets",
  "yes",
  "no",
  "works",
  "that",
  "me",
  "please",
  "looking",
  "book",
  "soon",
  "how",
  "are",
  "you",
  "to",
  "within",
  "next",
  "few",
  "weeks",
  "lead",
  "form",
  "sports",
  "zk",
  "df",
  "prospecting",
  "campaign",
])

const WEAK_PACKAGE_TOKENS = new Set(["2", "3", "day", "days", "paddock", "club", "package", "gp"])

const PRODUCT_HINT =
  /\b(paddock|suite|terrace|grandstand|hospitality|hotel|champion|champions|velocity|marina|legend|lounge|experiences|clubhouse|house\s*\d+|club\s*suite|sky\s*suite)\b/i

const AFFIRMATIVE =
  /\b(yes|yeah|yep|true|ok|okay|sure|please|interested|definitely|absolutely|works for me|that works|i'?d like|i would|sounds good)\b/i

const NEGATIVE = /^(no|n|false|none|nope|not interested|not for me)\b/i

const USELESS_PACKAGE =
  /^(yes|no|y|n|true|false|ok|okay|sure|none|n\/a|na)(\b|[.!,].*)?$/i

export function stripMarketingPrices(value: string): string {
  return value
    .replace(/[$£€]/g, " ")
    .replace(/\b\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?\b/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
}

export function looksLikeUselessInterestLabel(value: string): boolean {
  const text = value.trim()
  if (!text) return true
  if (USELESS_PACKAGE.test(text)) return true
  if (/works for me|that works/i.test(text) && !isProductLikeText(text)) return true
  return false
}

export function isAffirmativeAnswer(value: string): boolean {
  const text = value.trim()
  if (!text || NEGATIVE.test(text)) return false
  return AFFIRMATIVE.test(text)
}

export function isProductLikeText(value: string): boolean {
  return PRODUCT_HINT.test(stripMarketingPrices(value))
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = normalizeMarketingAlias(trimmed)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

function tokens(value: string): string[] {
  return normalizeMarketingAlias(stripMarketingPrices(value))
    .replace(/\bdays\b/g, "day")
    .replace(/\bsuites\b/g, "suite")
    .split(" ")
    .filter((part) => part.length > 1 && !QUERY_STOP.has(part))
}

function expandEventTokens(query: string): string[] {
  const normalized = normalizeMarketingAlias(query)
  const extras: string[] = []
  for (const group of EVENT_NICKNAMES) {
    if (group.keys.some((key) => normalized.includes(key))) extras.push(...group.extra)
  }
  return [...new Set([...tokens(query), ...extras])]
}

export function marketingEventQueries(payload: MarketingLeadPayload): string[] {
  return unique(
    [
      payload.interest.event,
      payload.campaign.name,
      payload.campaign.formName,
      payload.campaign.adsetName,
    ].filter((value): value is string => Boolean(value && value.trim())),
  )
}

export function marketingPackageQueries(payload: MarketingLeadPayload): string[] {
  const out: string[] = []
  const labeled = payload.interest.package?.trim() || ""
  if (labeled && isProductLikeText(labeled) && !looksLikeUselessInterestLabel(labeled)) {
    out.push(labeled)
  }
  for (const row of payload.answers) {
    const question = row.question.trim()
    const answer = row.answer.trim()
    if (isProductLikeText(question)) {
      if (NEGATIVE.test(answer)) continue
      if (isAffirmativeAnswer(answer) || looksLikeUselessInterestLabel(answer)) {
        out.push(question)
        continue
      }
      if (isProductLikeText(answer) && !looksLikeUselessInterestLabel(answer)) {
        out.push(answer)
      }
      continue
    }
    if (isProductLikeText(answer) && !looksLikeUselessInterestLabel(answer)) {
      out.push(answer)
    }
  }
  return unique(out)
}

function extractYear(queries: string[]): number | null {
  for (const query of queries) {
    const match = query.match(/\b(202[4-9]|203[0-5])\b/)
    if (match) return Number(match[1])
  }
  return null
}

function raceHaystack(race: MarketingRaceCandidate): string {
  return normalizeMarketingAlias(
    [race.name, race.short_name, race.location, race.country, race.season == null ? "" : String(race.season)].join(" "),
  )
}

export function scoreMarketingRace(query: string, race: MarketingRaceCandidate): number {
  const q = normalizeMarketingAlias(query)
  if (!q) return 0
  const hay = raceHaystack(race)
  if (!hay) return 0
  if (hay === q) return 100
  if (hay.includes(q) || q.includes(hay)) return 88
  const queryTokens = expandEventTokens(query)
  if (queryTokens.length === 0) return 0
  const hits = queryTokens.filter((token) => hay.includes(token)).length
  if (hits === 0) return 0
  return Math.round((hits / queryTokens.length) * 80)
}

export function pickMarketingRace(
  queries: string[],
  races: MarketingRaceCandidate[],
  now = new Date(),
): MarketingRaceCandidate | null {
  const usable = unique(queries)
  if (usable.length === 0) return null
  const scored = races
    .map((race) => ({
      race,
      score: Math.max(0, ...usable.map((query) => scoreMarketingRace(query, race))),
    }))
    .filter((row) => row.score >= 28)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.race.season ?? 9999) - (b.race.season ?? 9999),
    )
  if (scored.length === 0) return null

  const year = extractYear(usable)
  const preferredYear = year ?? now.getUTCFullYear()
  const sameEvent = (left: MarketingRaceCandidate, right: MarketingRaceCandidate) =>
    normalizeMarketingAlias(left.name) === normalizeMarketingAlias(right.name) ||
    normalizeMarketingAlias(left.short_name) === normalizeMarketingAlias(right.short_name)

  const top = scored.filter((row) => row.score === scored[0].score)
  const seasonal = top.filter((row) => row.race.season === preferredYear)
  if (seasonal.length === 1) return seasonal[0].race
  if (seasonal.length > 1 && seasonal.every((row) => sameEvent(row.race, seasonal[0].race))) {
    return seasonal.sort((a, b) => (a.race.season ?? 0) - (b.race.season ?? 0))[0].race
  }

  const upcoming = top.filter((row) => (row.race.season ?? 0) >= preferredYear)
  const pool = upcoming.length > 0 ? upcoming : top
  const chosen = pool.sort((a, b) => (a.race.season ?? 9999) - (b.race.season ?? 9999))[0]
  if (!chosen) return null
  const rivals = pool.filter((row) => !sameEvent(row.race, chosen.race))
  if (rivals.length > 0 && rivals[0].score === chosen.score) return null
  return chosen.race
}

function distinctivePackageTokens(name: string): string[] {
  return tokens(name).filter((token) => !WEAK_PACKAGE_TOKENS.has(token))
}

export function scoreMarketingPackage(query: string, pkg: MarketingPackageCandidate): number {
  const qNorm = normalizeMarketingAlias(stripMarketingPrices(query))
  const nNorm = normalizeMarketingAlias(pkg.name)
  if (!qNorm || !nNorm) return 0
  if (qNorm === nNorm) return 100
  if (nNorm.includes(qNorm) || qNorm.includes(nNorm)) return 90

  const queryTokens = tokens(query)
  const nameTokens = tokens(pkg.name)
  if (queryTokens.length === 0 || nameTokens.length === 0) return 0
  const nameSet = new Set(nameTokens)
  const hits = queryTokens.filter((token) => nameSet.has(token)).length
  if (hits === 0) return 0

  const distinctiveQuery = distinctivePackageTokens(query)
  const distinctiveName = distinctivePackageTokens(pkg.name)
  const distinctiveHits = distinctiveQuery.filter((token) => distinctiveName.includes(token)).length
  const unmatchedName = distinctiveName.filter((token) => !queryTokens.includes(token)).length
  const duration = inferPackageDurationFromName(query)
  const durationBonus = duration && duration === pkg.duration ? 8 : 0
  return hits * 10 + distinctiveHits * 22 - unmatchedName * 18 + durationBonus
}

export function pickMarketingPackage(
  queries: string[],
  packages: MarketingPackageCandidate[],
): MarketingPackageCandidate | null {
  const usable = unique(queries)
  if (usable.length === 0) return null
  const scored = packages
    .map((pkg) => ({
      pkg,
      score: Math.max(0, ...usable.map((query) => scoreMarketingPackage(query, pkg))),
    }))
    .filter((row) => {
      const distinctive = distinctivePackageTokens(row.pkg.name)
      const queryTokens = new Set(usable.flatMap((query) => tokens(query)))
      const distinctiveHits = distinctive.filter((token) => queryTokens.has(token)).length
      if (distinctive.length > 0 && distinctiveHits === 0) return false
      return row.score >= 36
    })
    .sort((a, b) => b.score - a.score || a.pkg.name.localeCompare(b.pkg.name))
  if (scored.length === 0) return null
  const best = scored[0]
  const rival = scored.find((row) => row.pkg.id !== best.pkg.id)
  if (rival && rival.score >= best.score - 4) return null
  return best.pkg
}

export function pickMarketingPackages(
  queries: string[],
  packages: MarketingPackageCandidate[],
): MarketingPackageCandidate[] {
  const usable = unique(queries)
  if (usable.length === 0) return []
  const picked = new Map<string, MarketingPackageCandidate>()
  for (const query of usable) {
    const match = pickMarketingPackage([query], packages)
    if (match) picked.set(match.id, match)
  }
  if (picked.size === 0) {
    const combined = pickMarketingPackage(usable, packages)
    return combined ? [combined] : []
  }
  return [...picked.values()]
}
