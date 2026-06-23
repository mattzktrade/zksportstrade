import { config } from "dotenv"
import { resolve } from "path"
import { createClient } from "@supabase/supabase-js"

async function main() {
  config({ path: resolve(process.cwd(), ".env.local") })
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const ref = process.argv[2] ?? "ZK-2026-0764113B"

  const { data: order } = await admin
    .from("orders")
    .select("id, reference, package_id, salesforce_sync_status, salesforce_sync_error, created_at")
    .eq("reference", ref)
    .maybeSingle()
  console.log("Order:", order)

  if (!order) return

  const { data: inv } = await admin
    .from("invoices")
    .select("id, status, xero_sync_status, xero_sync_error, xero_invoice_id, xero_invoice_number")
    .eq("order_id", order.id)
    .maybeSingle()
  console.log("Invoice:", inv)

  const { data: outbox } = await admin
    .from("integration_outbox")
    .select("id, event_type, status, last_error, attempts, created_at, processed_at")
    .filter("payload->>order_id", "eq", order.id)
    .order("created_at", { ascending: false })
  console.log("Outbox for order:", outbox)

  const { data: pending } = await admin
    .from("integration_outbox")
    .select("id, event_type, status, last_error, payload")
    .in("status", ["pending", "failed", "processing"])
    .order("created_at", { ascending: true })
    .limit(15)
  console.log("Pending/failed outbox (sample):", pending)

  const { data: pkg } = await admin
    .from("packages")
    .select("id, name, product_code, trade_price")
    .eq("id", order.package_id)
    .maybeSingle()
  console.log("Package:", pkg)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
