import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { parseOptionalIsoDate } from "../lib/admin/purchase-order-date"

test("guest-details deadline and tickets-received dates live on purchase orders", () => {
  const sql = readFileSync(
    "supabase/migrations/20260911150000_purchase_order_guest_deadline_tickets_received.sql",
    "utf8",
  )
  assert.match(sql, /guest_details_deadline date/)
  assert.match(sql, /tickets_received_at date/)
  assert.match(sql, /purchase_orders/)

  const types = readFileSync("lib/admin/purchase-orders.ts", "utf8")
  assert.match(types, /guest_details_deadline: string \| null/)
  assert.match(types, /tickets_received_at: string \| null/)
  assert.match(types, /setPurchaseOrderOpsDates/)
})

test("parseOptionalIsoDate accepts empty, YYYY-MM-DD, and rejects junk", () => {
  assert.deepEqual(parseOptionalIsoDate("", "Deadline"), { ok: true, date: null })
  assert.deepEqual(parseOptionalIsoDate("   ", "Deadline"), { ok: true, date: null })
  assert.deepEqual(parseOptionalIsoDate(null, "Deadline"), { ok: true, date: null })
  assert.deepEqual(parseOptionalIsoDate("2026-09-08", "Deadline"), { ok: true, date: "2026-09-08" })
  assert.equal(parseOptionalIsoDate("08/09/2026", "Deadline").ok, false)
  assert.equal(parseOptionalIsoDate("2026-9-8", "Tickets received").ok, false)
  const bad = parseOptionalIsoDate("not-a-date", "Deadline")
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.match(bad.message, /Deadline/)
})

test("stock purchased table and purchase orders both show deadline and tickets received", () => {
  const costLayers = readFileSync("components/admin/package-cost-layers.tsx", "utf8")
  assert.match(costLayers, />\s*Deadline\s*</)
  assert.match(costLayers, />\s*Tickets received\s*</)
  assert.match(costLayers, /editGuestDetailsDeadline/)
  assert.match(costLayers, /editTicketsReceivedAt/)
  assert.match(costLayers, /purchaseOrderGuestDetailsDeadline/)
  assert.match(costLayers, /purchaseOrderTicketsReceivedAt/)
  assert.match(costLayers, /STOCK_PURCHASED_COLSPAN = 11/)

  const poClient = readFileSync("app/(admin)/admin/purchase-orders/purchase-orders-client.tsx", "utf8")
  assert.match(poClient, />\s*Deadline\s*</)
  assert.match(poClient, />\s*Tickets received\s*</)
  assert.match(poClient, /guestDetailsDeadline/)
  assert.match(poClient, /ticketsReceivedAt/)
  assert.match(poClient, /colSpan=\{11\}/)

  const actions = readFileSync("app/(admin)/actions.ts", "utf8")
  assert.match(actions, /setPurchaseOrderOpsDates/)
  assert.match(actions, /guestDetailsDeadline/)
  assert.match(actions, /ticketsReceivedAt/)
})
