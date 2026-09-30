import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import {
  planLinkedDayCoverage,
  type LinkedDayCoverageLine,
} from "../lib/inventory/linked-day-coverage"

const weekend = {
  friday: ["friday"],
  saturday: ["saturday"],
  sunday: ["sunday"],
  twoDay: ["saturday", "sunday"],
  threeDay: ["friday", "saturday", "sunday"],
} as const

function line(
  id: string,
  quantity: number,
  days: readonly string[],
  olderFirst: number,
): LinkedDayCoverageLine {
  return {
    id,
    quantity,
    olderFirst,
    slots: days.map((slot) => ({ slot, units: 1 })),
  }
}

function covered(
  result: ReturnType<typeof planLinkedDayCoverage>,
  id: string,
): number {
  return result.find((row) => row.id === id)?.covered ?? -1
}

test("monaco club suite leaves the extra friday place uncovered and keeps the 3-day", () => {
  // 22 purchased seats. 14 three-day + 9 friday = 23 friday places.
  // Saturday and Sunday are 14 + 8 = 22, so they are exact.
  const lines = [
    line("your-way-3day", 11, weekend.threeDay, 1),
    line("vip-3day", 2, weekend.threeDay, 2),
    line("peter-3day", 1, weekend.threeDay, 3),
    line("earlier-friday", 2, weekend.friday, 4),
    line("chris-friday", 1, weekend.friday, 5),
    line("harrison-friday", 2, weekend.friday, 6),
    line("staff-friday", 4, weekend.friday, 7),
    line("saturday", 8, weekend.saturday, 8),
    line("sunday", 8, weekend.sunday, 9),
  ]
  const result = planLinkedDayCoverage(lines, {
    friday: 22,
    saturday: 22,
    sunday: 22,
  })

  assert.equal(covered(result, "your-way-3day"), 11)
  assert.equal(covered(result, "vip-3day"), 2)
  assert.equal(covered(result, "peter-3day"), 1)
  assert.equal(covered(result, "chris-friday"), 0)
  assert.equal(covered(result, "earlier-friday"), 2)
  assert.equal(covered(result, "harrison-friday"), 2)
  assert.equal(covered(result, "staff-friday"), 4)
  assert.equal(covered(result, "saturday"), 8)
  assert.equal(covered(result, "sunday"), 8)
})

test("the newest friday sale of the extra size is the one left uncovered", () => {
  const lines = [
    line("three-day", 2, weekend.threeDay, 1),
    line("older-friday", 1, weekend.friday, 2),
    line("newer-friday", 1, weekend.friday, 3),
  ]
  const result = planLinkedDayCoverage(lines, {
    friday: 3,
    saturday: 3,
    sunday: 3,
  })
  assert.equal(covered(result, "three-day"), 2)
  assert.equal(covered(result, "older-friday"), 1)
  assert.equal(covered(result, "newer-friday"), 0)
})

test("house 44 keeps saturday covered and leaves the newer friday place uncovered", () => {
  // 14 purchased. 11 three-day + 4 friday = 15. Saturday and Sunday are exact.
  const lines = [
    line("three-day", 11, weekend.threeDay, 1),
    line("edge-friday", 1, weekend.friday, 2),
    line("ma-friday", 2, weekend.friday, 3),
    line("bg-friday", 1, weekend.friday, 4),
    line("other-saturday", 2, weekend.saturday, 5),
    line("p1-saturday", 1, weekend.saturday, 6),
    line("sunday", 3, weekend.sunday, 7),
  ]
  const result = planLinkedDayCoverage(lines, {
    friday: 14,
    saturday: 14,
    sunday: 14,
  })

  assert.equal(covered(result, "three-day"), 11)
  assert.equal(covered(result, "edge-friday"), 1)
  assert.equal(covered(result, "ma-friday"), 2)
  assert.equal(covered(result, "bg-friday"), 0)
  assert.equal(covered(result, "other-saturday"), 2)
  assert.equal(covered(result, "p1-saturday"), 1)
  assert.equal(covered(result, "sunday"), 3)
})

