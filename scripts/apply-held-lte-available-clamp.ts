/** Apply clamp so qty_available is never set below qty_held (held_lte_available). */
import { config } from "dotenv"
import { resolve } from "node:path"
import { readFileSync } from "node:fs"
config({ path: resolve(process.cwd(), ".env.local") })

const migrationFile = "20260709160000_clamp_inventory_available_gte_held.sql"
const sql = readFileSync(resolve(process.cwd(), `supabase/migrations/${migrationFile}`), "utf8")

async function main() {
  const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
  if (!url) {
    console.error("Set SUPABASE_DB_URL or DATABASE_URL in .env.local to apply migrations.")
    console.error("\nOr paste this SQL in Supabase SQL editor:\n")
    console.log(sql)
    process.exit(1)
  }
  const { default: pg } = await import("pg")
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query(sql)
    console.log("Applied:", migrationFile)
  } finally {
    await client.end()
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
