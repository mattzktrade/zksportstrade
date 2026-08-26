import assert from "node:assert/strict"
import test from "node:test"
import {
  allocateCostByDay,
  costDaySlotsForDuration,
  deriveTradePriceDayWeights,
  normalizeDayValues,
  targetDaySlotCapacity,
  targetLayerRemaining,
  validateManualDayPercentages,
} from "../lib/inventory/day-cost-allocation"

test("selects standard and Thursday-start weekend slots", () => {
  assert.deepEqual(costDaySlotsForDuration("3_day", "2026-12-06"), [
    "friday_only",
    "saturday_only",
    "sunday_only",
  ])
  assert.deepEqual(costDaySlotsForDuration("3_day", "2026-11-21"), [
    "thursday_only",
    "friday_only",
    "saturday_only",
  ])
  assert.deepEqual(costDaySlotsForDuration("2_day", "2026-11-21"), [
    "friday_only",
    "saturday_only",
  ])
})

test("keeps purchased quantity separate from target day-slot capacity", () => {
  assert.equal(
    targetDaySlotCapacity(
      10,
      { friday: 10, saturday: 10, sunday: 10 },
      ["friday", "saturday", "sunday"],
    ),
    10,
  )
  assert.equal(
    targetDaySlotCapacity(
      10,
      { friday: 10, saturday: 8, sunday: 8 },
      ["saturday", "sunday"],
    ),
    8,
  )
  assert.equal(
    targetDaySlotCapacity(
      10,
      { friday: 10, saturday: 10 },
      ["friday", "saturday", "sunday"],
    ),
    10,
  )
})

test("linked layer remaining uses the busiest required day, not summed day sales", () => {
  const components = [
    { day_slot: "friday", quantity_remaining: 10, units_per_package: 1 },
    { day_slot: "saturday", quantity_remaining: 6, units_per_package: 1 },
    { day_slot: "sunday", quantity_remaining: 6, units_per_package: 1 },
  ]
  assert.equal(
    targetLayerRemaining({
      fallbackRemaining: 2,
      duration: "3_day",
      eventDate: "2026-07-05",
      components,
    }),
    6,
  )
  assert.equal(
    targetLayerRemaining({
      fallbackRemaining: 2,
      duration: "friday_only",
      eventDate: "2026-07-05",
      components,
    }),
    10,
  )
  assert.equal(
    targetLayerRemaining({
      fallbackRemaining: 2,
      duration: "2_day",
      eventDate: "2026-07-05",
      components,
    }),
    6,
  )
})

test("normalizes relative trade prices to exactly one", () => {
  const weights = normalizeDayValues([
    { key: "fri", value: 10 },
    { key: "sat", value: 35 },
    { key: "sun", value: 50 },
  ])
  assert.equal(weights.fri, 0.105263158)
  assert.equal(weights.sat, 0.368421053)
  assert.equal(weights.fri + weights.sat + weights.sun, 1)
})

test("derives included day weights from linked trade prices", () => {
  const result = deriveTradePriceDayWeights({
    sourceDuration: "2_day",
    eventDate: "2026-12-06",
    members: [
      { packageId: "sat", duration: "saturday_only", tradePrice: 3_500 },
      { packageId: "sun", duration: "sunday_only", tradePrice: 5_000 },
      { packageId: "fri", duration: "friday_only", tradePrice: 1_000 },
    ],
  })
  assert.equal(result.status, "derived")
  assert.deepEqual(result.rows.map((row) => row.day), ["saturday_only", "sunday_only"])
  assert.equal(result.rows.reduce((sum, row) => sum + (row.weight ?? 0), 0), 1)
})

test("reports every missing or non-positive included day price", () => {
  const result = deriveTradePriceDayWeights({
    sourceDuration: "3_day",
    eventDate: "2026-11-21",
    members: [
      { packageId: "thu", duration: "thursday_only", tradePrice: 1_000 },
      { packageId: "fri", duration: "friday_only", tradePrice: 0 },
    ],
  })
  assert.equal(result.status, "setup_required")
  assert.deepEqual(result.missingDays, ["friday_only", "saturday_only"])
})

test("manual percentages must total exactly 100 percent", () => {
  const valid = validateManualDayPercentages(
    ["friday_only", "saturday_only", "sunday_only"],
    {
      friday_only: "10.5263",
      saturday_only: "36.8421",
      sunday_only: "52.6316",
    },
  )
  assert.equal(valid.ok, true)
  if (valid.ok) {
    assert.equal(
      valid.weights.friday_only + valid.weights.saturday_only + valid.weights.sunday_only,
      1,
    )
  }

  const invalid = validateManualDayPercentages(
    ["saturday_only", "sunday_only"],
    { saturday_only: "49.99", sunday_only: "50" },
  )
  assert.equal(invalid.ok, false)
  if (!invalid.ok) assert.match(invalid.message, /currently 99\.99%/)
})

test("cost allocation preserves the exact rounded parent amount", () => {
  const split = allocateCostByDay(10_000.01, [
    { day: "friday_only", weight: 0.105263158 },
    { day: "saturday_only", weight: 0.368421053 },
    { day: "sunday_only", weight: 0.526315789 },
  ])
  assert.equal(split.friday_only + split.saturday_only + split.sunday_only, 10_000.01)
})
