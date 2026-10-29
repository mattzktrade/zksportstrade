import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildAgentApprovedHtml } from "../lib/email/send-agent-approved"

describe("buildAgentApprovedHtml", () => {
  it("links to the portal sign-in page and names the account", () => {
    const html = buildAgentApprovedHtml({
      agentEmail: "alex@apex.travel",
      agentName: "Alex",
      companyName: "Apex Travel",
      siteOrigin: "https://zk-sports.trade",
    })
    assert.match(html, /href="https:\/\/zk-sports\.trade\/login"/)
    assert.match(html, /alex@apex\.travel/)
    assert.match(html, /Apex Travel/)
  })

  it("escapes agent-entered names and omits an empty company", () => {
    const html = buildAgentApprovedHtml({
      agentEmail: "a@b.co",
      agentName: "<script>x</script>",
      companyName: "  ",
      siteOrigin: "https://zk-sports.trade",
    })
    assert.doesNotMatch(html, /<script>x<\/script>/)
    assert.match(html, /&lt;script&gt;/)
    assert.doesNotMatch(html, / for <strong>/)
  })
})
