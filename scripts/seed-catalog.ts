/**
 * Seeds races, packages, and inventory from lib/seed-data.ts into Supabase.
 * Also generates the next calendar year (2027) from 2026 so each circuit rolls forward when the prior season ends.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (service role bypasses RLS).
 *
 * Usage: `npm run seed:catalog` (loads `.env.local` via dotenv)
 */

import { config } from "dotenv"
import { resolve } from "path"
import { createClient } from "@supabase/supabase-js"
import { generateNextSeasonRaces, raceIdForPackageDate } from "../lib/catalog/generate-next-season-catalog"
import { bookableEventDateFrom } from "../lib/catalog/bookable-events"
import { seasonFromRaceId } from "../lib/catalog/season-rollover"
import { packages2027PaddockEnquire } from "../lib/seed-data/packages-2027-paddock"
import { races2026, packages as packages2026 } from "../lib/seed-data"
import type { Package, Race } from "../lib/types/catalog"

config({ path: resolve(process.cwd(), ".env.local") })
config({ path: resolve(process.cwd(), ".env") })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const NEXT_SELLING_YEAR = 2027

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function upsertRaces(races: Race[]) {
  for (const r of races) {
    const season = seasonFromRaceId(r.id) ?? 2026
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
        season,
      },
      { onConflict: "id" },
    )
    if (error) throw error
  }
}

function raceIdForPackage(pkg: Package, races: Race[]): string | null {
  return raceIdForPackageDate(pkg.date, races)
}

async function upsertPackages(packages: Package[], races: Race[], sortOffset: number) {
  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i]
    const raceId = pkg.raceId ?? raceIdForPackage(pkg, races)
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
        is_hidden: pkg.isHidden ?? false,
        image: pkg.image,
        tier: pkg.tier,
        includes: pkg.includes,
        featured: pkg.featured ?? false,
        sort_order: sortOffset + i,
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
}

async function main() {
  const races2027 = generateNextSeasonRaces(races2026, NEXT_SELLING_YEAR)
  const packages2027 = packages2027PaddockEnquire(races2027)

  console.log(`Upserting ${races2026.length} races (${seasonFromRaceId(races2026[0]?.id ?? "")} season)…`)
  await upsertRaces(races2026)

  console.log(`Upserting ${races2027.length} races (${NEXT_SELLING_YEAR} season)…`)
  await upsertRaces(races2027)

  console.log(`Upserting ${packages2026.length} packages (2026)…`)
  await upsertPackages(packages2026, races2026, 0)

  console.log(`Upserting ${packages2027.length} packages (${NEXT_SELLING_YEAR}, Paddock Club enquire only)…`)
  await upsertPackages(packages2027, races2027, packages2026.length)

  await pruneCatalogNotInSeed([...packages2026, ...packages2027])

  console.log("Done. 2026 live inventory applied; 2027 is one enquire-only Paddock Club per race.")
}

/** Remove upcoming packages not in seed (keeps past-event products). */
async function pruneCatalogNotInSeed(seeded: Package[]) {
  const keepIds = new Set(seeded.map((p) => p.id))
  const bookableFrom = bookableEventDateFrom()

  const { data: existing, error } = await supabase.from("packages").select("id, event_date")
  if (error) throw error
  if (!existing?.length) return

  const toDelete = existing.filter((p) => !keepIds.has(p.id) && p.event_date >= bookableFrom).map((p) => p.id)
  if (toDelete.length === 0) return

  console.log(`Removing ${toDelete.length} packages no longer on the live sheet…`)
  for (const id of toDelete) {
    await supabase.from("package_inventory").delete().eq("package_id", id)
    const { error: delErr } = await supabase.from("packages").delete().eq("id", id)
    if (delErr) console.warn(`Could not delete ${id}:`, delErr.message)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
