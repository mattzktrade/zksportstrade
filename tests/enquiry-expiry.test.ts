import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { enquiryShouldAutoExpire } from "../lib/crm/enquiry-expiry"

const past = { eventDate: "2026-09-01" }
const future = { eventDate: "2026-11-01" }
const today = "2026-10-05"

test("an enquiry expires once its only event has taken place", () => {
  assert.equal(
    enquiryShouldAutoExpire({
      stage: "draft",
      enquiryStage: "contacted",
      events: [past],
      today,
    }),
    true,
  )
  assert.equal(
    enquiryShouldAutoExpire({
      stage: "proposal",
      enquiryStage: "follow_up",
      events: [past, { eventDate: "2026-08-01" }],
      today,
    }),
    true,
  )
})

test("a future event keeps the enquiry on its current stage", () => {
  assert.equal(
    enquiryShouldAutoExpire({
      stage: "sourcing",
      enquiryStage: "sourcing_required",
      events: [past, future],
      today,
    }),
    false,
  )
  assert.equal(
    enquiryShouldAutoExpire({
      stage: "draft",
      enquiryStage: "new",
      events: [{ eventDate: today }],
      today,
    }),
    false,
  )
  assert.equal(
    enquiryShouldAutoExpire({
      stage: "draft",
      enquiryStage: "new",
      events: [future],
      today,
    }),
    false,
  )
})

test("enquiries without a dated event, and closed ones, are left alone", () => {
  assert.equal(
    enquiryShouldAutoExpire({ stage: "draft", enquiryStage: "new", events: [], today }),
    false,
  )
  assert.equal(
    enquiryShouldAutoExpire({
      stage: "draft",
      enquiryStage: "new",
      events: [{ eventDate: null }],
      today,
    }),
    false,
  )
  assert.equal(
    enquiryShouldAutoExpire({
      stage: "draft",
      enquiryStage: "not_interested",
      events: [past],
      today,
    }),
    false,
  )
  assert.equal(
    enquiryShouldAutoExpire({
      stage: "draft",
      enquiryStage: "expired",
      events: [past],
      today,
    }),
    false,
  )
  assert.equal(
    enquiryShouldAutoExpire({
      stage: "paid_confirmed",
      enquiryStage: "price_sent",
      events: [past],
      today,
    }),
    false,
  )
})

test("expiry migration covers every linked event and keeps later deals", () => {
  const sql = readFileSync("supabase/migrations/20261005120000_enquiry_expired_stage.sql", "utf8")
  assert.match(sql, /'expired'/)
  assert.match(sql, /expire_past_event_enquiries/)
  assert.match(sql, /deal_line_items/)
  assert.match(sql, /d\.race_id/)
  assert.match(sql, /event_date < v_today/)
  assert.match(sql, /not in \('expired', 'not_interested'\)/)
  assert.match(sql, /Europe\/London/)
  assert.match(sql, /when v_deal\.enquiry_stage = 'expired' then 'expired'/)
  assert.match(sql, /d\.stage in \('draft', 'sourcing', 'proposal'\)/)
})
