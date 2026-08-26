import assert from "node:assert/strict"
import test from "node:test"
import { chunkList, fetchAllRows } from "../lib/supabase/fetch-all-rows"

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
