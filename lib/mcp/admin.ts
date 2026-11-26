import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { isMcpKeyRole, mcpRoleLabel, type McpKeyRole } from "@/lib/mcp/types"
import { DEFAULT_MCP_DEAL_PRICE_FLOOR } from "@/lib/mcp/settings"
import { mcpEndpointUrl } from "@/lib/mcp/urls"

export type McpAdminKeyRow = {
  id: string
  name: string
  role: McpKeyRole
  roleLabel: string
  keyPrefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export type McpAuditRow = {
  id: string
  createdAt: string
  keyName: string
  keyRole: string
  toolName: string
  arguments: unknown
  result: unknown
  error: string | null
  durationMs: number | null
}

export type McpAdminPageData = {
  endpointUrl: string
  dealPriceFloor: number
  keys: McpAdminKeyRow[]
  audit: McpAuditRow[]
}

export async function loadMcpAdminPage(): Promise<McpAdminPageData> {
  noStore()
  const supabase = await createClient()
  const [{ data: settings }, { data: keys }, { data: audit }] = await Promise.all([
    supabase.from("mcp_settings").select("deal_price_floor").eq("id", "default").maybeSingle(),
    supabase
      .from("mcp_api_keys")
      .select("id, name, role, key_prefix, created_at, last_used_at, revoked_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("mcp_audit_log")
      .select("id, created_at, key_name, key_role, tool_name, arguments, result, error, duration_ms")
      .order("created_at", { ascending: false })
      .limit(200),
  ])

  const floor = Number(settings?.deal_price_floor)
  return {
    endpointUrl: mcpEndpointUrl(),
    dealPriceFloor: Number.isFinite(floor) && floor >= 0 ? floor : DEFAULT_MCP_DEAL_PRICE_FLOOR,
    keys: (keys ?? []).flatMap((row) => {
      if (!isMcpKeyRole(row.role)) return []
      return [
        {
          id: String(row.id),
          name: String(row.name),
          role: row.role,
          roleLabel: mcpRoleLabel(row.role),
          keyPrefix: String(row.key_prefix),
          createdAt: String(row.created_at),
          lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
          revokedAt: row.revoked_at ? String(row.revoked_at) : null,
        },
      ]
    }),
    audit: (audit ?? []).map((row) => ({
      id: String(row.id),
      createdAt: String(row.created_at),
      keyName: String(row.key_name),
      keyRole: String(row.key_role),
      toolName: String(row.tool_name),
      arguments: row.arguments,
      result: row.result,
      error: row.error ? String(row.error) : null,
      durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    })),
  }
}
