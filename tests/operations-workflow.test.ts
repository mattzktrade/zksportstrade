import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  isCancelledWorkflowRow,
  operationsTicketStatus,
} from "../lib/admin/workflow-status"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

const base = {
  orderStatus: "confirmed",
  invoiceStatus: "paid",
  dealStage: "paid_confirmed",
  fulfilmentStatus: "confirmed",
  deliveryStatus: "not_ready",
}

test("cancelled deals are flagged whether the order, invoice, deal or fulfilment is cancelled", () => {
  assert.equal(isCancelledWorkflowRow({ ...base, orderStatus: "cancelled" }), true)
  assert.equal(isCancelledWorkflowRow({ ...base, invoiceStatus: "cancelled" }), true)
  assert.equal(isCancelledWorkflowRow({ ...base, dealStage: "closed_lost" }), true)
  assert.equal(isCancelledWorkflowRow({ ...base, fulfilmentStatus: "cancelled" }), true)
  assert.equal(isCancelledWorkflowRow(base), false)
})

test("ticket status collapses supplier/delivery into not ready, ready, or delivered", () => {
  assert.equal(operationsTicketStatus({ fulfilmentStatus: "confirmed", deliveryStatus: "not_ready" }), "not_ready")
  assert.equal(operationsTicketStatus({ fulfilmentStatus: "ready", deliveryStatus: "ready" }), "ready")
  assert.equal(operationsTicketStatus({ fulfilmentStatus: "delivered", deliveryStatus: "not_ready" }), "delivered")
  assert.equal(operationsTicketStatus({ fulfilmentStatus: "confirmed", deliveryStatus: "sent" }), "delivered")
  assert.equal(operationsTicketStatus({ fulfilmentStatus: "confirmed", deliveryStatus: "delivered" }), "delivered")
})

test("operations table no longer shows an Owner column", () => {
  const source = readFileSync(join(root, "app/(admin)/admin/operations/operations-client.tsx"), "utf8")
  assert.match(source, /<th className="px-4 py-2.5 font-medium">Delivery<\/th>/)
  assert.doesNotMatch(source, />Owner</)
  assert.doesNotMatch(source, /label="Owner"/)
  assert.match(source, /colSpan=\{8\}/)
})

test("marking operations delivered also updates paid invoices for My Bookings", () => {
  const source = readFileSync(join(root, "app/(admin)/admin/operations/actions.ts"), "utf8")
  assert.match(source, /async function markOrderInvoicesDelivered/)
  assert.match(source, /status: "delivered"/)
  assert.match(source, /\.in\("status", \["paid", "delivered"\]\)/)
  assert.match(source, /if \(input\.deliveryStatus === "delivered"\)/)
})

test("checkout terms links open in a new tab", () => {
  const source = readFileSync(join(root, "app/(portal)/checkout/checkout-client.tsx"), "utf8")
  const termsLinks = [...source.matchAll(/href="\/terms"[\s\S]{0,500}?terms and conditions/g)]
  assert.equal(termsLinks.length, 2)
  for (const match of termsLinks) {
    assert.match(match[0], /target="_blank"/)
    assert.match(match[0], /rel="noopener noreferrer"/)
  }
})

test("portal deals default to the Admin owner and operations advances deal stage", () => {
  const sql = readFileSync(
    join(root, "supabase/migrations/20260828150000_portal_deal_owner_and_operations_stages.sql"),
    "utf8",
  )
  assert.match(sql, /default_portal_deal_owner_id/)
  assert.match(sql, /source = 'portal'/)
  assert.match(sql, /role = 'admin'/)
  assert.match(sql, /stage = 'in_fulfilment'/)
  assert.match(sql, /stage = 'fulfilled'/)
  assert.match(sql, /guest_details_status in \('requested', 'partial', 'complete'\)/)
})
