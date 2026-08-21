import assert from "node:assert/strict"
import { test } from "node:test"
import {
  emptyPackageSalesBreakdown,
  linkedPoolSellableForPackage,
  type LinkedSellableMember,
  type PackageSalesBreakdown,
} from "../lib/admin/package-sales-breakdown"

function sold(packageId: string, qty: number): PackageSalesBreakdown {
  const b = emptyPackageSalesBreakdown(packageId)
  b.salesforceOffline = qty
  b.total = qty
  return b
}

function members(rows: Array<{ id: string; duration: string; qty: number }>): LinkedSellableMember[] {
  return rows.map((row) => ({
    id: row.id,
    duration: row.duration,
    breakdown: sold(row.id, row.qty),
  }))
}

test("selling 5 Saturday & Sunday packages reduces 3-day, Saturday, Sunday, and 2-day by 5", () => {
  const group = members([
    { id: "three", duration: "3_day", qty: 0 },
    { id: "fri", duration: "friday_only", qty: 0 },
    { id: "sat", duration: "saturday_only", qty: 0 },
    { id: "sun", duration: "sunday_only", qty: 0 },
    { id: "two", duration: "2_day", qty: 5 },
  ])
  const input = { stock: 26, members: group }
  assert.equal(linkedPoolSellableForPackage({ ...input, targetId: "two", targetDuration: "2_day" }), 21)
  assert.equal(linkedPoolSellableForPackage({ ...input, targetId: "three", targetDuration: "3_day" }), 21)
  assert.equal(linkedPoolSellableForPackage({ ...input, targetId: "sat", targetDuration: "saturday_only" }), 21)
  assert.equal(linkedPoolSellableForPackage({ ...input, targetId: "sun", targetDuration: "sunday_only" }), 21)
  assert.equal(linkedPoolSellableForPackage({ ...input, targetId: "fri", targetDuration: "friday_only" }), 26)
})
