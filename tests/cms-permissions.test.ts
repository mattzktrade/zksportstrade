import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { hasCmsPermission, isCmsStaff, isCmsOperator, canPrepareNativeBookingForm, canSendNativeBookingForm, canSignNativeBookingForm } from "../lib/auth/permissions"
import { readFileSync } from "node:fs"
import { bookingFormsAwaitingApprovalHref } from "../lib/admin/deal-link"

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

  it("lets finance work like admin except Settings, integrations, and sending booking forms", () => {
    assert.equal(isCmsOperator({ role: "admin" }), true)
    assert.equal(isCmsOperator({ role: "finance" }), true)
    assert.equal(isCmsOperator({ role: "sales" }), false)
    assert.equal(hasCmsPermission({ role: "finance" }, "finance.manage"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "inventory.view"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "inventory.manage"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "inventory.adjust"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "inventory.hold"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "deals.view"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "deals.manage"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "accounts.manage"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "operations.view"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "operations.manage"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "pricing.manage"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "settings.manage"), false)
    assert.equal(hasCmsPermission({ role: "finance" }, "users.manage"), false)
    assert.equal(hasCmsPermission({ role: "finance" }, "integrations.manage"), false)
  })

  it("allows sales to manage deals but not stock overrides", () => {
    assert.equal(hasCmsPermission({ role: "sales" }, "deals.manage"), true)
    assert.equal(hasCmsPermission({ role: "sales" }, "accounts.manage"), true)
    assert.equal(hasCmsPermission({ role: "sales" }, "inventory.hold"), true)
    assert.equal(hasCmsPermission({ role: "sales" }, "operations.manage"), true)
    assert.equal(hasCmsPermission({ role: "sales" }, "inventory.adjust"), false)
    assert.equal(hasCmsPermission({ role: "sales" }, "integrations.manage"), false)
  })

  it("lets sales and finance prepare booking forms, finance and admin countersign, and only admin send them", () => {
    assert.equal(canPrepareNativeBookingForm({ role: "admin" }), true)
    assert.equal(canPrepareNativeBookingForm({ role: "sales" }), true)
    assert.equal(canPrepareNativeBookingForm({ role: "finance" }), true)
    assert.equal(canPrepareNativeBookingForm({ role: "agent" }), false)
    assert.equal(canSendNativeBookingForm({ role: "admin" }), true)
    assert.equal(canSendNativeBookingForm({ role: "sales" }), false)
    assert.equal(canSendNativeBookingForm({ role: "finance" }), false)
    assert.equal(canSendNativeBookingForm({ role: "agent" }), false)
    assert.equal(canSignNativeBookingForm({ role: "admin" }), true)
    assert.equal(canSignNativeBookingForm({ role: "finance" }), true)
    assert.equal(canSignNativeBookingForm({ role: "sales" }), false)
    assert.equal(canSignNativeBookingForm({ role: "agent" }), false)
  })

  it("grants finance operations and owner eligibility in SQL as well as the app", () => {
    const sql = readFileSync("supabase/migrations/20260903140000_finance_owner_and_operations.sql", "utf8")
    assert.match(sql, /p\.role = 'finance'/)
    assert.match(sql, /'deals.manage'/)
    assert.match(sql, /'accounts.manage'/)
    assert.match(sql, /'operations.manage'/)
    assert.match(sql, /p\.role in \('admin', 'finance', 'sales'\)/)
    assert.doesNotMatch(sql, /'settings.manage'/)
  })

  it("includes finance in CMS owner dropdowns", () => {
    const leads = readFileSync("lib/crm/leads.ts", "utf8")
    assert.match(leads, /CMS_STAFF_ROLES/)
    assert.doesNotMatch(leads, /\["admin", "sales"\]/)
  })

  it("lets finance countersign and manage stock in SQL without sending booking forms or opening Settings", () => {
    const sql = readFileSync("supabase/migrations/20260904120000_finance_sign_and_inventory.sql", "utf8")
    assert.match(sql, /create or replace function public\.is_cms_operator/)
    assert.match(sql, /p\.role in \('admin', 'finance'\)/)
    assert.match(sql, /admin_send_native_booking_form/)
    assert.match(sql, /purchase_orders_admin_all/)
    assert.match(sql, /package_cost_layers_select_admin/)
    assert.match(sql, /replace\(def, 'public\.is_admin\(\)', 'public\.is_cms_operator\(\)'\)/)
    assert.doesNotMatch(sql, /'settings.manage'/)
    const actions = readFileSync("app/(admin)/admin/deals/booking-form-actions.ts", "utf8")
    assert.match(actions, /canSignNativeBookingForm/)
    assert.match(actions, /canSendNativeBookingForm/)
    const panel = readFileSync("app/(admin)/admin/deals/booking-form-panel.tsx", "utf8")
    assert.match(panel, /currentCanSign \? \(/)
    assert.match(panel, /currentCanSend \? \(/)
    assert.match(panel, /canSend=\{currentCanSend\}/)
  })
})

describe("dashboard booking-form approval links", () => {
  it("opens the deal when only one form is waiting for ZK signature", () => {
    assert.equal(
      bookingFormsAwaitingApprovalHref(["deal-1", "deal-1"]),
      "/admin/deals/deal-1",
    )
  })

  it("filters the pipeline when more than one deal is waiting", () => {
    assert.equal(
      bookingFormsAwaitingApprovalHref(["deal-1", "deal-2"]),
      "/admin/deals?pipeline=awaiting_approval",
    )
    assert.equal(bookingFormsAwaitingApprovalHref([]), "/admin/deals?pipeline=awaiting_approval")
  })
})
