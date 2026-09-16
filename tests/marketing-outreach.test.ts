import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  isOutreachStopKeyword,
  marketingFollowUpForEnquiry,
  marketingOutreachLabel,
  phonesMatchForOutreach,
  shouldAdvanceOutreachStage,
} from "../lib/integrations/marketing-leads/outreach-labels"
import {
  outreachTemplateToMetaBody,
  outreachVarsFromSnapshot,
  outreachWhatsAppParameters,
  renderOutreachTemplate,
} from "../lib/integrations/marketing-leads/outreach-render"
import { staffStageShouldStopOutreach } from "../lib/integrations/marketing-leads/outreach-stop"
import type { MarketingOutreachSend } from "../lib/integrations/marketing-leads/outreach-types"

const sql = readFileSync(
  new URL("../supabase/migrations/20260914120000_marketing_outreach.sql", import.meta.url),
  "utf8",
)

const sampleSend = (stage: 1 | 2 | 3, channel: "email" | "whatsapp"): MarketingOutreachSend => ({
  id: `${stage}-${channel}`,
  enrollment_id: "enr",
  deal_id: "deal",
  stage,
  channel,
  status: "sent",
  skip_reason: null,
  provider_message_id: null,
  subject: null,
  body_rendered: null,
  error: null,
  created_at: "2026-09-14T00:00:00.000Z",
  sent_at: "2026-09-14T00:00:00.000Z",
})

describe("marketing outreach copy", () => {
  it("fills package and event placeholders in a warm short message", () => {
    const vars = outreachVarsFromSnapshot({
      firstName: "Kary",
      fullName: "Kary Avs Di Angel",
      event: "2026 Mexico City Grand Prix",
      packageName: "3 Day Paddock Club (Club Suite)",
      quantity: 2,
    })
    const body = renderOutreachTemplate(
      "Hi {{first_name}}, thanks for your enquiry about {{package}} at {{event}}.",
      vars,
    )
    assert.equal(
      body,
      "Hi Kary, thanks for your enquiry about 3 Day Paddock Club (Club Suite) at 2026 Mexico City Grand Prix.",
    )
  })

  it("converts named placeholders to Meta {{1}} variables in first-seen order", () => {
    const template = "Hi {{first_name}}, still here on {{package}} at {{event}}. Reply if {{first_name}} wants a price."
    assert.equal(
      outreachTemplateToMetaBody(template),
      "Hi {{1}}, still here on {{2}} at {{3}}. Reply if {{1}} wants a price.",
    )
    const vars = outreachVarsFromSnapshot({
      firstName: "Kary",
      event: "Mexico",
      packageName: "Club Suite",
    })
    assert.deepEqual(outreachWhatsAppParameters(template, vars), ["Kary", "Club Suite", "Mexico"])
  })
})

describe("marketing outreach labels and stop rules", () => {
  it("shows which channels went out for the latest sent stage", () => {
    assert.equal(
      marketingOutreachLabel({
        status: "active",
        stopReason: null,
        currentStage: 0,
        nextStageDueAt: null,
        sends: [sampleSend(1, "email")],
      }),
      "Stage 1 · email sent",
    )
    assert.equal(
      marketingOutreachLabel({
        status: "active",
        stopReason: null,
        currentStage: 1,
        nextStageDueAt: null,
        sends: [sampleSend(1, "email"), sampleSend(1, "whatsapp")],
      }),
      "Stage 1 · email + WhatsApp sent",
    )
    assert.equal(
      marketingOutreachLabel({
        status: "stopped",
        stopReason: "replied",
        currentStage: 1,
        nextStageDueAt: null,
        sends: [sampleSend(1, "email")],
      }),
      "They replied — follow-up stopped",
    )
  })

  it("treats STOP and similar replies as opt-out", () => {
    assert.equal(isOutreachStopKeyword("STOP"), true)
    assert.equal(isOutreachStopKeyword("Please unsubscribe me"), true)
    assert.equal(isOutreachStopKeyword("Yes please send a price"), false)
  })

  it("matches WhatsApp numbers on the last 8+ digits", () => {
    assert.equal(phonesMatchForOutreach("+44 7700 900123", "7700900123"), true)
    assert.equal(phonesMatchForOutreach("7700900123", "447700900999"), false)
  })

  it("stops the sequence when staff move the enquiry off New", () => {
    assert.equal(staffStageShouldStopOutreach("new"), false)
    assert.equal(staffStageShouldStopOutreach("contacted"), true)
    assert.equal(staffStageShouldStopOutreach("not_interested"), true)
  })

  it("shows Follow-up off on marketing enquiries that are not in a sequence yet", () => {
    const paused = marketingFollowUpForEnquiry({
      dealId: "d1",
      source: "marketing",
      sequenceEnabled: false,
    })
    assert.equal(paused?.label, "Follow-up off")
    assert.equal(paused?.idle, true)
    assert.equal(
      marketingFollowUpForEnquiry({ dealId: "d1", source: "referral", sequenceEnabled: false }),
      undefined,
    )
  })
})

