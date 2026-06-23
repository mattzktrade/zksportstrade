/**
 * Simulate a paid Wix order — no real Wix checkout required.
 *
 * Usage:
 *   npx tsx scripts/wix-webhook-test.ts barcelona-f1-experiences-paddock-club-2026
 *   npx tsx scripts/wix-webhook-test.ts barcelona-f1-experiences-paddock-club-2026 --prepare
 *
 * --prepare  Ensures sell_on_wix + channel_listings (copies Wix IDs from another mapped package if needed).
 *            Removes other portal mappings for the same Wix product so the webhook resolves unambiguously.
 *
 * Requires: dev server running, .env.local with WIX_WEBHOOK_SECRET + WIX_AGENT_PROFILE_ID
 */
import { config } from "dotenv"
import { resolve } from "path"
import { createClient } from "@supabase/supabase-js"

config({ path: resolve(process.cwd(), ".env.local") })

const DEFAULT_PACKAGE = "barcelona-f1-experiences-paddock-club-2026"
import { WIX_DEFAULT_VARIANT_ID } from "../lib/integrations/wix/constants"

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  const prepare = process.argv.includes("--prepare")
  const packageId = args[0]?.trim() || DEFAULT_PACKAGE
  const orderId = `test-wix-${Date.now()}`

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const secret = process.env.WIX_WEBHOOK_SECRET
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000"

  if (!secret) {
    console.error("WIX_WEBHOOK_SECRET missing in .env.local")
    process.exit(1)
  }
  if (!url || !key) {
    console.error("Supabase env missing")
    process.exit(1)
  }

  const sb = createClient(url, key)

  const { data: pkg } = await sb
    .from("packages")
    .select("id, name, event_date, sell_on_wix")
    .eq("id", packageId)
    .maybeSingle()

  if (!pkg) {
    console.error(`Package not found: ${packageId}`)
    process.exit(1)
  }

  console.log("Package:", pkg.name, `(${pkg.id})`, "event:", pkg.event_date)

  let { data: listing } = await sb
    .from("channel_listings")
    .select("id, external_id, external_variant_id")
    .eq("package_id", packageId)
    .eq("channel", "wix")
    .maybeSingle()

  if (!listing && prepare) {
    const { data: donor } = await sb
      .from("channel_listings")
      .select("external_id, external_variant_id")
      .eq("channel", "wix")
      .limit(1)
      .maybeSingle()

    if (!donor?.external_id) {
      console.error("No Wix mapping to copy — map a product in Admin → Catalog first.")
      process.exit(1)
    }

    await sb.from("channel_listings").delete().eq("channel", "wix").eq("external_id", donor.external_id)

    const { error: insErr } = await sb.from("channel_listings").insert({
      package_id: packageId,
      channel: "wix",
      external_id: donor.external_id,
      external_variant_id: donor.external_variant_id ?? WIX_DEFAULT_VARIANT_ID,
    })
    if (insErr) {
      console.error("Failed to create test mapping:", insErr.message)
      process.exit(1)
    }

    await sb.from("packages").update({ sell_on_wix: true }).eq("id", packageId)
    pkg.sell_on_wix = true
    listing = {
      id: "new",
      external_id: donor.external_id,
      external_variant_id: donor.external_variant_id,
    }
    console.log("Prepared test mapping (removed other mappings for this Wix product).")
  }

  if (!listing?.external_id) {
    console.error(
      "No Wix mapping for this package. Enable Wix website + add Product/Variant IDs in Admin, or re-run with --prepare.",
    )
    process.exit(1)
  }

  if (!pkg.sell_on_wix) {
    console.error("sell_on_wix is false — enable Wix website on the package integration panel.")
    process.exit(1)
  }

  const body = {
    orderId,
    productId: listing.external_id,
    variantId: listing.external_variant_id ?? WIX_DEFAULT_VARIANT_ID,
    quantity: 1,
    buyer: {
      name: "Webhook Test Buyer",
      email: `wix-test+${Date.now()}@example.com`,
    },
  }

  const endpoint = `${base.replace(/\/$/, "")}/api/webhooks/wix-order`
  console.log("\nPOST", endpoint)
  console.log("orderId:", orderId)

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wix-webhook-secret": secret,
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  console.log("\nHTTP", res.status)
  console.log(text)

  if (!res.ok) process.exit(1)
  console.log("\nCheck Admin → Orders for the new ZK-2026-… row (channel Wix).")
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
