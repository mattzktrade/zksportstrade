import type { SupabaseClient } from "@supabase/supabase-js"
import { articleMatchesQuery, exampleMatchesAccount } from "@/lib/assistant/knowledge"
import { sellableFromAvailability } from "@/lib/assistant/availability"
import { answeredPackageFaqs, parsePackageFaqs } from "@/lib/catalog/package-faqs"
import { parseIncludes } from "@/lib/assistant/completeness"
import { loadNativePackageAvailability } from "@/lib/inventory/ledger"
import { ENQUIRY_PIPELINE_STAGES } from "@/lib/crm/deal-pipeline"
import type { AssistantToolTrace } from "@/lib/assistant/types"

type Admin = SupabaseClient

export const ASSISTANT_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "search_packages",
      description: "Find sellable packages by event or product name.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_package_details",
      description: "Load description, inclusions, FAQs, brochure, and stock for one package.",
      parameters: {
        type: "object",
        properties: { package_id: { type: "string" } },
        required: ["package_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_stock",
      description: "Canonical sellable quantity for one or more packages.",
      parameters: {
        type: "object",
        properties: { package_ids: { type: "array", items: { type: "string" } } },
        required: ["package_ids"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_client_and_deal",
      description: "Load the linked CRM account, contact, open enquiry, and priced lines.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_knowledge",
      description: "Search company FAQs and approved reply examples. Never use guest-guide on-ground contacts.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
]

export type AssistantToolContext = {
  admin: Admin
  accountId: string | null
  contactId: string | null
  dealId: string | null
  allowPublishedTradePrices: boolean
}

export type AssistantToolFacts = {
  packageIds: string[]
  packageResolution: "none" | "unique" | "ambiguous"
  stockStatus: "in_stock" | "out" | "unknown" | "na"
  toolFailed: boolean
  factsMissing: boolean
  dealHasPackage: boolean
  dealHasQuantity: boolean
  dealHasPricedLines: boolean
  portalCapable: boolean
}

export function emptyToolFacts(): AssistantToolFacts {
  return {
    packageIds: [],
    packageResolution: "none",
    stockStatus: "na",
    toolFailed: false,
    factsMissing: false,
    dealHasPackage: false,
    dealHasQuantity: false,
    dealHasPricedLines: false,
    portalCapable: false,
  }
}

function mergeFacts(base: AssistantToolFacts, patch: Partial<AssistantToolFacts>): AssistantToolFacts {
  const packageIds = patch.packageIds ? [...new Set([...base.packageIds, ...patch.packageIds])] : base.packageIds
  let packageResolution = patch.packageResolution ?? base.packageResolution
  if (packageIds.length > 1) packageResolution = "ambiguous"
  else if (packageIds.length === 1) packageResolution = "unique"
  return { ...base, ...patch, packageIds, packageResolution }
}

async function searchPackages(admin: Admin, query: string) {
  const needle = query.trim()
  if (!needle) return { packages: [] as Array<Record<string, unknown>>, facts: { packageResolution: "none" as const } }
  const { data: packages, error } = await admin
    .from("packages")
    .select("id, name, race_id, duration, is_enquiry, sell_on_trade_portal, is_hidden, shell_parent_package_id, races(name, event_date, season)")
    .eq("is_hidden", false)
    .is("shell_parent_package_id", null)
    .ilike("name", `%${needle}%`)
    .limit(12)
  if (error) throw new Error(error.message)
  let rows = packages ?? []
  if (rows.length === 0) {
    const { data: races } = await admin.from("races").select("id, name").ilike("name", `%${needle}%`).limit(8)
    const raceIds = (races ?? []).map((row) => String(row.id))
    if (raceIds.length > 0) {
      const { data: byRace, error: raceError } = await admin
        .from("packages")
        .select("id, name, race_id, duration, is_enquiry, sell_on_trade_portal, is_hidden, shell_parent_package_id, races(name, event_date, season)")
        .eq("is_hidden", false)
        .is("shell_parent_package_id", null)
        .in("race_id", raceIds)
        .limit(12)
      if (raceError) throw new Error(raceError.message)
      rows = byRace ?? []
    }
  }
  const mapped = rows.map((row) => {
    const race = Array.isArray(row.races) ? row.races[0] : row.races
    return {
      package_id: row.id,
      name: row.name,
      event: race && typeof race === "object" ? (race as { name?: string }).name ?? null : null,
      duration: row.duration,
      enquiry_only: Boolean(row.is_enquiry),
      portal: Boolean(row.sell_on_trade_portal) && !row.is_enquiry,
    }
  })
  return {
    packages: mapped,
    facts: {
      packageIds: mapped.map((row) => String(row.package_id)),
      packageResolution: mapped.length === 1 ? ("unique" as const) : mapped.length > 1 ? ("ambiguous" as const) : ("none" as const),
    },
  }
}

async function getPackageDetails(ctx: AssistantToolContext, packageId: string) {
  const { data, error } = await ctx.admin
    .from("packages")
    .select(
      "id, name, description, includes, faqs, brochure_url, image, is_enquiry, sell_on_trade_portal, trade_price, currency, duration, races(name, event_date, circuit, location)",
    )
    .eq("id", packageId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { error: "Package not found.", facts: { factsMissing: true } }
  const stockRows = await loadNativePackageAvailability(ctx.admin, [packageId])
  const stock = stockRows[0] ?? null
  const sellable = stock ? sellableFromAvailability(stock) : null
  const race = Array.isArray(data.races) ? data.races[0] : data.races
  const faqs = answeredPackageFaqs(parsePackageFaqs(data.faqs)).map((faq) => ({
    question: faq.question,
    answer: faq.answer,
  }))
  return {
    package_id: data.id,
    name: data.name,
    event: race && typeof race === "object" ? race : null,
    duration: data.duration,
    description: String(data.description ?? "").trim(),
    includes: parseIncludes(data.includes),
    faqs,
    brochure_url: data.brochure_url,
    enquiry_only: Boolean(data.is_enquiry),
    portal: Boolean(data.sell_on_trade_portal) && !data.is_enquiry,
    trade_price: ctx.allowPublishedTradePrices ? data.trade_price : null,
    currency: data.currency,
    sellable,
    stock_known: stock != null,
    facts: {
      packageIds: [String(data.id)],
      packageResolution: "unique" as const,
      stockStatus:
        stock == null ? ("unknown" as const) : sellable && sellable > 0 ? ("in_stock" as const) : ("out" as const),
      portalCapable: Boolean(data.sell_on_trade_portal) && !data.is_enquiry,
    },
  }
}

async function getStock(admin: Admin, packageIds: string[]) {
  const ids = packageIds.map((id) => id.trim()).filter(Boolean).slice(0, 20)
  if (ids.length === 0) return { stock: [], facts: { stockStatus: "na" as const } }
  const rows = await loadNativePackageAvailability(admin, ids)
  const stock = ids.map((id) => {
    const row = rows.find((item) => item.package_id === id)
    if (!row) return { package_id: id, sellable: null, known: false }
    return { package_id: id, name: row.name, sellable: sellableFromAvailability(row), known: true }
  })
  const known = stock.filter((row) => row.known)
  const anyOut = known.some((row) => (row.sellable ?? 0) <= 0)
  const allIn = known.length > 0 && known.every((row) => (row.sellable ?? 0) > 0)
  return {
    stock,
    facts: {
      packageIds: ids,
      stockStatus: known.length === 0 ? ("unknown" as const) : anyOut ? ("out" as const) : allIn ? ("in_stock" as const) : ("unknown" as const),
      factsMissing: known.length === 0,
    },
  }
}

async function getClientAndDeal(ctx: AssistantToolContext) {
  const facts: Partial<AssistantToolFacts> = {}
  let account: Record<string, unknown> | null = null
  let contact: Record<string, unknown> | null = null
  if (ctx.accountId) {
    const { data, error } = await ctx.admin
      .from("crm_accounts")
      .select("id, name, email, phone, notes, portal_profile_id")
      .eq("id", ctx.accountId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    account = data
    facts.portalCapable = Boolean(data?.portal_profile_id)
  }
  if (ctx.contactId) {
    const { data, error } = await ctx.admin
      .from("crm_contacts")
      .select("id, full_name, email, phone, notes")
      .eq("id", ctx.contactId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    contact = data
  }
  let deal: Record<string, unknown> | null = null
  let lines: Array<Record<string, unknown>> = []
  if (ctx.dealId) {
    const { data, error } = await ctx.admin
      .from("deals")
      .select("id, reference, stage, enquiry_stage, source, currency, total_amount, notes, race_id")
      .eq("id", ctx.dealId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    deal = data
    const { data: lineRows, error: lineError } = await ctx.admin
      .from("deal_line_items")
      .select("id, package_id, quantity, unit_sale_price, currency, packages(name)")
      .eq("deal_id", ctx.dealId)
      .order("sort_order")
    if (lineError) throw new Error(lineError.message)
    lines = (lineRows ?? []).map((line) => {
      const pkg = Array.isArray(line.packages) ? line.packages[0] : line.packages
      return {
        package_id: line.package_id,
        name: pkg && typeof pkg === "object" ? (pkg as { name?: string }).name : null,
        quantity: line.quantity,
        unit_sale_price: line.unit_sale_price,
        currency: line.currency,
      }
    })
    facts.dealHasPackage = lines.some((line) => Boolean(line.package_id))
    facts.dealHasQuantity = lines.some((line) => Number(line.quantity) > 0)
    facts.dealHasPricedLines = lines.some((line) => Number(line.unit_sale_price) > 0)
    facts.packageIds = lines.map((line) => String(line.package_id ?? "")).filter(Boolean)
  }
  return { account, contact, deal, lines, open_enquiry: deal ? ENQUIRY_PIPELINE_STAGES.includes(String(deal.stage) as (typeof ENQUIRY_PIPELINE_STAGES)[number]) : false, facts }
}

async function searchKnowledge(ctx: AssistantToolContext, query: string) {
  const { data: articles, error } = await ctx.admin
    .from("knowledge_articles")
    .select("slug, title, body, category")
    .eq("active", true)
    .limit(40)
  if (error) throw new Error(error.message)
  const matchedArticles = (articles ?? [])
    .filter((row) => articleMatchesQuery(String(row.title), String(row.body), query))
    .slice(0, 6)
    .map((row) => ({ title: row.title, body: row.body, category: row.category }))
  const { data: examples, error: exampleError } = await ctx.admin
    .from("knowledge_examples")
    .select("question, answer, account_id, package_id, source")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(80)
  if (exampleError) throw new Error(exampleError.message)
  const matchedExamples = (examples ?? [])
    .filter((row) => exampleMatchesAccount(row.account_id ? String(row.account_id) : null, ctx.accountId))
    .filter((row) => articleMatchesQuery(String(row.question ?? ""), String(row.answer), query) || !query.trim())
    .slice(0, 8)
    .map((row) => ({ question: row.question, answer: row.answer, source: row.source }))
  return { articles: matchedArticles, examples: matchedExamples }
}

export async function executeAssistantTool(
  ctx: AssistantToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<{ result: unknown; facts: Partial<AssistantToolFacts> }> {
  switch (name) {
    case "search_packages": {
      const found = await searchPackages(ctx.admin, String(args.query ?? ""))
      return { result: { packages: found.packages }, facts: found.facts }
    }
    case "get_package_details": {
      const details = await getPackageDetails(ctx, String(args.package_id ?? ""))
      const { facts, ...result } = details
      return { result, facts }
    }
    case "get_stock": {
      const ids = Array.isArray(args.package_ids) ? args.package_ids.map((id) => String(id)) : []
      const stock = await getStock(ctx.admin, ids)
      return { result: { stock: stock.stock }, facts: stock.facts }
    }
    case "get_client_and_deal": {
      const loaded = await getClientAndDeal(ctx)
      const { facts, ...result } = loaded
      return { result, facts }
    }
    case "search_knowledge": {
      const knowledge = await searchKnowledge(ctx, String(args.query ?? ""))
      return { result: knowledge, facts: {} }
    }
    default:
      return { result: { error: `Unknown tool ${name}` }, facts: { toolFailed: true } }
  }
}

export async function runAssistantTools(
  ctx: AssistantToolContext,
  calls: Array<{ name: string; arguments: Record<string, unknown> }>,
): Promise<{ traces: AssistantToolTrace[]; facts: AssistantToolFacts }> {
  let facts = emptyToolFacts()
  const traces: AssistantToolTrace[] = []
  for (const call of calls) {
    try {
      const executed = await executeAssistantTool(ctx, call.name, call.arguments)
      facts = mergeFacts(facts, executed.facts)
      traces.push({ name: call.name, arguments: call.arguments, result: executed.result })
    } catch (error) {
      facts = mergeFacts(facts, { toolFailed: true })
      traces.push({
        name: call.name,
        arguments: call.arguments,
        result: { error: error instanceof Error ? error.message : "Tool failed." },
      })
    }
  }
  return { traces, facts }
}

export { mergeFacts }