describe("marketing outreach stage advance", () => {
  it("holds the stage when a channel can still be retried", () => {
    assert.equal(
      shouldAdvanceOutreachStage({ status: "sent" }, { status: "skipped", skipReason: "template_missing" }),
      "hold",
    )
    assert.equal(
      shouldAdvanceOutreachStage({ status: "skipped", skipReason: "email_not_configured" }, { status: "sent" }),
      "hold",
    )
    assert.equal(shouldAdvanceOutreachStage({ status: "sent" }, { status: "failed" }), "hold")
  })

  it("advances only after a real send, and stops when nothing can be sent", () => {
    assert.equal(
      shouldAdvanceOutreachStage(
        { status: "sent" },
        { status: "skipped", skipReason: "whatsapp_disabled" },
      ),
      "advance",
    )
    assert.equal(
      shouldAdvanceOutreachStage(
        { status: "skipped", skipReason: "no_email" },
        { status: "skipped", skipReason: "no_phone" },
      ),
      "no_channel",
    )
  })
})

describe("marketing outreach wiring", () => {
  it("seeds three editable stages and send logs", () => {
    assert.match(sql, /create table if not exists public.marketing_outreach_settings/)
    assert.match(sql, /create table if not exists public.marketing_outreach_steps/)
    assert.match(sql, /create table if not exists public.marketing_outreach_enrollments/)
    assert.match(sql, /create table if not exists public.marketing_outreach_sends/)
    assert.match(sql, /constraint marketing_outreach_steps_stage_check check \(stage in \(1, 2, 3\)\)/)
    assert.match(sql, /Thanks for your \{\{event\}\} enquiry/)
    assert.match(sql, /I'll leave this with you so I'm not chasing/)
    assert.match(sql, /values \('marketing_leads', false\)/)
  })

  it("enrolls new marketing leads and runs follow-up on the integration cron", () => {
    const ingest = readFileSync("lib/integrations/marketing-leads/ingest.ts", "utf8")
    assert.match(ingest, /enrollMarketingOutreach/)
    const enroll = readFileSync("lib/integrations/marketing-leads/outreach-enroll.ts", "utf8")
    assert.match(enroll, /Marketing follow-up is paused/)
    const process = readFileSync("lib/integrations/marketing-leads/outreach-process.ts", "utf8")
    assert.match(process, /data\?\.enabled === true/)
    const cron = readFileSync("lib/integrations/run-integration-cron.ts", "utf8")
    const fn = cron.slice(cron.indexOf("export async function runIntegrationCronJob"))
    assert.ok(fn.indexOf("await processNativeInvoiceReminders") < fn.indexOf("await processMarketingOutreach"))
  })

  it("puts the follow-up editor on Sales → Templates, not Settings", () => {
    const settings = readFileSync("app/(admin)/admin/settings/page.tsx", "utf8")
    assert.doesNotMatch(settings, /marketing-leads/)
    const templatesPage = readFileSync("app/(admin)/admin/templates/page.tsx", "utf8")
    assert.match(templatesPage, /SalesTemplatesEditor/)
    assert.match(templatesPage, /How it works/)
    assert.doesNotMatch(templatesPage, /MARKETING_LEAD_WEBHOOK/)
    const editor = readFileSync("app/(admin)/admin/templates/templates-client.tsx", "utf8")
    assert.match(editor, /Send this sequence automatically/)
    const oldPage = readFileSync("app/(admin)/admin/integrations/marketing-leads/page.tsx", "utf8")
    assert.match(oldPage, /redirect\("\/admin\/templates"\)/)
    const actions = readFileSync(
      "app/(admin)/admin/integrations/marketing-leads/outreach-actions.ts",
      "utf8",
    )
    assert.match(actions, /hasCmsPermission\(profile, "deals\.manage"\)/)
    assert.match(actions, /revalidatePath\("\/admin\/templates"\)/)
  })
})
