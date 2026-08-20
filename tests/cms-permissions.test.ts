import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { hasCmsPermission, isCmsStaff } from "../lib/auth/permissions"

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

  it("limits finance to finance and read-only inventory/deals", () => {
    assert.equal(hasCmsPermission({ role: "finance" }, "finance.manage"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "inventory.view"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "deals.view"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "operations.view"), true)
    assert.equal(hasCmsPermission({ role: "finance" }, "operations.manage"), false)
    assert.equal(hasCmsPermission({ role: "finance" }, "inventory.adjust"), false)
    assert.equal(hasCmsPermission({ role: "finance" }, "deals.manage"), false)
  })

  it("allows sales to manage deals but not stock overrides", () => {
    assert.equal(hasCmsPermission({ role: "sales" }, "deals.manage"), true)
    assert.equal(hasCmsPermission({ role: "sales" }, "accounts.manage"), true)
    assert.equal(hasCmsPermission({ role: "sales" }, "inventory.hold"), true)
    assert.equal(hasCmsPermission({ role: "sales" }, "operations.manage"), true)
    assert.equal(hasCmsPermission({ role: "sales" }, "inventory.adjust"), false)
    assert.equal(hasCmsPermission({ role: "sales" }, "integrations.manage"), false)
  })
})
