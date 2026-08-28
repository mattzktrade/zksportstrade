import assert from "node:assert/strict"
import test from "node:test"
import { resolveXeroRedirectUri } from "../lib/integrations/xero/config"

test("Xero OAuth redirect prefers an explicit redirect URI", () => {
  assert.equal(
    resolveXeroRedirectUri("https://evil.example", {
      redirectUri: "https://www.zk-sports.trade/api/integrations/xero/callback",
      siteUrl: "https://www.zk-sports.trade",
    }),
    "https://www.zk-sports.trade/api/integrations/xero/callback",
  )
})

test("Xero OAuth redirect prefers the site URL over the request origin", () => {
  assert.equal(
    resolveXeroRedirectUri("https://evil.example", {
      siteUrl: "https://www.zk-sports.trade/",
    }),
    "https://www.zk-sports.trade/api/integrations/xero/callback",
  )
})

test("Xero OAuth redirect can still use the request origin locally", () => {
  assert.equal(
    resolveXeroRedirectUri("http://localhost:3000", {}),
    "http://localhost:3000/api/integrations/xero/callback",
  )
})
