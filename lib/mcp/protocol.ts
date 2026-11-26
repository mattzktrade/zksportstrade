import type { SupabaseClient } from "@supabase/supabase-js"
import { writeMcpAuditLog } from "@/lib/mcp/audit"
import { executeMcpTool, mcpToolsForRole } from "@/lib/mcp/tools"
import { McpToolError, type McpApiKey } from "@/lib/mcp/types"

export const MCP_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"] as const
export const MCP_DEFAULT_PROTOCOL_VERSION = "2025-03-26"

export const MCP_SERVER_INFO = {
  name: "zk-sports-crm",
  title: "ZK Sports CRM",
  version: "1.0.0",
}

export const MCP_INSTRUCTIONS =
  "You are connected to the ZK Sports CRM. Use read tools for live stock, product copy, FAQs, contacts, and deals. Write tools need a sales-agent key. Never invent prices, inclusions, itineraries, or on-ground contacts. create_deal fails if quantity exceeds sellable stock or the price is below the configured floor. create_booking_form only submits a draft to directors — never send a booking form, never countersign, and never approve it yourself. There are no delete tools."

type JsonRpcId = string | number | null

export type JsonRpcRequest = {
  jsonrpc?: unknown
  id?: JsonRpcId
  method?: unknown
  params?: unknown
}

export type JsonRpcResponse = {
  jsonrpc: "2.0"
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export function isJsonRpcNotification(message: JsonRpcRequest): boolean {
  return typeof message.method === "string" && (message.id === undefined || message.id === null)
}

function jsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

function jsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result }
}

function negotiateProtocolVersion(requested: unknown): string {
  if (typeof requested === "string" && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
    return requested
  }
  return MCP_DEFAULT_PROTOCOL_VERSION
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export async function handleMcpJsonRpc(
  message: JsonRpcRequest,
  ctx: { admin: SupabaseClient; key: McpApiKey },
): Promise<JsonRpcResponse | null> {
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return jsonRpcError(message.id ?? null, -32600, "Invalid JSON-RPC request. Expected jsonrpc 2.0 and a method.")
  }

  const id = (message.id ?? null) as JsonRpcId
  const method = message.method
  const params = asRecord(message.params)

  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return null
  }

  if (method === "ping") {
    return jsonRpcResult(id, {})
  }

  if (method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: negotiateProtocolVersion(params.protocolVersion),
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false },
        prompts: { listChanged: false },
      },
      serverInfo: MCP_SERVER_INFO,
      instructions: MCP_INSTRUCTIONS,
    })
  }

  if (method === "tools/list") {
    const tools = mcpToolsForRole(ctx.key.role).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }))
    return jsonRpcResult(id, { tools })
  }

  if (method === "resources/list") {
    return jsonRpcResult(id, { resources: [] })
  }

  if (method === "prompts/list") {
    return jsonRpcResult(id, { prompts: [] })
  }

  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : ""
    const args = params.arguments
    const started = Date.now()
    try {
      const result = await executeMcpTool(ctx.admin, ctx.key, name, args)
      await writeMcpAuditLog(ctx.admin, {
        key: ctx.key,
        toolName: name || "unknown",
        args,
        result,
        durationMs: Date.now() - started,
      })
      return jsonRpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        isError: false,
      })
    } catch (error) {
      const messageText =
        error instanceof McpToolError
          ? error.message
          : error instanceof Error
            ? error.message
            : "The tool failed."
      await writeMcpAuditLog(ctx.admin, {
        key: ctx.key,
        toolName: name || "unknown",
        args,
        error: messageText,
        durationMs: Date.now() - started,
      })
      return jsonRpcResult(id, {
        content: [{ type: "text", text: messageText }],
        isError: true,
      })
    }
  }

  return jsonRpcError(id, -32601, `Method not found: ${method}.`)
}
