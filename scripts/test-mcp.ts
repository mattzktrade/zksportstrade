/**
 * Calls every MCP tool over Streamable HTTP.
 *
 * Without env vars this talks to a local server:
 *   npx tsx scripts/test-mcp.ts
 *
 * Live:
 *   MCP_URL=https://zk-sports.trade/mcp MCP_API_KEY=zkmcp_… npx tsx scripts/test-mcp.ts
 */
import { MCP_TOOL_DEFINITIONS } from "../lib/mcp/tools"

const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  list_products: { available_only: false },
  get_product: { id: "missing-product-id" },
  search_faqs: { query: "dress code" },
  search_contacts: { query: "zk" },
  get_contact: { id: "00000000-0000-4000-8000-000000000000" },
  list_deals: { status: "draft" },
  get_deal: { id: "00000000-0000-4000-8000-000000000000" },
  create_or_update_contact: {
    name: "MCP Test Contact",
    email: "mcp-test@example.invalid",
    company: "MCP Test Co",
    title: "Buyer",
    source: "assistant",
    notes: "Created by scripts/test-mcp.ts",
  },
  log_activity: {
    contact_id: "00000000-0000-4000-8000-000000000000",
    type: "note",
    summary: "MCP test note",
    timestamp: new Date().toISOString(),
  },
  create_deal: {
    contact_id: "00000000-0000-4000-8000-000000000000",
    product_id: "missing-product-id",
    quantity: 1,
    agreed_price: 1,
  },
  create_booking_form: { deal_id: "00000000-0000-4000-8000-000000000000" },
  update_deal_status: {
    deal_id: "00000000-0000-4000-8000-000000000000",
    status: "negotiating",
  },
}

async function rpc(
  url: string,
  key: string,
  method: string,
  params?: unknown,
  id: number = 1,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-03-26",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  })
  const text = await response.text()
  let body: unknown = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: response.status, body }
}

function print(title: string, status: number, body: unknown) {
  console.log(`\n== ${title} (${status}) ==`)
  console.log(typeof body === "string" ? body : JSON.stringify(body, null, 2))
}

async function main() {
  const url = (process.env.MCP_URL ?? "http://localhost:3000/mcp").replace(/\/$/, "")
  const key = process.env.MCP_API_KEY?.trim() ?? ""
  if (!key) {
    console.error("Set MCP_API_KEY to a key created in Settings → MCP keys.")
    console.error("Example: MCP_URL=http://localhost:3000/mcp MCP_API_KEY=zkmcp_… npx tsx scripts/test-mcp.ts")
    process.exit(1)
  }

  const unauthorized = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} }),
  })
  print("no bearer token", unauthorized.status, await unauthorized.json().catch(() => null))
  if (unauthorized.status !== 401) {
    throw new Error("Expected 401 without a key.")
  }

  const init = await rpc(url, key, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "zk-mcp-test", version: "1.0.0" },
  })
  print("initialize", init.status, init.body)

  const listed = await rpc(url, key, "tools/list", {}, 2)
  print("tools/list", listed.status, listed.body)

  const listedBody = listed.body as { result?: { tools?: Array<{ name: string }> } }
  const names = (listedBody.result?.tools ?? []).map((tool) => tool.name)
  const expected = MCP_TOOL_DEFINITIONS.map((tool) => tool.name)
  const missing = expected.filter((name) => !names.includes(name) && SAMPLE_ARGS[name])
  if (missing.length && names.length) {
    console.log(`\n(tools missing from this key’s list, likely read-only: ${missing.join(", ")})`)
  }

  let id = 10
  for (const tool of MCP_TOOL_DEFINITIONS) {
    const args = SAMPLE_ARGS[tool.name] ?? {}
    const result = await rpc(url, key, "tools/call", { name: tool.name, arguments: args }, id)
    id += 1
    print(`tools/call ${tool.name}`, result.status, result.body)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
