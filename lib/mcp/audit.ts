import type { SupabaseClient } from "@supabase/supabase-js"
import type { McpApiKey } from "@/lib/mcp/types"

const MAX_JSON_CHARS = 8_000

function clipJson(value: unknown): unknown {
  try {
    const text = JSON.stringify(value)
    if (!text) return value
    if (text.length <= MAX_JSON_CHARS) return value
    return { truncated: true, preview: text.slice(0, MAX_JSON_CHARS) }
  } catch {
    return { error: "Could not serialise value for audit." }
  }
}

export async function writeMcpAuditLog(
  admin: SupabaseClient,
  input: {
    key: McpApiKey
    toolName: string
    args: unknown
    result?: unknown
    error?: string | null
    durationMs: number
  },
): Promise<void> {
  const { error } = await admin.from("mcp_audit_log").insert({
    api_key_id: input.key.id,
    key_name: input.key.name,
    key_role: input.key.role,
    tool_name: input.toolName,
    arguments: clipJson(input.args ?? {}),
    result: input.error ? null : clipJson(input.result ?? null),
    error: input.error?.slice(0, 2000) ?? null,
    duration_ms: Math.max(0, Math.round(input.durationMs)),
  })
  if (error) {
    console.error("[mcp] audit log failed:", error.message)
  }
}

export const MCP_RATE_LIMIT_PER_MINUTE = 60

export async function mcpCallsInLastMinute(
  admin: SupabaseClient,
  apiKeyId: string,
): Promise<number> {
  const since = new Date(Date.now() - 60_000).toISOString()
  const { count, error } = await admin
    .from("mcp_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("api_key_id", apiKeyId)
    .gte("created_at", since)
  if (error) {
    console.error("[mcp] rate-limit count failed:", error.message)
    return 0
  }
  return count ?? 0
}
