import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { hasCmsPermission, isCmsStaff, canPrepareNativeBookingForm, canSendNativeBookingForm } from "../lib/auth/permissions"

describe("CMS role permissions", () => {
  it("treats admin, finance and sales as CMS staff", () => {
    assert.equal(isCmsStaff({ role: "admin" }), true)
    assert.equal(isCmsStaff({ role: "finance" }), true)
    assert.equal(isCmsStaff({ role: "sales" }), true)
    assert.equal(isCmsStaff({ role: "agent" }), false)
  })

  it("gives admin full inventory override permissions", () => {
    assert.equal(hasCmsPermission({ role: "admin" }, "inventory.adjust"), true)
    assert.equal(hasCmsPermission({ role: "admin" }, "pricing.manage"), true)
    assert.equal(hasCmsPermission({ role: "admin" }, "integrations.manage"), true)
  })

  it("lets finance manage deals and invoices, but not stock overrides or sending booking forms", () => {
    assert.equal(hasCmsPermission({ role: "finance" }, "finance.manage"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "inventory.view"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "deals.view"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "deals.manage"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "accounts.manage"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "operations.view"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "operations.manage"), false)
    assert.equal(hasCmsPermission({ role: "finance" }, "inventory.adjust"), false)
    assert.equal(hasCmsPermission({ role: "finance" }, "inventory.hold"), false)
  })

  it("allows sales to manage deals but not stock overrides", () => {
    assert.equal(hasCmsPermission({ role: "sales" }, "deals.manage"), true)
    assert.equal(hasCmsPermission({ role: "sales" }, "accounts.manage"), true)
    assert.equal(hasCmsPermission({ role: "sales" }, "inventory.hold"), true)
    assert.equal(hasCmsPermission({ role: "sales" }, "operations.manage"), true)
    assert.equal(hasCmsPermission({ role: "sales" }, "inventory.adjust"), false)
    assert.equal(hasCmsPermission({ role: "sales" }, "integrations.manage"), false)
  })

  it("lets sales and finance prepare booking forms, but only admin can send them", () => {
    assert.equal(canPrepareNativeBookingForm({ role: "admin" }), true)
    assert.equal(canPrepareNativeBookingForm({ role: "sales" }), true)
    assert.equal(canPrepareNativeBookingForm({ role: "finance" }), true)
    assert.equal(canPrepareNativeBookingForm({ role: "agent" }), false)
    assert.equal(canSendNativeBookingForm({ role: "admin" }), true)
    assert.equal(canSendNativeBookingForm({ role: "sales" }), false)
    assert.equal(canSendNativeBookingForm({ role: "finance" }), false)
    assert.equal(canSendNativeBookingForm({ role: "agent" }), false)
  })

  it("grants finance deal and account management in SQL as well as the app", () => {
    const sql = readFileSync("supabase/migrations/20260901120000_finance_can_manage_deals.sql", "utf8")
    assert.match(sql, /p\.role = 'finance'/)
    assert.match(sql, /'deals.manage'/)
    assert.match(sql, /'accounts.manage'/)
  })
})
