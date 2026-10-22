import { config } from "dotenv"
import { resolve } from "node:path"

config({ path: resolve(process.cwd(), ".env.local") })

import { commitAdgpOrder } from "../lib/integrations/adgp/orders"
import { createAdminClient } from "../lib/supabase/admin"

const sessionId = process.argv[2]?.trim() || ""

async function main() {
  if (!sessionId) {
    throw new Error("Pass the Stripe checkout session id.")
  }
  const admin = createAdminClient()
  if (!admin) throw new Error("Service role is not configured.")

  const { data: existing } = await admin
    .from("orders")
    .select("id, reference")
    .eq("external_order_id", sessionId)
    .maybeSingle()
  if (existing?.id) {
    console.log("already committed", existing.reference)
    return
  }

  const { data: hold } = await admin
    .from("website_checkout_holds")
    .select("id, package_id, guests, unit_price, currency, status, stripe_session_id")
    .eq("stripe_session_id", sessionId)
    .maybeSingle()
  if (!hold) throw new Error("No website hold for that Stripe session.")

  const secret = process.env.STRIPE_SECRET_KEY?.trim() || process.env.ADGP_STRIPE_SECRET_KEY?.trim() || ""
  let buyer = {
    name: process.env.RECOVER_NAME?.trim() || "",
    email: process.env.RECOVER_EMAIL?.trim() || "",
    phone: process.env.RECOVER_PHONE?.trim() || "",
  }
  let billing = { line1: "", line2: "", city: "", postcode: "", country: "" }

  if (secret) {
    const Stripe = (await import("stripe")).default
    const stripe = new Stripe(secret)
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["customer_details"] })
    if (session.payment_status !== "paid") {
      throw new Error(`Stripe session is ${session.payment_status}, not paid.`)
    }
    const meta = session.metadata ?? {}
    buyer = {
      name: meta.fullName || session.customer_details?.name || buyer.name,
      email: session.customer_details?.email || session.customer_email || buyer.email,
      phone: meta.phone || session.customer_details?.phone || buyer.phone,
    }
    billing = {
      line1: session.customer_details?.address?.line1 ?? "",
      line2: session.customer_details?.address?.line2 ?? "",
      city: session.customer_details?.address?.city ?? "",
      postcode: session.customer_details?.address?.postal_code ?? "",
      country: session.customer_details?.address?.country ?? "",
    }
  } else if (buyer.email) {
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, email, mobile")
      .ilike("email", buyer.email)
      .maybeSingle()
    buyer = {
      name: buyer.name || profile?.full_name || "",
      email: buyer.email,
      phone: buyer.phone || profile?.mobile || "",
    }
  }

  if (!buyer.name || !buyer.email) {
    throw new Error("Need Stripe or RECOVER_NAME and RECOVER_EMAIL to commit this paid session.")
  }

  const result = await commitAdgpOrder({
    holdId: String(hold.id),
    stripeSessionId: sessionId,
    packageId: String(hold.package_id),
    guests: Number(hold.guests),
    unitPrice: Number(hold.unit_price),
    currency: String(hold.currency || "USD"),
    buyer,
    billing,
  })
  console.log(result)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
