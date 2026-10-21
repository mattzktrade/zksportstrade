/**
 * Read-only audit of Abu Dhabi 2026 SKUs and staff profiles for ADGP checkout.
 * Usage: npx tsx scripts/audit-adgp-packages.ts
 */
import { config } from "dotenv"
import { resolve } from "path"
import { createClient } from "@supabase/supabase-js"

config({ path: resolve(process.cwd(), ".env.local") })

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    process.exit(1)
  }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: packages, error } = await sb
    .from("packages")
    .select(
      "id, name, duration, trade_price, wix_retail_price, retail_price_multiplier, currency, is_enquiry, is_hidden, inventory_group_id, race_id",
    )
    .eq("race_id", "abudhabi-2026")
    .order("name")

  if (error) throw new Error(error.message)

  console.log("=== Abu Dhabi 2026 packages ===")
  for (const row of packages ?? []) {
    console.log(
      [
        row.id,
        row.name,
        row.duration,
        `trade=${row.trade_price}`,
        `retail=${row.wix_retail_price ?? ""}`,
        `enquiry=${row.is_enquiry}`,
        `hidden=${row.is_hidden}`,
        `group=${row.inventory_group_id ?? ""}`,
      ].join(" | "),
    )
  }

  const { data: profiles, error: profileError } = await sb
    .from("profiles")
    .select("id, email, full_name, role, approval_status")
    .or("email.ilike.matt@zk-sports.com,email.ilike.%wix%,email.ilike.%website%,email.ilike.%adgp%")
    .order("email")
  if (profileError) throw new Error(profileError.message)

  console.log("\n=== Relevant profiles ===")
  for (const row of profiles ?? []) {
    console.log([row.id, row.email, row.full_name, row.role, row.approval_status].join(" | "))
  }

  const { data: matt } = await sb
    .from("profiles")
    .select("id, email, role, approval_status")
    .ilike("email", "matt@zk-sports.com")
    .maybeSingle()
  console.log("\nMatt profile:", matt)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
