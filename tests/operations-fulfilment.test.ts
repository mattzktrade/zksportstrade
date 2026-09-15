import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import {
  isDirectClientAccount,
  lockedClientDelivery,
  operationsCalendarItems,
  operationsQueueBucket,
  operationsQueueSortKey,
  operationsSortDeadline,
  supplierInboundComplete,
  thankYouDue,
  unpaidCloseToEvent,
} from "../lib/operations/fulfilment"

const today = "2026-09-15"

function base(overrides: Record<string, unknown> = {}) {
  return {
    invoiceStatus: "paid",
    dealStage: "paid_confirmed",
    guestDetailsStatus: "not_requested",
    completeGuestCount: 0,
    quantity: 4,
    supplierFulfilmentMethod: null,
    clientDeliveryMethod: null,
    supplierDetailsSentAt: null,
    ticketsReceivedAt: null,
    deliveryStatus: "not_ready",
    fulfilmentStatus: "confirmed",
    eventDate: "2026-11-22",
    isDirectClient: true,
    thankYouSentAt: null,
    thankYouSkippedAt: null,
    hasDeliveryProof: false,
    ...overrides,
  }
}

test("queue starts on guests, then supplier inbound, then fulfil", () => {
  assert.equal(operationsQueueBucket(base(), today), "needs_guests")
  assert.equal(
    operationsQueueBucket(base({ guestDetailsStatus: "complete", completeGuestCount: 4 }), today),
    "waiting_supplier",
  )
  assert.equal(
    operationsQueueBucket(
      base({
        guestDetailsStatus: "complete",
        completeGuestCount: 4,
        supplierFulfilmentMethod: "names_only",
        supplierDetailsSentAt: "2026-09-10T10:00:00Z",
        clientDeliveryMethod: "supplier_handles",
      }),
      today,
    ),
    "ready_to_fulfil",
  )
})

test("names-only inbound is complete when names are sent, without tickets received", () => {
  assert.equal(
    supplierInboundComplete({
      supplierFulfilmentMethod: "names_only",
      supplierDetailsSentAt: "2026-09-10T10:00:00Z",
      ticketsReceivedAt: null,
    }),
    true,
  )
  assert.equal(
    supplierInboundComplete({
      supplierFulfilmentMethod: "digital_to_zk",
      supplierDetailsSentAt: "2026-09-10T10:00:00Z",
      ticketsReceivedAt: null,
    }),
    false,
  )
  assert.equal(
    supplierInboundComplete({
      supplierFulfilmentMethod: "digital_to_zk",
      supplierDetailsSentAt: null,
      ticketsReceivedAt: "2026-09-12",
    }),
    true,
  )
  assert.equal(lockedClientDelivery("names_only"), "supplier_handles")
  assert.equal(lockedClientDelivery("digital_to_zk"), null)
})

test("delivered bookings wait for the event, then thank-you is due for direct clients only", () => {
  const delivered = base({
    guestDetailsStatus: "complete",
    completeGuestCount: 4,
    supplierFulfilmentMethod: "names_only",
    supplierDetailsSentAt: "2026-09-01T00:00:00Z",
    deliveryStatus: "delivered",
    fulfilmentStatus: "delivered",
    eventDate: "2026-11-22",
  })
  assert.equal(operationsQueueBucket(delivered, today), "awaiting_event")
  assert.equal(operationsQueueBucket({ ...delivered, eventDate: "2026-09-14" }, today), "after_event")
  assert.equal(thankYouDue({ ...delivered, isDirectClient: false, eventDate: "2026-09-14" }, today), false)
  assert.equal(
    operationsQueueBucket({ ...delivered, eventDate: "2026-09-14", thankYouSentAt: "2026-09-15T09:00:00Z" }, today),
    "done",
  )
})

test("unpaid close-to-event warning is independent of the guest queue", () => {
  assert.equal(
    unpaidCloseToEvent(base({ invoiceStatus: "awaiting_payment", dealStage: "awaiting_payment", eventDate: "2026-09-20" }), today),
    true,
  )
  assert.equal(
    unpaidCloseToEvent(base({ invoiceStatus: "paid", dealStage: "paid_confirmed", eventDate: "2026-09-20" }), today),
    false,
  )
  assert.equal(isDirectClientAccount(["direct_client"]), true)
  assert.equal(isDirectClientAccount(["ticket_agent"]), false)
})

test("sort deadline uses the supplier guest deadline while names are outstanding", () => {
  assert.equal(
    operationsSortDeadline(
      base({
        guestDetailsDeadline: "2026-10-01",
        deliveryDueAt: "2026-11-20",
      }),
    ),
    "2026-10-01",
  )
})

test("calendar lists race, overdue guest deadline, and collection dates", () => {
  const items = operationsCalendarItems({
    ...base({
      guestDetailsStatus: "requested",
      guestDetailsDeadline: "2026-10-02",
      deliveryDueAt: "2026-11-20",
      supplierFulfilmentMethod: "collect_from_supplier",
      clientDeliveryMethod: "local_collection",
    }),
    id: "deal-1",
    accountName: "Apex",
    eventPackage: "2026 Las Vegas Grand Prix · Paddock Club",
  })
  assert.deepEqual(
    items.map((item) => item.kind),
    ["race", "guest_deadline", "collection"],
  )
  assert.equal(items[1]?.date, "2026-10-02")
})

test("overdue guest deadlines sort ahead of later dates", () => {
  const overdue = operationsQueueSortKey(
    base({ guestDetailsDeadline: "2026-09-01", guestDetailsStatus: "requested" }),
    today,
  )
  const later = operationsQueueSortKey(
    base({ guestDetailsDeadline: "2026-10-01", guestDetailsStatus: "requested" }),
    today,
  )
  assert.equal(overdue < later, true)
})

test("deal contact embeds stay on the primary-contact relationship", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..")
  for (const relative of [
    "lib/crm/deals.ts",
    "lib/admin/workflow-views.ts",
    "lib/guest-details/invite.ts",
    "app/(admin)/admin/operations/email-actions.ts",
  ]) {
    const source = readFileSync(join(root, relative), "utf8")
    assert.match(source, /crm_contacts!primary_contact_id/)
  }
})

test("migration adds ops contact, fulfilment methods, deal-scoped proof, and email templates", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..")
  const sql = readFileSync(join(root, "supabase/migrations/20260915120000_operations_fulfilment_board.sql"), "utf8")
  assert.match(sql, /operations_contact_id/)
  assert.match(sql, /supplier_fulfilment_method/)
  assert.match(sql, /client_delivery_method/)
  assert.match(sql, /thank_you_skipped_at/)
  assert.match(sql, /operations_email_templates/)
  assert.match(sql, /after_event/)
  assert.match(sql, /deal_id uuid/)
  assert.match(sql, /alter column invoice_id drop not null/i)
})