test("a larger friday booking stays whole when a single matching sale can take the shortage", () => {
  const lines = [
    line("older-four", 4, weekend.friday, 1),
    line("mid-five", 5, weekend.friday, 2),
    line("newest-two", 2, weekend.friday, 3),
  ]
  const result = planLinkedDayCoverage(lines, { friday: 6 })
  assert.equal(covered(result, "older-four"), 4)
  assert.equal(covered(result, "mid-five"), 0)
  assert.equal(covered(result, "newest-two"), 2)
})

test("the newest sale is short by the extra places when no whole sale matches that extra", () => {
  const lines = [
    line("older", 4, weekend.friday, 1),
    line("newer", 3, weekend.friday, 2),
  ]
  const result = planLinkedDayCoverage(lines, { friday: 5 })
  assert.equal(covered(result, "older"), 4)
  assert.equal(covered(result, "newer"), 1)
})

test("two-day sales are kept ahead of single saturday sales", () => {
  const lines = [
    line("sat-sun", 3, weekend.twoDay, 1),
    line("saturday-one", 1, weekend.saturday, 2),
    line("saturday-two", 2, weekend.saturday, 3),
  ]
  const result = planLinkedDayCoverage(lines, { saturday: 5, sunday: 5 })
  assert.equal(covered(result, "sat-sun"), 3)
  assert.equal(covered(result, "saturday-two"), 2)
  assert.equal(covered(result, "saturday-one"), 0)
})

test("a three-day sale is the shortage only when three-day demand itself exceeds the purchase", () => {
  const lines = [
    line("older-3day", 2, weekend.threeDay, 1),
    line("newer-3day", 1, weekend.threeDay, 2),
    line("friday", 1, weekend.friday, 3),
  ]
  const result = planLinkedDayCoverage(lines, {
    friday: 2,
    saturday: 2,
    sunday: 2,
  })
  assert.equal(covered(result, "older-3day"), 2)
  assert.equal(covered(result, "newer-3day"), 0)
  assert.equal(covered(result, "friday"), 0)
})

test("trackside yacht keeps every 3-day and leaves the sunday sale uncovered", () => {
  // 20 purchased seats, 5 already pinned to older 3-day deals.
  // Flexible pool is 15. Flexible demand is 14 three-day + 1 two-day + 1 friday + 2 sunday.
  // Sunday is the only day over, by those 2 sunday places.
  const lines = [
    line("three-older", 8, weekend.threeDay, 1),
    line("three-mid", 2, weekend.threeDay, 2),
    line("three-newest", 4, weekend.threeDay, 3),
    line("two-day", 1, weekend.twoDay, 4),
    line("friday", 1, weekend.friday, 5),
    line("sunday", 2, weekend.sunday, 6),
  ]
  const result = planLinkedDayCoverage(lines, {
    friday: 15,
    saturday: 15,
    sunday: 15,
  })
  assert.equal(covered(result, "three-older"), 8)
  assert.equal(covered(result, "three-mid"), 2)
  assert.equal(covered(result, "three-newest"), 4)
  assert.equal(covered(result, "two-day"), 1)
  assert.equal(covered(result, "friday"), 1)
  assert.equal(covered(result, "sunday"), 0)
})

test("exact day totals cover every sale", () => {
  const lines = [
    line("three-day", 4, weekend.threeDay, 1),
    line("friday", 1, weekend.friday, 2),
    line("saturday", 1, weekend.saturday, 3),
  ]
  const result = planLinkedDayCoverage(lines, {
    friday: 5,
    saturday: 5,
    sunday: 4,
  })
  assert.equal(covered(result, "three-day"), 4)
  assert.equal(covered(result, "friday"), 1)
  assert.equal(covered(result, "saturday"), 1)
})

const migration = readFileSync(
  "supabase/migrations/20260930160000_enquiry_create_skips_weekend_repack.sql",
  "utf8",
)

test("signed deals are repacked from shared day totals, not first-come order", () => {
  assert.match(migration, /inventory_rebalance_linked_day_coverage/)
  assert.match(migration, /order by day_count desc, older_first, id/)
  assert.match(migration, /flexible_qty = v_excess/)
  assert.match(migration, /order by older_first desc, id desc/)
  assert.match(
    migration,
    /perform public\.inventory_rebalance_linked_day_coverage\(v_line\.package_id\)/,
  )
  assert.match(migration, /where line\.id is not null/)
  assert.match(migration, /if v_released > 0 then/)
  assert.doesNotMatch(migration, /v_try := v_available/)
})
