import assert from "node:assert/strict"
import { test } from "node:test"
import {
  consumeDayCapacity,
  daySlotsForDuration,
  releaseDayCapacity,
  sellableFromDayCapacity,
} from "../lib/inventory/day-capacity"
import {
  computeNativeAvailability,
  isSupplierQuoteFresh,
} from "../lib/inventory/native-availability"

test("3-day / 2-day / day products map onto shared day slots", () => {
  assert.deepEqual(daySlotsForDuration("3_day"), ["friday", "saturday", "sunday"])
  assert.deepEqual(daySlotsForDuration("2_day"), ["saturday", "sunday"])
  assert.deepEqual(daySlotsForDuration("friday_only"), ["friday"])
  assert.deepEqual(daySlotsForDuration("sunday_only"), ["sunday"])
})

test("shared pool sellable is the min of required day capacity", () => {
  const owned = { friday: 10, saturday: 8, sunday: 12 }
  assert.equal(sellableFromDayCapacity(owned, daySlotsForDuration("3_day")), 8)
  assert.equal(sellableFromDayCapacity(owned, daySlotsForDuration("2_day")), 8)
  assert.equal(sellableFromDayCapacity(owned, daySlotsForDuration("friday_only")), 10)
})

test("selling a friday-only product leaves other days available", () => {
  const owned = { friday: 10, saturday: 10, sunday: 10 }
  const afterFriday = consumeDayCapacity(owned, daySlotsForDuration("friday_only"), 3)
  assert.ok(afterFriday)
  assert.equal(afterFriday.friday, 7)
  assert.equal(afterFriday.saturday, 10)
  assert.equal(afterFriday.sunday, 10)
  assert.equal(sellableFromDayCapacity(afterFriday, daySlotsForDuration("3_day")), 7)
  assert.equal(sellableFromDayCapacity(afterFriday, daySlotsForDuration("2_day")), 10)
})

test("selling a 2-day product reduces saturday and sunday only", () => {
  const owned = { friday: 10, saturday: 10, sunday: 10 }
  const after = consumeDayCapacity(owned, daySlotsForDuration("2_day"), 4)
  assert.ok(after)
  assert.equal(after.friday, 10)
  assert.equal(after.saturday, 6)
  assert.equal(after.sunday, 6)
  assert.equal(sellableFromDayCapacity(after, daySlotsForDuration("3_day")), 6)
})

test("insufficient day capacity rejects the consume", () => {
  const owned = { friday: 2, saturday: 2, sunday: 2 }
  assert.equal(consumeDayCapacity(owned, daySlotsForDuration("3_day"), 3), null)
})

test("releasing capacity restores day slots", () => {
  const owned = { friday: 5, saturday: 5, sunday: 5 }
  const afterSale = consumeDayCapacity(owned, daySlotsForDuration("friday_only"), 2)
  assert.ok(afterSale)
  const restored = releaseDayCapacity(afterSale, daySlotsForDuration("friday_only"), 2)
  assert.equal(restored.friday, 5)
})

test("native availability floors storefront sellable at zero", () => {
  const result = computeNativeAvailability({
    ownedStock: 10,
    committedOrders: 8,
    activeManualHolds: 1,
    activeDealReservations: 3,
    openShortageQty: 5,
  })
  assert.equal(result.rawAvailable, -2)
  assert.equal(result.sellable, 0)
  assert.equal(result.openShortageQty, 5)
})

test("supplier quote freshness requires a timestamp within 24 hours", () => {
  const now = new Date("2026-08-11T15:00:00.000Z")
  assert.equal(isSupplierQuoteFresh("2026-08-11T10:00:00.000Z", now), true)
  assert.equal(isSupplierQuoteFresh("2026-08-10T14:59:00.000Z", now), false)
  assert.equal(isSupplierQuoteFresh(null, now), false)
})
