import assert from "node:assert/strict"
import test from "node:test"
import {
  adminSearchTextMatches,
  searchAdminProductOptions,
} from "../lib/admin/option-search"

function singaporeCatalog() {
  const eventName = "2026 Singapore Grand Prix"
  const names = [
    "3 Day Champions Club",
    "3 Day F1 Experiences Paddock Club",
    "3 Day Paddock Club & 4 nights in a 5* Hotel",
    "3 Day Paddock Club - Clubhouse",
    "3 Day Sky Suite",
    "3 Days Velocity Terrace",
    "Friday Velocity Terrace",
    "Saturday Velocity Terrace",
    "Saturday & Sunday Velocity Terrace",
    "Sunday Velocity Terrace",
  ]
  return names.map((packageName, index) => ({
    id: `sg-${index}`,
    label: `${eventName} — ${packageName}`,
    eventName,
    packageName,
  }))
}

test("singapore search keeps saturday and sunday velocity terrace after the old 8-result cap", () => {
  const matches = searchAdminProductOptions(singaporeCatalog(), "singapore")
  assert.equal(matches.length, 10)
  assert.ok(matches.some((option) => option.packageName === "Saturday Velocity Terrace"))
  assert.ok(matches.some((option) => option.packageName === "Sunday Velocity Terrace"))
  assert.ok(matches.some((option) => option.packageName === "Saturday & Sunday Velocity Terrace"))
})

test("split words still match when they are not a consecutive substring", () => {
  const matches = searchAdminProductOptions(singaporeCatalog(), "singapore saturday")
  assert.deepEqual(
    matches.map((option) => option.packageName).sort(),
    ["Saturday & Sunday Velocity Terrace", "Saturday Velocity Terrace"],
  )
  assert.equal(
    adminSearchTextMatches(
      "2026 Singapore Grand Prix — Saturday Velocity Terrace",
      "saturday singapore",
    ),
    true,
  )
  assert.equal(
    adminSearchTextMatches(
      "2026 Singapore Grand Prix — Saturday Velocity Terrace",
      "singapore saturday",
    ),
    true,
  )
})

test("empty query does not open product matches", () => {
  assert.deepEqual(searchAdminProductOptions(singaporeCatalog(), "   "), [])
})

test("unrelated events stay out of a singapore search", () => {
  const matches = searchAdminProductOptions(
    [
      ...singaporeCatalog(),
      {
        id: "monaco",
        label: "2026 Monaco Grand Prix — Saturday Velocity Terrace",
        eventName: "2026 Monaco Grand Prix",
        packageName: "Saturday Velocity Terrace",
      },
    ],
    "singapore",
  )
  assert.equal(matches.some((option) => option.id === "monaco"), false)
})
