/**
 * Apply the linked-group bulk inventory sync migration to the remote database.
 * Run once: npx tsx scripts/apply-linked-bulk-sync-migration.ts
 */
import { config } from "dotenv"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import pg from "pg"

config({ path: resolve(process.cwd(), ".env.local") })

async function main() {
  const connectionString =
    process.env.SUPABASE_DB_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim()

  if (!connectionString) {
    console.error("Set SUPABASE_DB_URL or DATABASE_URL in .env.local")
    process.exit(1)
  }

  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260702150000_linked_group_bulk_inventory_sync.sql"),
    "utf8",
  )

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
    console.log("Migration applied: apply_linked_group_inventory_sync")
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
