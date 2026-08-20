import assert from "node:assert/strict"
import test from "node:test"
import { uniqueEventOptions } from "../lib/admin/workflow-event-filter"

test("future event dropdown omits past dates and keeps upcoming and undated events", () => {
  const options = uniqueEventOptions(
    [
      { eventDate: "2020-06-28", eventPackage: "2020 Austrian Grand Prix" },
      { eventDate: "2099-12-06", eventPackage: "2099 Abu Dhabi Grand Prix" },
      { eventDate: null, eventPackage: "Product not mapped" },
    ],
    "future",
  )
  assert.equal(
    options.some((option) => option.label.includes("2020 Austrian Grand Prix")),
    false,
  )
  assert.equal(
    options.some((option) => option.label.includes("2099 Abu Dhabi Grand Prix")),
    true,
  )
  assert.equal(options.some((option) => option.label.includes("Product not mapped")), true)
})

test("all-dates event dropdown still includes past events after upcoming ones", () => {
  const options = uniqueEventOptions(
    [
      { eventDate: "2020-06-28", eventPackage: "2020 Austrian Grand Prix" },
      { eventDate: "2099-12-06", eventPackage: "2099 Abu Dhabi Grand Prix" },
    ],
    "all",
  )
  assert.equal(options[0]?.label.includes("2099 Abu Dhabi Grand Prix"), true)
  assert.equal(options.at(-1)?.label.includes("2020 Austrian Grand Prix"), true)
})
