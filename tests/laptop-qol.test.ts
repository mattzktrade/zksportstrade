import assert from "node:assert/strict"
import test from "node:test"
import {
  filterByQuery,
  isModifiedClick,
  shouldIgnoreCommandK,
  usesAppleModifier,
} from "../lib/browser/laptop-qol"

test("usesAppleModifier detects Mac and iOS user agents", () => {
  assert.equal(
    usesAppleModifier({
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    }),
    true,
  )
  assert.equal(
    usesAppleModifier({
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
    }),
    false,
  )
  assert.equal(
    usesAppleModifier({
      platform: "iPhone",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    }),
    true,
  )
})

test("isModifiedClick treats cmd, ctrl, and middle-click as modified", () => {
  assert.equal(isModifiedClick({ metaKey: true, ctrlKey: false }), true)
  assert.equal(isModifiedClick({ metaKey: false, ctrlKey: true }), true)
  assert.equal(isModifiedClick({ metaKey: false, ctrlKey: false, button: 1 }), true)
  assert.equal(isModifiedClick({ metaKey: false, ctrlKey: false, button: 0 }), false)
})

test("filterByQuery matches label, href, and keywords", () => {
  const items = [
    { label: "Deals", href: "/admin/deals", keywords: "pipeline crm" },
    { label: "Accounts", href: "/admin/leads", keywords: "clients companies" },
  ]
  assert.equal(filterByQuery(items, "").length, 2)
  assert.equal(filterByQuery(items, "deal")[0]?.label, "Deals")
  assert.equal(filterByQuery(items, "crm")[0]?.label, "Deals")
  assert.equal(filterByQuery(items, "leads")[0]?.label, "Accounts")
  assert.equal(filterByQuery(items, "zzzz").length, 0)
})

test("shouldIgnoreCommandK does not steal from empty targets", () => {
  assert.equal(shouldIgnoreCommandK(null), false)
})
