import type { SupabaseClient } from "@supabase/supabase-js"
import { parseIncludes } from "@/lib/assistant/completeness"
import { sellableFromAvailability } from "@/lib/assistant/availability"
import { BOOKING_TERMS } from "@/lib/booking-forms/template"
import { answeredPackageFaqs, parsePackageFaqs } from "@/lib/catalog/package-faqs"
import { loadNativePackageAvailability } from "@/lib/inventory/ledger"
import { McpToolError } from "@/lib/mcp/types"
import { mcpAbsoluteUrl, mcpMediaUrl } from "@/lib/mcp/urls"
import { likeContains } from "@/lib/admin/ranked-search"

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function inclusionsSummary(includes: string[]): string {
  if (includes.length === 0) return ""
  if (includes.length <= 3) return includes.join("; ")
  return `${includes.slice(0, 3).join("; ")}; +${includes.length - 3} more`
}

type PackageListRow = {
  id: string
  name: string
  race_id: string | null
  trade_price: number | string | null
  currency: string | null
  includes: unknown
  is_hidden: boolean | null
  is_enquiry: boolean | null
  shell_parent_package_id: string | null
  races:
    | { name?: string | null; event_date?: string | null; circuit?: string | null; location?: string | null }
    | Array<{ name?: string | null; event_date?: string | null; circuit?: string | null; location?: string | null }>
    | null
}

export async function mcpListProducts(
  admin: SupabaseClient,
  input: { race?: string; availableOnly?: boolean },
): Promise<unknown> {
  let query = admin
    .from("packages")
    .select(
      "id, name, race_id, trade_price, currency, includes, is_hidden, is_enquiry, shell_parent_package_id, races(name, event_date, circuit, location)",
    )
    .eq("is_hidden", false)
    .is("shell_parent_package_id", null)
    .order("name")
    .limit(80)

  const race = input.race?.trim()
  if (race) {
    const { data: byId } = await admin.from("races").select("id").eq("id", race).maybeSingle()
    const raceIds: string[] = []
    if (byId?.id) {
      raceIds.push(String(byId.id))
    } else {
      const { data: races, error: raceError } = await admin
        .from("races")
        .select("id")
        .ilike("name", likeContains(race))
        .limit(20)
      if (raceError) throw new McpToolError(raceError.message)
      for (const row of races ?? []) raceIds.push(String(row.id))
    }
    if (raceIds.length === 0) return { products: [] }
    query = query.in("race_id", raceIds)
  }

  const { data, error } = await query
  if (error) throw new McpToolError(error.message)
  const rows = (data ?? []) as PackageListRow[]
  const ids = rows.map((row) => String(row.id))
  const stock = ids.length ? await loadNativePackageAvailability(admin, ids) : []
  const sellableById = new Map(stock.map((row) => [row.package_id, sellableFromAvailability(row)]))

  const products = rows
    .map((row) => {
      const event = one(row.races)
      const quantity = sellableById.get(String(row.id)) ?? 0
      const includes = parseIncludes(row.includes)
      return {
        id: String(row.id),
        race: event?.name ?? null,
        venue: [event?.circuit, event?.location].filter(Boolean).join(", ") || null,
        date: event?.event_date ?? null,
        package_name: row.name,
        price: row.trade_price == null ? null : Number(row.trade_price),
        currency: row.currency ?? "USD",
        quantity_available: quantity,
        inclusions_summary: inclusionsSummary(includes),
        enquiry_only: Boolean(row.is_enquiry),
      }
    })
    .filter((row) => (input.availableOnly ? row.quantity_available > 0 : true))

  return { products }
}

type PackageDetailRow = {
  id: string
  name: string
  description: string | null
  includes: unknown
  faqs: unknown
  brochure_url: string | null
  zk_brochure_url?: string | null
  guest_guide_url?: string | null
  image: string | null
  gallery_images: unknown
  track_map: string | null
  trade_price: number | string | null
  currency: string | null
  duration: string | null
  is_enquiry: boolean | null
  sell_on_trade_portal: boolean | null
  races:
    | {
        name?: string | null
        event_date?: string | null
        date_range?: string | null
        circuit?: string | null
        location?: string | null
        country?: string | null
      }
    | Array<{
        name?: string | null
        event_date?: string | null
        date_range?: string | null
        circuit?: string | null
        location?: string | null
        country?: string | null
      }>
    | null
}

function galleryUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    const url = mcpMediaUrl(typeof item === "string" ? item : null)
    if (url) out.push(url)
  }
  return out
}

export async function mcpGetProduct(admin: SupabaseClient, id: string): Promise<unknown> {
  const packageId = id.trim()
  if (!packageId) throw new McpToolError("Product id is required.")
  const { data, error } = await admin
    .from("packages")
    .select(
      "id, name, description, includes, faqs, brochure_url, zk_brochure_url, guest_guide_url, image, gallery_images, track_map, trade_price, currency, duration, is_enquiry, sell_on_trade_portal, races(name, event_date, date_range, circuit, location, country)",
    )
    .eq("id", packageId)
    .maybeSingle()
  if (error) throw new McpToolError(error.message)
  if (!data) throw new McpToolError(`Product not found: ${packageId}.`)
  const row = data as PackageDetailRow
  const event = one(row.races)
  const stock = await loadNativePackageAvailability(admin, [packageId])
  const sellable = stock[0] ? sellableFromAvailability(stock[0]) : 0
  const faqs = answeredPackageFaqs(parsePackageFaqs(row.faqs)).map((faq) => ({
    id: faq.id,
    question: faq.question,
    answer: faq.answer,
  }))
  const image = mcpMediaUrl(row.image)
  const gallery = galleryUrls(row.gallery_images)
  const terms = BOOKING_TERMS.map((section) => ({
    heading: section.heading,
    paragraphs: section.paragraphs,
  }))

  return {
    id: String(row.id),
    name: row.name,
    race: event?.name ?? null,
    venue: event?.circuit ?? null,
    location: event?.location ?? null,
    country: event?.country ?? null,
    date: event?.event_date ?? null,
    date_range: event?.date_range ?? null,
    duration: row.duration,
    description: String(row.description ?? "").trim() || null,
    inclusions: parseIncludes(row.includes),
    faqs,
    terms_and_conditions: terms,
    price: row.trade_price == null ? null : Number(row.trade_price),
    currency: row.currency ?? "USD",
    quantity_available: sellable,
    enquiry_only: Boolean(row.is_enquiry),
    trade_portal: Boolean(row.sell_on_trade_portal) && !row.is_enquiry,
    media: {
      image,
      gallery,
      track_map: mcpMediaUrl(row.track_map),
    },
    brochure_urls: {
      white_label: mcpAbsoluteUrl(row.brochure_url),
      zk: mcpAbsoluteUrl(row.zk_brochure_url ?? null),
      guest_guide: mcpAbsoluteUrl(row.guest_guide_url ?? null),
    },
  }
}
