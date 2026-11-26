import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { bearerTokenFromHeader, generateMcpApiKey, hashMcpApiKey, mcpKeyPrefix } from "../lib/mcp/keys"
import { handleMcpJsonRpc } from "../lib/mcp/protocol"
import { parseToolArguments } from "../lib/mcp/schema"
import {
  canAssistantUpdateDealStage,
  crmStageForMcpStatus,
  crmStagesForMcpStatus,
  mcpStatusFromCrmStage,
} from "../lib/mcp/status"
import { MCP_RATE_LIMIT_PER_MINUTE } from "../lib/mcp/audit"
import { MCP_TOOL_DEFINITIONS, executeMcpTool, mcpToolsForRole } from "../lib/mcp/tools"
import { MCP_WRITE_TOOLS, McpToolError } from "../lib/mcp/types"
import { mcpAllowedOrigin } from "../lib/mcp/http"
import { isMcpPath, isPublicApiPath, isSessionlessApiPath } from "../lib/supabase/session-guard"
import { searchHelp } from "../lib/admin/help-guide"

const readOnlyKey = {
  id: "key-1",
  name: "Reader",
  role: "read_only" as const,
  keyPrefix: "zkmcp_abc",
}

const salesKey = {
  ...readOnlyKey,
  role: "sales_agent" as const,
  name: "Grok Bot",
}

describe("MCP keys", () => {
  it("hashes keys and never returns the same digest for different secrets", () => {
    const a = generateMcpApiKey()
    const b = generateMcpApiKey()
    assert.match(a, /^zkmcp_[0-9a-f]{64}$/)
    assert.equal(hashMcpApiKey(a).length, 64)
    assert.notEqual(hashMcpApiKey(a), hashMcpApiKey(b))
    assert.equal(mcpKeyPrefix(a).length, 12)
  })

  it("reads a Bearer token and ignores other schemes", () => {
    assert.equal(bearerTokenFromHeader("Bearer secret-key"), "secret-key")
    assert.equal(bearerTokenFromHeader("bearer secret-key"), "secret-key")
    assert.equal(bearerTokenFromHeader("Basic secret-key"), null)
    assert.equal(bearerTokenFromHeader(""), null)
  })
})

describe("MCP tools", () => {
  it("exposes every requested tool and no delete tools", () => {
    const names = MCP_TOOL_DEFINITIONS.map((tool) => tool.name)
    assert.deepEqual(names, [
      "list_products",
      "get_product",
      "search_faqs",
      "search_contacts",
      "get_contact",
      "list_deals",
      "get_deal",
      "create_or_update_contact",
      "log_activity",
      "create_deal",
      "create_booking_form",
      "update_deal_status",
    ])
    assert.equal(names.some((name) => name.includes("delete")), false)
    assert.deepEqual([...MCP_WRITE_TOOLS], [
      "create_or_update_contact",
      "log_activity",
      "create_deal",
      "create_booking_form",
      "update_deal_status",
    ])
  })

  it("hides write tools from read-only keys", () => {
    const read = mcpToolsForRole("read_only").map((tool) => tool.name)
    const write = mcpToolsForRole("sales_agent").map((tool) => tool.name)
    assert.equal(read.includes("list_products"), true)
    assert.equal(read.includes("create_deal"), false)
    assert.equal(write.includes("create_deal"), true)
  })

  it("rejects write tools on a read-only key before touching the database", async () => {
    await assert.rejects(
      () =>
        executeMcpTool({} as never, readOnlyKey, "create_deal", {
          contact_id: "00000000-0000-4000-8000-000000000000",
          product_id: "pkg",
          quantity: 1,
          agreed_price: 10,
        }),
      (error: unknown) => error instanceof McpToolError && /read-only/i.test(error.message),
    )
  })

  it("validates JSON-schema inputs with clear messages", () => {
    const schema = MCP_TOOL_DEFINITIONS.find((tool) => tool.name === "create_deal")!.inputSchema
    const missing = parseToolArguments(schema, {})
    assert.equal(missing.ok, false)
    if (!missing.ok) assert.match(missing.error, /contact_id/)
    const ok = parseToolArguments(schema, {
      contact_id: "abc",
      product_id: "pkg",
      quantity: "2",
      agreed_price: "1500",
    })
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.equal(ok.value.quantity, 2)
      assert.equal(ok.value.agreed_price, 1500)
    }
  })
})

