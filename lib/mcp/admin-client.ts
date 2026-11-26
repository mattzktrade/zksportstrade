import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { McpToolError } from "@/lib/mcp/types"

export function requireMcpAdminClient(): SupabaseClient {
  const admin = createAdminClient()
  if (!admin) {
    throw new McpToolError(
      "The CRM MCP server is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    )
  }
  return admin
}
