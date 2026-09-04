import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import {
  DEAL_BOARD_COLUMNS,
  ENQUIRY_CONVERT_STAGE,
  ENQUIRY_CRM_STAGES,
  ENQUIRY_PIPELINE_STAGES,
  ENQUIRY_STAGE_TABS,
  adminEnquiryListPath,
  adminPipelineHome,
  defaultEnquiryAction,
  enquiryCrmStageFromDeal,
  enquiryDealStage,
  enquiryInterestLabel,
  enquiryLineAvailability,
  enquiryNeedsSourcing,
  enquiryNotesPreview,
  enquiryStageLabel,
  enquiryTemperatureFromDeal,
  isDealBoardStage,
  isEnquiryPipelineStage,
  isOpenEnquiry,
  nextEnquiryCrmStage,
  resolvedEnquiryTemperature,
  suggestedEnquiryAction,
  enquiryAttentionReason,
  enquiryNeedsAttention,
} from "../lib/crm/deal-pipeline"

test("enquiry stages stay off the deals board", () => {
  for (const stage of ENQUIRY_PIPELINE_STAGES) {
    assert.equal(isEnquiryPipelineStage(stage), true)
    assert.equal(isDealBoardStage(stage), false)
  }
  assert.equal(isEnquiryPipelineStage("awaiting_booking_form_send"), false)
  assert.equal(isDealBoardStage("awaiting_booking_form_send"), true)
  assert.equal(isDealBoardStage("signed"), true)
  assert.equal(isDealBoardStage("closed_lost"), true)
  assert.equal(isEnquiryPipelineStage("booking_form_sent"), false)
})

test("enquiry CRM stages cover the sales progression without using closed lost", () => {
  assert.deepEqual(
    ENQUIRY_STAGE_TABS.map((tab) => tab.id),
    ["all", ...ENQUIRY_CRM_STAGES],
  )
  assert.deepEqual(ENQUIRY_CRM_STAGES, [
    "new",
    "contacted",
    "responded",
    "sourcing_required",
    "sourcing_complete",
    "price_sent",
    "follow_up",
    "not_interested",
  ])
  assert.equal(enquiryStageLabel("new"), "New")
  assert.equal(enquiryStageLabel("contacted"), "Contacted")
  assert.equal(enquiryStageLabel("responded"), "Responded")
  assert.equal(enquiryStageLabel("sourcing_required"), "Sourcing required")
  assert.equal(enquiryStageLabel("sourcing_complete"), "Sourcing complete")
  assert.equal(enquiryStageLabel("price_sent"), "Price sent")
  assert.equal(enquiryStageLabel("follow_up"), "Follow-up")
  assert.equal(enquiryStageLabel("not_interested"), "Not interested")
  assert.equal(enquiryStageLabel("draft"), "New")
  assert.equal(enquiryStageLabel("sourcing"), "Sourcing required")
  assert.equal(enquiryStageLabel("proposal"), "Price sent")
  assert.equal(enquiryDealStage("not_interested", "sourcing"), "sourcing")
  assert.equal(enquiryDealStage("not_interested", "signed"), "draft")
  assert.notEqual(enquiryDealStage("not_interested", "proposal"), "closed_lost")
  assert.equal(enquiryDealStage("follow_up"), "proposal")
  assert.equal(ENQUIRY_CONVERT_STAGE, "awaiting_booking_form_send")
})

test("cold outreach warms when they respond, inbound stays warm", () => {
  assert.equal(
    resolvedEnquiryTemperature({ source: "offline", enquiryStage: "new", temperature: "cold" }),
    "cold",
  )
  assert.equal(
    resolvedEnquiryTemperature({ source: "offline", enquiryStage: "contacted", temperature: "cold" }),
    "cold",
  )
  assert.equal(
    resolvedEnquiryTemperature({ source: "offline", enquiryStage: "responded", temperature: "cold" }),
    "warm",
  )
  assert.equal(
    resolvedEnquiryTemperature({ source: "website", enquiryStage: "new", temperature: "cold" }),
    "warm",
  )
  assert.equal(enquiryTemperatureFromDeal({ enquiry_temperature: "cold" }), "cold")
  assert.equal(enquiryCrmStageFromDeal({ stage: "draft", enquiry_stage: "contacted" }), "contacted")
})

test("advance skips sourcing when stock is already owned", () => {
  assert.equal(
    nextEnquiryCrmStage({
      stage: "draft",
      enquiry_stage: "new",
      lines: [{ sourcing_mode: "owned" }],
    }),
    "contacted",
  )
  assert.equal(
    nextEnquiryCrmStage({
      stage: "draft",
      enquiry_stage: "responded",
      lines: [{ sourcing_mode: "owned" }],
    }),
    "price_sent",
  )
  assert.equal(
    nextEnquiryCrmStage({
      stage: "draft",
      enquiry_stage: "responded",
      lines: [{ sourcing_mode: "brokered" }],
    }),
    "sourcing_required",
  )
  assert.equal(
    nextEnquiryCrmStage({
      stage: "proposal",
      enquiry_stage: "follow_up",
      lines: [],
    }),
    null,
  )
  assert.equal(
    isOpenEnquiry({ stage: "draft", enquiry_stage: "not_interested" }),
    false,
  )
})

