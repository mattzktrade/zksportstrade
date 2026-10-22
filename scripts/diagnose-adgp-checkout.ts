/**
 * Read-only: mapped ADGP prices vs trade/retail, recent website holds/orders/deals.
 */
import { config } from "dotenv"
import { resolve } from "path"
import { createClient } from "@supabase/supabase-js"
import { retailPriceFromTrade } from "../lib/integrations/retail-price"

config({ path: resolve(process.cwd(), ".env.local") })

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    process.exit(1)
  }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: maps, error: mapError } = await sb
    .from("adgp_package_map")
    .select("slug, day, package_id, enabled")
    .eq("enabled", true)
    .order("slug")
  if (mapError) throw new Error(mapError.message)

  const ids = [...new Set((maps ?? []).map((row) => row.package_id))]
  const { data: packages, error: pkgError } = await sb
    .from("packages")
    .select("id, name, trade_price, wix_retail_price, retail_price_multiplier, currency")
    .in("id", ids)
  if (pkgError) throw new Error(pkgError.message)
  const byId = new Map((packages ?? []).map((row) => [row.id, row]))

  console.log("=== Mapped ADGP prices ===")
  for (const map of maps ?? []) {
    const pkg = byId.get(map.package_id)
    const retail = retailPriceFromTrade(pkg?.trade_price, pkg?.retail_price_multiplier, pkg?.wix_retail_price)
    console.log(
      [
        map.slug,
        map.day,
        map.package_id,
        `trade=${pkg?.trade_price ?? ""}`,
        `wix=${pkg?.wix_retail_price ?? ""}`,
        `mult=${pkg?.retail_price_multiplier ?? ""}`,
        `retail=${retail ?? ""}`,
      ].join(" | "),
    )
  }

  const { data: holds } = await sb
    .from("website_checkout_holds")
    .select("id, package_id, slug, day, guests, unit_price, currency, status, stripe_session_id, expires_at, created_at")
    .order("created_at", { ascending: false })
    .limit(15)
  console.log("\n=== Recent website holds ===")
  for (const row of holds ?? []) {
    console.log(
      [
        row.created_at,
        row.status,
        row.slug,
        row.day,
        `g=${row.guests}`,
        `price=${row.unit_price}`,
        row.stripe_session_id,
        row.id,
      ].join(" | "),
    )
  }

  const { data: orders } = await sb
    .from("orders")
    .select("id, reference, channel, external_order_id, guests, unit_price, total_amount, client_email, created_at, deal_id")
    .eq("channel", "website")
    .order("created_at", { ascending: false })
    .limit(10)
  console.log("\n=== Website orders ===")
  console.log(orders?.length ? orders : "none")

  const { data: deals } = await sb
    .from("deals")
    .select("id, reference, source, stage, owner_profile_id, total_amount, created_at")
    .eq("source", "website")
    .order("created_at", { ascending: false })
    .limit(10)
  console.log("\n=== Website deals ===")
  console.log(deals?.length ? deals : "none")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
