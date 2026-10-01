import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  SOURCING_COMPLETE_EMAIL,
  SOURCING_COMPLETE_HREF,
  SOURCING_REQUIRED_EMAIL,
  SOURCING_REQUIRED_HREF,
  buildSourcingNotification,
  isOpenSourcingStage,
  sourcingEnquirySnapshotFromRow,
  sourcingNotificationForStageChange,
  type SourcingEnquirySnapshot,
} from "../lib/crm/sourcing-notifications"
import { sourcingEmailWarning } from "../lib/email/send-sourcing-notification"

const snapshot: SourcingEnquirySnapshot = {
  id: "deal-1",
  reference: "DL1100",
  stage: "draft",
  enquiryStage: "responded",
  clientName: "Apex Group",
  interest: "Singapore Grand Prix — Paddock Club",
}

test("sourcing required emails Matt and sourcing complete emails Samantha", () => {
  assert.deepEqual(
    sourcingNotificationForStageChange({
      previous: { stage: "draft", enquiry_stage: "responded" },
      nextStage: "sourcing_required",
    }),
    { kind: "sourcing_required", to: SOURCING_REQUIRED_EMAIL },
  )
  assert.equal(SOURCING_REQUIRED_EMAIL, "matt@zk-sports.com")
  assert.deepEqual(
    sourcingNotificationForStageChange({
      previous: { stage: "sourcing", enquiry_stage: "sourcing_required" },
      nextStage: "sourcing_complete",
    }),
    { kind: "sourcing_complete", to: SOURCING_COMPLETE_EMAIL },
  )
  assert.equal(SOURCING_COMPLETE_EMAIL, "samantha@zk-sports.com")
  assert.equal(SOURCING_REQUIRED_HREF, "/admin/enquiries?stage=sourcing_required")
  assert.equal(SOURCING_COMPLETE_HREF, "/admin/enquiries?stage=sourcing_complete")
})

test("saving the same sourcing stage, or moving to another stage, does not email", () => {
  assert.equal(
    sourcingNotificationForStageChange({
      previous: { stage: "sourcing", enquiry_stage: "sourcing_required" },
      nextStage: "sourcing_required",
    }),
    null,
  )
  assert.equal(
    sourcingNotificationForStageChange({
      previous: { stage: "sourcing", enquiry_stage: null },
      nextStage: "sourcing_required",
    }),
    null,
  )
  assert.equal(
    sourcingNotificationForStageChange({
      previous: { stage: "sourcing", enquiry_stage: "sourcing_complete" },
      nextStage: "price_sent",
    }),
    null,
  )
})

test("dashboard counts stay on open enquiries", () => {
  assert.equal(isOpenSourcingStage({ stage: "sourcing", enquiry_stage: "sourcing_required" }, "sourcing_required"), true)
  assert.equal(isOpenSourcingStage({ stage: "sourcing", enquiry_stage: null }, "sourcing_required"), true)
  assert.equal(isOpenSourcingStage({ stage: "sourcing", enquiry_stage: "sourcing_complete" }, "sourcing_required"), false)
  assert.equal(
    isOpenSourcingStage({ stage: "awaiting_payment", enquiry_stage: "sourcing_required" }, "sourcing_required"),
    false,
  )
  assert.equal(isOpenSourcingStage({ stage: "sourcing", enquiry_stage: "sourcing_complete" }, "sourcing_complete"), true)
  assert.equal(isOpenSourcingStage({ stage: "proposal", enquiry_stage: "price_sent" }, "sourcing_complete"), false)
})

test("sourcing email names the enquiry and links back to it", () => {
  const required = buildSourcingNotification({
    snapshot,
    nextStage: "sourcing_required",
    origin: "https://portal.example",
  })
  assert.equal(required?.to, "matt@zk-sports.com")
  assert.equal(required?.subject, "Sourcing required — DL1100")
  assert.match(required?.text ?? "", /needs sourcing/)
  assert.match(required?.text ?? "", /Apex Group/)
  assert.match(required?.text ?? "", /https:\/\/portal\.example\/admin\/enquiries\?enquiry=deal-1/)

  const complete = buildSourcingNotification({
    snapshot: { ...snapshot, stage: "sourcing", enquiryStage: "sourcing_required" },
    nextStage: "sourcing_complete",
    origin: "https://portal.example",
  })
  assert.equal(complete?.to, "samantha@zk-sports.com")
  assert.match(complete?.text ?? "", /send the quote to the client/)
  assert.match(complete?.html ?? "", /Apex Group/)
  assert.doesNotMatch(complete?.html ?? "", /<script/)
})

test("client and package names are read from the enquiry row", () => {
  const parsed = sourcingEnquirySnapshotFromRow({
    id: "deal-9",
    reference: "DL9",
    stage: "draft",
    enquiry_stage: "responded",
    crm_accounts: { name: "Northwind & Co" },
    deal_line_items: [
      { packages: { name: "Paddock Club", races: { name: "Monaco Grand Prix" } } },
    ],
  })
  assert.equal(parsed?.clientName, "Northwind & Co")
  assert.equal(parsed?.interest, "Monaco Grand Prix — Paddock Club")
  const notice = buildSourcingNotification({
    snapshot: parsed!,
    nextStage: "sourcing_required",
    origin: "https://portal.example",
  })
  assert.match(notice?.html ?? "", /Northwind &amp; Co/)
})

test("an event-only enquiry still names the race and the notes", () => {
  const parsed = sourcingEnquirySnapshotFromRow({
    id: "deal-10",
    reference: "DL0992",
    stage: "sourcing",
    enquiry_stage: "sourcing_required",
    notes: "12-14 private suite on Main stand",
    crm_accounts: { name: "Touch Premium" },
    races: { name: "Abu Dhabi Grand Prix", season: 2026 },
    deal_line_items: [],
  })
  assert.equal(parsed?.interest, "2026 Abu Dhabi Grand Prix — no package yet")
  assert.equal(parsed?.notes, "12-14 private suite on Main stand")
  const notice = buildSourcingNotification({
    snapshot: { ...parsed!, stage: "draft", enquiryStage: "new" },
    nextStage: "sourcing_required",
    origin: "https://portal.example",
  })
  assert.equal(notice?.to, "matt@zk-sports.com")
  assert.match(notice?.text ?? "", /12-14 private suite/)
  assert.match(notice?.text ?? "", /2026 Abu Dhabi Grand Prix/)
})

test("a failed sourcing email does not replace the saved-stage message", () => {
  assert.equal(sourcingEmailWarning(0), "")
  assert.match(sourcingEmailWarning(1), /enquiry was saved/)
  assert.match(sourcingEmailWarning(2), /2 sourcing emails/)
  const actions = readFileSync("app/(admin)/actions.ts", "utf8")
  assert.match(actions, /loadSourcingEnquirySnapshots\(gate\.supabase, \[dealId\]\)/)
  assert.match(actions, /loadSourcingEnquirySnapshots\(gate\.supabase, dealIds\)/)
  assert.match(actions, /deliverSourcingStageNotification/)
  const createStart = actions.indexOf("export async function createNativeDeal")
  const createEnd = actions.indexOf("const LEAD_SOURCES", createStart)
  const createFn = actions.slice(createStart, createEnd)
  assert.match(createFn, /enquiryStage: "new"/)
  assert.match(createFn, /deliverSourcingStageNotification/)
  assert.match(createFn, /sourcing_required/)
})
