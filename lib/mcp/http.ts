import { checkRateLimit } from "@/lib/auth/rate-limit"
import { requireMcpAdminClient } from "@/lib/mcp/admin-client"
import { authenticateMcpRequest } from "@/lib/mcp/auth"
import { MCP_RATE_LIMIT_PER_MINUTE, mcpCallsInLastMinute, writeMcpAuditLog } from "@/lib/mcp/audit"
import {
  handleMcpJsonRpc,
  isJsonRpcNotification,
  MCP_DEFAULT_PROTOCOL_VERSION,
  type JsonRpcRequest,
} from "@/lib/mcp/protocol"
import { mcpEndpointUrl } from "@/lib/mcp/urls"

const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*zk-sports\.trade$|^https?:\/\/localhost(?::\d+)?$/i

export function mcpAllowedOrigin(origin: string | null): string | null {
  const value = origin?.trim() ?? ""
  if (!value) return null
  if (ALLOWED_ORIGIN.test(value)) return value
  return null
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = mcpAllowedOrigin(request.headers.get("origin"))
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    "MCP-Protocol-Version": MCP_DEFAULT_PROTOCOL_VERSION,
  }
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin
    headers["Access-Control-Allow-Headers"] =
      "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, mcp-session-id"
    headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
    headers["Access-Control-Expose-Headers"] = "Mcp-Session-Id, MCP-Protocol-Version"
    headers.Vary = "Origin"
  }
  return headers
}

function jsonResponse(request: Request, status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: corsHeaders(request),
  })
}

export function mcpOptionsResponse(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}

export function mcpGetResponse(request: Request): Response {
  const accept = request.headers.get("accept") ?? ""
  if (accept.includes("text/event-stream")) {
    return new Response(": connected\n\n", {
      status: 200,
      headers: {
        ...corsHeaders(request),
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
      },
    })
  }
  return jsonResponse(request, 405, {
    error: "This MCP server is Streamable HTTP over POST. Open a JSON-RPC session with POST.",
    endpoint: mcpEndpointUrl(),
  })
}

export function mcpDeleteResponse(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}

export async function handleMcpPost(request: Request): Promise<Response> {
  const origin = request.headers.get("origin")
  if (origin && !mcpAllowedOrigin(origin)) {
    return jsonResponse(request, 403, { error: "Forbidden origin." })
  }

  let admin
  try {
    admin = requireMcpAdminClient()
  } catch (error) {
    return jsonResponse(request, 503, {
      error: error instanceof Error ? error.message : "MCP is not configured.",
    })
  }

  const auth = await authenticateMcpRequest(admin, request)
  if (!auth.ok) {
    return jsonResponse(request, auth.status, { error: auth.message })
  }

  const memoryOk = checkRateLimit(`mcp:${auth.key.id}`, MCP_RATE_LIMIT_PER_MINUTE, 60_000)
  const recent = await mcpCallsInLastMinute(admin, auth.key.id)
  if (!memoryOk || recent >= MCP_RATE_LIMIT_PER_MINUTE) {
    await writeMcpAuditLog(admin, {
      key: auth.key,
      toolName: "_rate_limited",
      args: {},
      error: "Rate limit exceeded: 60 calls per minute per key.",
      durationMs: 0,
    })
    return jsonResponse(request, 429, {
      error: "Rate limit exceeded. This key may call 60 tools per minute. Wait and retry.",
    })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return jsonResponse(request, 400, {
      jsonrpc: "2.0",
      error: { code: -32700, message: "Invalid JSON body." },
      id: null,
    })
  }

  const messages: JsonRpcRequest[] = Array.isArray(payload) ? payload : [payload as JsonRpcRequest]
  if (messages.length === 0) {
    return jsonResponse(request, 400, {
      jsonrpc: "2.0",
      error: { code: -32600, message: "Empty JSON-RPC batch." },
      id: null,
    })
  }

  const onlyNotifications = messages.every(isJsonRpcNotification)
  const responses = []
  for (const message of messages) {
    const result = await handleMcpJsonRpc(message, { admin, key: auth.key })
    if (result) responses.push(result)
  }

  if (onlyNotifications || responses.length === 0) {
    return new Response(null, { status: 202, headers: corsHeaders(request) })
  }

  const body = Array.isArray(payload) ? responses : responses[0]
  return jsonResponse(request, 200, body)
}
