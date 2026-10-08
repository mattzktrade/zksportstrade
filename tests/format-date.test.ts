import assert from "node:assert/strict"
import test from "node:test"
import { formatShortDate } from "../lib/format/date"

test("formatShortDate accepts date-only and ISO timestamps", () => {
  assert.match(formatShortDate("2026-10-08"), /Oct 2026/)
  assert.match(formatShortDate("2026-10-08T12:34:56.000Z"), /Oct 2026/)
  assert.notEqual(formatShortDate("2026-10-08T12:34:56.000Z"), "Invalid Date")
  assert.equal(formatShortDate("not a date"), "—")
  assert.equal(formatShortDate(null), "—")
  assert.equal(formatShortDate(""), "—")
})
