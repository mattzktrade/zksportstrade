/** Apply linked bulk sync trigger fix (run once after pulling latest code). */
import { config } from "dotenv"
import { resolve } from "node:path"
import { readFileSync } from "node:fs"
config({ path: resolve(process.cwd(), ".env.local") })

const migrationFiles = [
  "20260702150000_linked_group_bulk_inventory_sync.sql",
  "20260702160000_linked_bulk_sync_disable_trigger.sql",
  "20260702170000_linked_inventory_reconcile_fix.sql",
  "20260702180000_drop_linked_reconcile_trigger.sql",
]

const sql = migrationFiles
  .map((name) =>
    readFileSync(resolve(process.cwd(), `supabase/migrations/${name}`), "utf8"),
  )
  .join("\n\n")

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
    console.log("Applied linked inventory migrations:", migrationFiles.join(", "))
  } finally {
    await client.end()
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
