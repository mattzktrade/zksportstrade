import { config } from "dotenv"
import { resolve } from "node:path"
import { createClient } from "@supabase/supabase-js"
import { reconcilePurchaseLedgers } from "../lib/inventory/reconcile-purchase-ledger"

config({ path: resolve(process.cwd(), ".env.local") })

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const result = await reconcilePurchaseLedgers(admin)
  console.log(result)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