test("deals board columns start at ready to send", () => {
  assert.equal(DEAL_BOARD_COLUMNS[0]?.id, "ready_to_send")
  assert.ok(DEAL_BOARD_COLUMNS[0]?.stages.includes("awaiting_booking_form_send"))
  assert.ok(!DEAL_BOARD_COLUMNS.some((column) => column.stages.includes("draft")))
  assert.ok(!DEAL_BOARD_COLUMNS.some((column) => column.stages.includes("proposal")))
})

test("enquiry helpers describe interest, sourcing, and next action", () => {
  assert.equal(
    enquiryInterestLabel({ race_name: "Abu Dhabi GP", line_summary: "6× Paddock Club" }),
    "Abu Dhabi GP — 6× Paddock Club",
  )
  assert.equal(
    enquiryNeedsSourcing({
      stage: "draft",
      enquiry_stage: "new",
      lines: [{ sourcing_mode: "brokered" }],
    }),
    true,
  )
  assert.equal(
    enquiryNeedsSourcing({
      stage: "sourcing",
      enquiry_stage: "sourcing_complete",
      lines: [{ sourcing_mode: "brokered" }],
    }),
    false,
  )
  assert.equal(
    enquiryNeedsSourcing({
      stage: "proposal",
      enquiry_stage: "price_sent",
      lines: [{ sourcing_mode: "owned" }],
    }),
    false,
  )
  assert.equal(
    defaultEnquiryAction({ stage: "draft", enquiry_stage: "new", next_action: null }),
    "Make contact",
  )
  assert.equal(suggestedEnquiryAction("contacted"), "Wait for a reply")
  assert.equal(enquiryNotesPreview("Also asked about Paddock Club and Sunday only"), "Also asked about Paddock Club and Sunday only")
  assert.equal(
    enquiryAttentionReason({ owner_profile_id: null, next_action_due_at: null }),
    "No owner",
  )
  assert.equal(
    enquiryNeedsAttention({ owner_profile_id: "user-1", next_action_due_at: null }),
    false,
  )
  assert.equal(
    enquiryAttentionReason({
      owner_profile_id: "user-1",
      next_action_due_at: "2000-01-01T00:00:00.000Z",
    }),
    "Next step overdue",
  )
  assert.deepEqual(
    enquiryLineAvailability(
      { package_id: "pkg-1", quantity: 6, sourcing_mode: "owned" },
      { id: "pkg-1", packageName: "Paddock Club", eventName: "Abu Dhabi GP", stockLeft: 12 },
    ),
    {
      label: "Abu Dhabi GP — Paddock Club",
      requested: 6,
      available: 12,
      enough: true,
      sourcing: false,
    },
  )
  assert.equal(
    enquiryLineAvailability(
      { package_id: "pkg-1", quantity: 6, sourcing_mode: "brokered" },
      { id: "pkg-1", packageName: "Paddock Club", eventName: "Abu Dhabi GP", stockLeft: 2 },
    ).enough,
    false,
  )
  assert.equal(adminEnquiryListPath("abc"), "/admin/enquiries?enquiry=abc")
  assert.deepEqual(adminPipelineHome("proposal"), { href: "/admin/enquiries", label: "Enquiries" })
  assert.deepEqual(adminPipelineHome("signed"), { href: "/admin/deals", label: "Deals" })
})

test("sales nav and deals list keep enquiries off the later pipeline", () => {
  const layout = readFileSync("components/admin-layout.tsx", "utf8")
  assert.match(layout, /name: "Enquiries"/)
  assert.match(layout, /href: "\/admin\/enquiries"/)
  const dealsClient = readFileSync("app/(admin)/admin/deals/deals-client.tsx", "utf8")
  assert.match(dealsClient, /id: "ready_to_send"/)
  assert.doesNotMatch(dealsClient, /id: "new_enquiry"/)
  const enquiriesPage = readFileSync("app/(admin)/admin/enquiries/page.tsx", "utf8")
  assert.match(enquiriesPage, /isEnquiryPipelineStage/)
  const enquiriesClient = readFileSync("app/(admin)/admin/enquiries/enquiries-client.tsx", "utf8")
  assert.match(enquiriesClient, /Warm \/ Cold/)
  assert.match(enquiriesClient, /not_interested/)
  assert.match(enquiriesClient, /Save notes/)
  assert.match(enquiriesClient, /Apply to selected/)
  assert.match(enquiriesClient, /stockLeft|Availability/)
  assert.match(enquiriesClient, /BookingFormPanel/)
  assert.match(enquiriesClient, /onMovedToDeals/)
  assert.match(enquiriesClient, /kpiFilter === "attention"/)
  assert.match(enquiriesClient, /No owner, or the next step is overdue/)
  assert.doesNotMatch(enquiriesClient, /Advance stage/)
  assert.doesNotMatch(enquiriesClient, /Convert to Deal/)
  assert.doesNotMatch(enquiriesClient, /Tick several rows/)
  const createModal = readFileSync("components/admin/deal-create-modal.tsx", "utf8")
  assert.match(createModal, /Other options, dates, or anything they were not sure about/)
  const migration = readFileSync(
    "supabase/migrations/20260904140000_enquiry_stage_and_temperature.sql",
    "utf8",
  )
  assert.match(migration, /enquiry_stage/)
  assert.match(migration, /enquiry_temperature/)
  assert.match(migration, /not_interested/)
  assert.match(migration, /admin_update_enquiry_pipeline/)
  assert.doesNotMatch(migration, /not_interested.*closed_lost/)
})