describe("MCP deal status mapping", () => {
  it("maps assistant statuses onto CRM stages", () => {
    assert.equal(crmStageForMcpStatus("draft"), "draft")
    assert.equal(crmStageForMcpStatus("negotiating"), "proposal")
    assert.equal(crmStageForMcpStatus("lost"), "closed_lost")
    assert.deepEqual(crmStagesForMcpStatus("negotiating"), ["sourcing", "proposal"])
    assert.equal(mcpStatusFromCrmStage("proposal"), "negotiating")
    assert.equal(mcpStatusFromCrmStage("closed_lost"), "lost")
  })

  it("blocks signed and paid deals from assistant status changes", () => {
    assert.equal(canAssistantUpdateDealStage("draft"), true)
    assert.equal(canAssistantUpdateDealStage("proposal"), true)
    assert.equal(canAssistantUpdateDealStage("awaiting_booking_form_send"), true)
    assert.equal(canAssistantUpdateDealStage("signed"), false)
    assert.equal(canAssistantUpdateDealStage("paid_confirmed"), false)
    assert.equal(canAssistantUpdateDealStage("cancelled"), false)
  })
})

describe("MCP protocol", () => {
  it("initializes and lists tools without a database round-trip", async () => {
    const init = await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", clientInfo: { name: "test", version: "1" } },
      },
      { admin: {} as never, key: salesKey },
    )
    assert.ok(init)
    assert.equal(init!.result && (init!.result as { protocolVersion: string }).protocolVersion, "2025-03-26")

    const listed = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { admin: {} as never, key: readOnlyKey },
    )
    const tools = (listed!.result as { tools: Array<{ name: string }> }).tools
    assert.equal(tools.some((tool) => tool.name === "list_products"), true)
    assert.equal(tools.some((tool) => tool.name === "create_deal"), false)
  })

  it("returns a JSON-RPC error for unknown methods and 202-style null for notifications", async () => {
    const unknown = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 3, method: "nope", params: {} },
      { admin: {} as never, key: salesKey },
    )
    assert.equal(unknown!.error?.code, -32601)
    const note = await handleMcpJsonRpc(
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      { admin: {} as never, key: salesKey },
    )
    assert.equal(note, null)
  })

  it("returns isError tool results the assistant can read", async () => {
    const result = await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "not_a_tool", arguments: {} },
      },
      { admin: { from: () => ({ insert: async () => ({ error: null }) }) } as never, key: salesKey },
    )
    const body = result!.result as { isError: boolean; content: Array<{ text: string }> }
    assert.equal(body.isError, true)
    assert.match(body.content[0].text, /Unknown tool/)
  })
})

describe("MCP HTTP safety", () => {
  it("treats /mcp as a public sessionless path", () => {
    assert.equal(isMcpPath("/mcp"), true)
    assert.equal(isSessionlessApiPath("/mcp"), true)
    assert.equal(isPublicApiPath("/mcp"), true)
    assert.equal(isSessionlessApiPath("/admin/mcp"), false)
  })

  it("rate-limits at 60 calls per minute", () => {
    assert.equal(MCP_RATE_LIMIT_PER_MINUTE, 60)
  })

  it("allows the production origin and localhost, and rejects others", () => {
    assert.equal(mcpAllowedOrigin("https://zk-sports.trade"), "https://zk-sports.trade")
    assert.equal(mcpAllowedOrigin("http://localhost:3000"), "http://localhost:3000")
    assert.equal(mcpAllowedOrigin("https://evil.example"), null)
  })
})

describe("MCP wiring", () => {
  it("serves Streamable HTTP from app/mcp/route.ts", () => {
    const route = readFileSync("app/mcp/route.ts", "utf8")
    assert.match(route, /handleMcpPost/)
    assert.match(route, /export async function POST/)
    assert.match(route, /export async function GET/)
    assert.equal(existsSync("docs/MCP.md"), true)
    assert.equal(existsSync("scripts/test-mcp.ts"), true)
  })

  it("stores keys hashed and never as plaintext", () => {
    const sql = readFileSync("supabase/migrations/20261126120000_mcp_server.sql", "utf8")
    assert.match(sql, /create table if not exists public\.mcp_api_keys/)
    assert.match(sql, /key_hash text not null/)
    assert.match(sql, /mcp_audit_log/)
    assert.doesNotMatch(sql, /plaintext|raw_key|secret_key text/)
    const actions = readFileSync("app/(admin)/admin/mcp/actions.ts", "utf8")
    assert.match(actions, /hashMcpApiKey/)
    assert.match(actions, /revoked_at/)
  })

  it("booking-form tool notifies directors and never sends or signs", () => {
    const source = readFileSync("lib/mcp/booking-form.ts", "utf8")
    assert.match(source, /sendBookingFormReadyToSendNotification/)
    assert.doesNotMatch(source, /sendNativeBookingFormEmail/)
    assert.doesNotMatch(source, /admin_send_native_booking_form/)
    assert.doesNotMatch(source, /signNativeBookingForm/)
    assert.match(source, /sent_to_client: false/)
  })

  it("help explains how to connect Grok Bot", () => {
    const found = searchHelp("Grok Bot")
    assert.ok(found.questions.some((item) => /Grok Bot/i.test(item.q)))
    assert.ok(found.questions.some((item) => /MCP keys/i.test(item.a)))
  })
})
