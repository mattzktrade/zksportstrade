import assert from "node:assert/strict"
import test from "node:test"
import { rememberTtl } from "../lib/server/ttl-cache"

test("rememberTtl returns the cached value within the ttl and shares in-flight loads", async () => {
  let loads = 0
  const key = `ttl-test-${Date.now()}`
  const load = async () => {
    loads += 1
    await new Promise((resolve) => setTimeout(resolve, 20))
    return loads
  }
  const [first, second] = await Promise.all([rememberTtl(key, 5_000, load), rememberTtl(key, 5_000, load)])
  assert.equal(first, 1)
  assert.equal(second, 1)
  assert.equal(await rememberTtl(key, 5_000, load), 1)
  assert.equal(loads, 1)
})
