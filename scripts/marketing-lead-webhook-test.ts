/**
 * Simulate a Meta / agency marketing lead landing on Sales → Enquiries.
 *
 * Usage:
 *   npx tsx scripts/marketing-lead-webhook-test.ts
 *
 * Requires: dev server running, .env.local with MARKETING_LEAD_WEBHOOK_SECRET
 */
import { config } from "dotenv"
import { resolve } from "path"

config({ path: resolve(process.cwd(), ".env.local") })

async function main() {
  const secret = process.env.MARKETING_LEAD_WEBHOOK_SECRET
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000"
  if (!secret) {
    console.error("MARKETING_LEAD_WEBHOOK_SECRET missing in .env.local")
    process.exit(1)
  }

  const leadId = `test-meta-${Date.now()}`
  const body = {
    leadId,
    createdAt: new Date().toISOString(),
    campaign: { name: "Webhook test", formName: "Local smoke test" },
    contact: {
      fullName: "Marketing Webhook Test",
      email: `marketing-test+${Date.now()}@example.com`,
      phone: "+447900000000",
    },
    interest: { package: "Monaco GP Hospitality", quantity: 2, event: "Monaco GP" },
    answers: [{ question: "Notes", answer: "Created by marketing-lead-webhook-test.ts" }],
    consent: { marketingOptIn: true },
  }

  const endpoint = `${base.replace(/\/$/, "")}/api/webhooks/marketing-lead`
  console.log("POST", endpoint)
  console.log("leadId:", leadId)

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-secret": secret,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  console.log("\nHTTP", res.status)
  console.log(text)
  if (!res.ok) process.exit(1)

  const again = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-secret": secret,
    },
    body: JSON.stringify(body),
  })
  const againText = await again.text()
  console.log("\nDuplicate POST HTTP", again.status)
  console.log(againText)
  if (!again.ok) process.exit(1)
  if (!againText.includes('"duplicate":true') && !againText.includes('"duplicate": true')) {
    console.error("Expected duplicate: true on the second post")
    process.exit(1)
  }

  console.log("\nCheck Sales → Enquiries for a Marketing row with this email. Keep the agency spreadsheet as backup until production Zapier is pointed at https://zk-sports.trade/api/webhooks/marketing-lead")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
