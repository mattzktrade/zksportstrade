/**
 * Seeds races, packages, and inventory from lib/seed-data.ts into Supabase.
 * Requires SUPABASE_SERVICE_ROLE_KEY (service role bypasses RLS).
 *
 * Usage: `npm run seed:catalog` (loads `.env.local` via dotenv)
 */

import { config } from "dotenv"
import { resolve } from "path"
import { createClient } from "@supabase/supabase-js"
import { races2026, packages } from "../lib/seed-data"

config({ path: resolve(process.cwd(), ".env.local") })
config({ path: resolve(process.cwd(), ".env") })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function raceIdForPackage(pkg: (typeof packages)[0]): string | null {
  const race = races2026.find((r) => r.date === pkg.date)
  return race?.id ?? null
}

async function main() {
  console.log("Upserting races…")
  for (const r of races2026) {
    const { error } = await supabase.from("races").upsert(
      {
        id: r.id,
        name: r.name,
        short_name: r.shortName,
        location: r.location,
        country: r.country,
        country_code: r.countryCode,
        event_date: r.date,
        date_range: r.dateRange,
        image: r.image,
        season: 2026,
      },
      { onConflict: "id" },
    )
    if (error) throw error
  }

  console.log("Upserting packages…")
  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i]
    const raceId = raceIdForPackage(pkg)
    if (!raceId) {
      console.warn(`Skipping package ${pkg.id} — no race for date ${pkg.date}`)
      continue
    }

    const isEnquiry = typeof pkg.availability === "string"

    const { error } = await supabase.from("packages").upsert(
      {
        id: pkg.id,
        race_id: raceId,
        name: pkg.name,
        circuit: pkg.circuit,
        location: pkg.location,
        country: pkg.country,
        country_code: pkg.countryCode,
        event_date: pkg.date,
        date_range: pkg.dateRange,
        trade_price: pkg.price,
        currency: pkg.currency,
        total_capacity: pkg.totalCapacity,
        is_enquiry: isEnquiry,
        image: pkg.image,
        tier: pkg.tier,
        includes: pkg.includes,
        featured: pkg.featured ?? false,
        sort_order: i,
      },
      { onConflict: "id" },
    )
    if (error) throw error

    if (!isEnquiry) {
      const qty = pkg.availability as number
      const { error: invError } = await supabase.from("package_inventory").upsert(
        {
          package_id: pkg.id,
          qty_available: qty,
          qty_held: 0,
        },
        { onConflict: "package_id" },
      )
      if (invError) throw invError
    } else {
      await supabase.from("package_inventory").delete().eq("package_id", pkg.id)
    }
  }

  console.log("Done.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
