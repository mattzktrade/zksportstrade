import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  calendarTodayIso,
  purchaseOrderDaysOverdue,
  purchaseOrderIsOverdue,
  purchaseOrderIsPaid,
  purchaseOrderPaymentKind,
  purchaseOrderPaymentLabel,
} from "../lib/admin/purchase-order-payment"

test("purchase order payment dates live on the purchase_orders table", () => {
  const sql = readFileSync(
    "supabase/migrations/20260917160000_purchase_order_payment.sql",
    "utf8",
  )
  assert.match(sql, /payment_due_date date/)
  assert.match(sql, /paid_at date/)
  assert.match(sql, /purchase_orders/)

  const types = readFileSync("lib/admin/purchase-orders.ts", "utf8")
  assert.match(types, /payment_due_date: string \| null/)
  assert.match(types, /paid_at: string \| null/)
  assert.match(types, /setPurchaseOrderPayment/)

  const actions = readFileSync("app/(admin)/actions.ts", "utf8")
  assert.match(actions, /setPurchaseOrderPaid/)
  assert.match(actions, /paymentDueDate/)
  assert.match(actions, /paidAt/)
})

test("paid, unpaid, due, and overdue follow paid_at and payment_due_date", () => {
  const today = "2026-09-17"
  assert.equal(purchaseOrderIsPaid({ paid_at: "2026-09-10" }), true)
  assert.equal(purchaseOrderIsPaid({ paid_at: null }), false)
  assert.equal(purchaseOrderPaymentKind({ paid_at: "2026-09-10", payment_due_date: "2026-09-01" }, today), "paid")
  assert.equal(purchaseOrderPaymentKind({ paid_at: null, payment_due_date: "2026-09-16" }, today), "overdue")
  assert.equal(purchaseOrderPaymentKind({ paid_at: null, payment_due_date: "2026-09-17" }, today), "due")
  assert.equal(purchaseOrderPaymentKind({ paid_at: null, payment_due_date: "2026-09-20" }, today), "due")
  assert.equal(purchaseOrderPaymentKind({ paid_at: null, payment_due_date: null }, today), "unpaid")
  assert.equal(purchaseOrderIsOverdue({ paid_at: null, payment_due_date: "2026-09-16" }, today), true)
  assert.equal(purchaseOrderIsOverdue({ paid_at: "2026-09-16", payment_due_date: "2026-09-01" }, today), false)
  assert.equal(purchaseOrderDaysOverdue({ paid_at: null, payment_due_date: "2026-09-15" }, today), 2)
  assert.equal(
    purchaseOrderPaymentLabel({ paid_at: null, payment_due_date: "2026-09-15" }, () => "15 Sep 2026", today),
    "Overdue 2 days",
  )
  assert.equal(
    purchaseOrderPaymentLabel({ paid_at: null, payment_due_date: "2026-09-20" }, () => "20 Sep 2026", today),
    "Due 20 Sep 2026",
  )
})

test("calendarTodayIso uses the local calendar date", () => {
  assert.match(calendarTodayIso(new Date("2026-09-17T23:30:00")), /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(calendarTodayIso(new Date(2026, 8, 17, 9, 0, 0)), "2026-09-17")
})

test("purchase orders list can mark paid, filter overdue, and edit payment dates", () => {
  const poClient = readFileSync("app/(admin)/admin/purchase-orders/purchase-orders-client.tsx", "utf8")
  assert.match(poClient, />\s*Payment\s*</)
  assert.match(poClient, /setPurchaseOrderPaid/)
  assert.match(poClient, /Overdue to pay/)
  assert.match(poClient, /paymentDueDate/)
  assert.match(poClient, /paidAt/)
  assert.match(poClient, /colSpan=\{PO_TABLE_COLSPAN\}/)
  assert.match(poClient, /const PO_TABLE_COLSPAN = 12/)
  assert.match(poClient, /All payments/)
  assert.match(poClient, /initialPayment/)
  const poPage = readFileSync("app/(admin)/admin/purchase-orders/page.tsx", "utf8")
  assert.match(poPage, /isPurchaseOrderPaymentFilter/)
  assert.match(poPage, /initialPayment/)
})
