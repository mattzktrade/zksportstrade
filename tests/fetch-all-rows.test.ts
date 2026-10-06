import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { chunkList, fetchAllRows, isTransientPostgrestError, mapChunks, withRequestGate } from "../lib/supabase/fetch-all-rows"

test("fetchAllRows returns an empty list when the first page is empty", async () => {
  const { data, error } = await fetchAllRows(async () => ({ data: [], error: null }))
  assert.equal(error, null)
  assert.deepEqual(data, [])
})

test("fetchAllRows walks past the 1000-row PostgREST cap", async () => {
  const all = Array.from({ length: 2350 }, (_, i) => i)
  const requested: Array<[number, number]> = []
  const { data, error } = await fetchAllRows(async (from, to) => {
    requested.push([from, to])
    return { data: all.slice(from, to + 1), error: null }
  })
  assert.equal(error, null)
  assert.equal(data.length, 2350)
  assert.deepEqual(requested, [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ])
})

test("fetchAllRows treats an unsatisfiable later range as the end", async () => {
  const { data, error } = await fetchAllRows(async (from) => {
    if (from === 0) return { data: Array.from({ length: 1000 }, (_, i) => i), error: null }
    return { data: null, error: { message: "Requested range not satisfiable", code: "PGRST103" } }
  })
  assert.equal(error, null)
  assert.equal(data.length, 1000)
})

test("fetchAllRows surfaces a real error on the first page", async () => {
  const { data, error } = await fetchAllRows(async () => ({
    data: null,
    error: { message: "permission denied", code: "42501" },
  }))
  assert.equal(data.length, 0)
  assert.equal(error?.message, "permission denied")
})

test("chunkList splits ids for filtered follow-up queries", () => {
  assert.deepEqual(chunkList([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(chunkList([], 200), [])
})

test("mapChunks runs a few chunks at a time and keeps order", async () => {
  const seen: number[] = []
  const started: number[] = []
  const results = await mapChunks(
    [1, 2, 3, 4, 5],
    2,
    async (chunk, index) => {
      started.push(index)
      await new Promise((resolve) => setTimeout(resolve, 20 - index * 5))
      seen.push(index)
      return chunk.reduce((sum, value) => sum + value, 0)
    },
    2,
  )
  assert.deepEqual(results, [3, 7, 5])
  assert.deepEqual(started, [0, 1, 2])
  assert.ok(seen[0] === 0 || seen[0] === 1)
  assert.deepEqual(
    await mapChunks([] as number[], 80, async () => 1),
    [],
  )
})

test("treats supabase fetch failed as a transient PostgREST error", () => {
  assert.equal(isTransientPostgrestError({ message: "TypeError: fetch failed" }), true)
  assert.equal(isTransientPostgrestError({ message: "permission denied" }), false)
  assert.equal(isTransientPostgrestError(null), false)
})

test("withRequestGate never runs more than six jobs at once", async () => {
  let current = 0
  let peak = 0
  await Promise.all(
    Array.from({ length: 20 }, () =>
      withRequestGate(async () => {
        current += 1
        peak = Math.max(peak, current)
        await new Promise((resolve) => setTimeout(resolve, 15))
        current -= 1
      }),
    ),
  )
  assert.ok(peak <= 6, `peak concurrency was ${peak}`)
  assert.ok(peak >= 2)
})

test("admin workflow id filters stay small enough for PostgREST GET URLs", () => {
  const workflow = readFileSync("lib/admin/workflow-views.ts", "utf8")
  const bookings = readFileSync("lib/admin/operations-bookings.ts", "utf8")
  assert.match(workflow, /POSTGREST_IN_FILTER_SIZE/)
  assert.match(bookings, /POSTGREST_IN_FILTER_SIZE/)
  assert.doesNotMatch(workflow, /const size = 400/)
  assert.doesNotMatch(bookings, /const size = 400/)
})
