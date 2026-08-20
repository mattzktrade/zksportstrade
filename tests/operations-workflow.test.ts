import assert from "node:assert/strict"
import test from "node:test"
import {
  isCancelledWorkflowRow,
  operationsTicketStatus,
} from "../lib/admin/workflow-status"

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
