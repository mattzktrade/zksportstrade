import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { createHmac } from "crypto"
import { DEAL_SOURCE_LABELS, DEAL_SOURCES, dealSourceLabel } from "../lib/crm/deal-types"
import { inboundEnquirySource, resolvedEnquiryTemperature } from "../lib/crm/deal-pipeline"
import { MARKETING_LEAD_EXAMPLE_PAYLOAD } from "../lib/integrations/marketing-leads/contract"
import {
  formatMarketingLeadNotes,
  normalizeMarketingAlias,
  parseMarketingLeadWebhookBody,
} from "../lib/integrations/marketing-leads/parse"
import { verifyMarketingLeadWebhook } from "../lib/integrations/marketing-leads/verify"

const sql = readFileSync(
  new URL("../supabase/migrations/20260909120000_marketing_lead_ingest.sql", import.meta.url),
  "utf8",
)

describe("marketing deal source", () => {
  it("adds marketing as a first-class enquiry source", () => {
    assert.equal(DEAL_SOURCES.includes("marketing"), true)
    assert.equal(DEAL_SOURCE_LABELS.marketing, "Marketing")
    assert.equal(dealSourceLabel("marketing"), "Marketing")
    assert.equal(inboundEnquirySource("marketing"), true)
    assert.equal(
      resolvedEnquiryTemperature({ source: "marketing", enquiryStage: "new", temperature: "cold" }),
      "warm",
    )
  })
})

describe("marketing lead payload", () => {
  it("parses the documented nested contract", () => {
    const parsed = parseMarketingLeadWebhookBody(MARKETING_LEAD_EXAMPLE_PAYLOAD)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.payload.leadId, "meta-leadgen-id")
    assert.equal(parsed.payload.contact.fullName, "Jane Smith")
    assert.equal(parsed.payload.contact.email, "jane@example.com")
    assert.equal(parsed.payload.contact.phone, "+447900000000")
    assert.equal(parsed.payload.interest.package, "Monaco GP Hospitality")
    assert.equal(parsed.payload.interest.quantity, 4)
    assert.equal(parsed.payload.consent.marketingOptIn, true)
  })

  it("accepts flat Zapier fields and Meta field_data", () => {
    const flat = parseMarketingLeadWebhookBody({
      lead_id: "lead-2",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      phone_number: "+442071234567",
      package: "Silverstone Club",
      how_many_tickets: "2 guests",
      budget: "£10k",
    })
    assert.equal(flat.ok, true)
    if (!flat.ok) return
    assert.equal(flat.payload.contact.fullName, "Ada Lovelace")
    assert.equal(flat.payload.interest.quantity, 2)
    assert.equal(flat.payload.interest.package, "Silverstone Club")
    assert.ok(flat.payload.answers.some((row) => row.question === "budget" && row.answer === "£10k"))

    const meta = parseMarketingLeadWebhookBody({
      id: "1234567890",
      created_time: "2026-09-09T09:00:00+0000",
      field_data: [
        { name: "full_name", values: ["Alan Turing"] },
        { name: "email", values: ["alan@example.com"] },
        { name: "phone_number", values: ["07900000000"] },
        { name: "event", values: ["British GP"] },
      ],
    })
    assert.equal(meta.ok, true)
    if (!meta.ok) return
    assert.equal(meta.payload.leadId, "1234567890")
    assert.equal(meta.payload.contact.fullName, "Alan Turing")
    assert.equal(meta.payload.interest.event, "British GP")
  })

  it("requires lead id, name, and email or phone", () => {
    assert.equal(parseMarketingLeadWebhookBody({ contact: { fullName: "A", email: "a@b.com" } }).ok, false)
    assert.equal(parseMarketingLeadWebhookBody({ leadId: "1", email: "a@b.com" }).ok, false)
    assert.equal(parseMarketingLeadWebhookBody({ leadId: "1", fullName: "A" }).ok, false)
    assert.equal(parseMarketingLeadWebhookBody({ leadId: "1", fullName: "A", phone: "07900" }).ok, true)
  })

  it("writes package, tickets and answers into notes", () => {
    const parsed = parseMarketingLeadWebhookBody(MARKETING_LEAD_EXAMPLE_PAYLOAD)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    const notes = formatMarketingLeadNotes(parsed.payload)
    assert.match(notes, /Marketing lead \(Meta\)/)
    assert.match(notes, /Package: Monaco GP Hospitality/)
    assert.match(notes, /Tickets: 4/)
    assert.match(notes, /When do you need tickets\?: Race weekend/)
    assert.equal(normalizeMarketingAlias("Monaco GP  Hospitality!"), "monaco gp hospitality")
  })
})

describe("marketing lead webhook auth", () => {
  const secret = "test-marketing-secret"
  const body = JSON.stringify({ leadId: "1" })

  it("accepts shared secret header, bearer token, and hmac", () => {
    const headerReq = new Request("https://zk-sports.trade/api/webhooks/marketing-lead", {
      method: "POST",
      headers: { "x-webhook-secret": secret },
      body,
    })
    assert.equal(verifyMarketingLeadWebhook(headerReq, body, secret), true)

    const bearerReq = new Request("https://zk-sports.trade/api/webhooks/marketing-lead", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      body,
    })
    assert.equal(verifyMarketingLeadWebhook(bearerReq, body, secret), true)

    const hmac = createHmac("sha256", secret).update(body).digest("hex")
    const hmacReq = new Request("https://zk-sports.trade/api/webhooks/marketing-lead", {
      method: "POST",
      headers: { "x-webhook-signature": hmac },
      body,
    })
    assert.equal(verifyMarketingLeadWebhook(hmacReq, body, secret), true)
  })

  it("rejects a missing or wrong secret", () => {
    const req = new Request("https://zk-sports.trade/api/webhooks/marketing-lead", {
      method: "POST",
      headers: { "x-webhook-secret": "nope" },
      body,
    })
    assert.equal(verifyMarketingLeadWebhook(req, body, secret), false)
    const unsigned = new Request("https://zk-sports.trade/api/webhooks/marketing-lead", {
      method: "POST",
      body,
    })
    assert.equal(verifyMarketingLeadWebhook(unsigned, body, secret), false)
  })
})

describe("marketing lead migration", () => {
  it("allows marketing deal source and stores ingest plus package aliases", () => {
    assert.match(sql, /deals_source_check/)
    assert.match(sql, /'marketing'/)
    assert.match(sql, /create table if not exists public.marketing_lead_ingest/)
    assert.match(sql, /create table if not exists public.marketing_package_aliases/)
    assert.match(sql, /marketing_lead_ingest_lead_id_unique/)
  })
})
