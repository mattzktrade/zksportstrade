import { config } from "dotenv"
import { resolve } from "path"
import { createClient } from "@supabase/supabase-js"
import { xeroRequest } from "../lib/integrations/xero/client"

async function main() {
  config({ path: resolve(process.cwd(), ".env.local") })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const admin = createClient(url, key)

  const { data: invoices } = await admin
    .from("invoices")
    .select("id, order_id, xero_sync_status, xero_sync_error, status, reference")
    .order("created_at", { ascending: false })
    .limit(5)

  console.log("Recent invoices:", JSON.stringify(invoices, null, 2))

  const failed = invoices?.find((i) => i.xero_sync_status === "failed")
  if (!failed?.order_id) {
    console.log("No failed invoice found.")
    return
  }

  const { data: order } = await admin.from("orders").select("*").eq("id", failed.order_id).maybeSingle()
  console.log("Failed order:", order?.reference, order?.currency, order?.unit_price, order?.guests)

  try {
    const taxRates = await xeroRequest<{ TaxRates?: Array<{ Name?: string; TaxType?: string; Status?: string }> }>(
      "GET",
      "/api.xro/2.0/TaxRates",
    )
    console.log(
      "Tax rates:",
      (taxRates.TaxRates ?? []).map((t) => ({ name: t.Name, type: t.TaxType, status: t.Status })),
    )
  } catch (e) {
    console.error("TaxRates error:", e)
  }

  try {
    const accounts = await xeroRequest<{ Accounts?: Array<{ Code?: string; Name?: string; Type?: string }> }>(
      "GET",
      '/api.xro/2.0/Accounts?where=Type=="REVENUE"',
    )
    console.log(
      "Revenue accounts:",
      (accounts.Accounts ?? []).slice(0, 10).map((a) => ({ code: a.Code, name: a.Name })),
    )
  } catch (e) {
    console.error("Accounts error:", e)
  }

  const { createXeroInvoiceForOrder } = await import("../lib/integrations/xero/invoices")
  try {
    const result = await createXeroInvoiceForOrder(failed.order_id)
    console.log("Retry success:", result)
  } catch (e) {
    console.error("Retry failed:", e)
    if (e && typeof e === "object" && "body" in e) {
      console.error("Body:", JSON.stringify((e as { body: unknown }).body, null, 2))
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
