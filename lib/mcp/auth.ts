import type { SupabaseClient } from "@supabase/supabase-js"
import { bearerTokenFromHeader, hashMcpApiKey, mapMcpApiKeyRow } from "@/lib/mcp/keys"
import type { McpApiKey } from "@/lib/mcp/types"

export type McpAuthResult =
  | { ok: true; key: McpApiKey }
  | { ok: false; status: 401; message: string }

export async function authenticateMcpRequest(
  admin: SupabaseClient,
  request: Request,
): Promise<McpAuthResult> {
  const token = bearerTokenFromHeader(request.headers.get("authorization"))
  if (!token) {
    return {
      ok: false,
      status: 401,
      message: "Missing Authorization Bearer API key. Create a key in Settings → MCP keys.",
    }
  }

  const keyHash = hashMcpApiKey(token)
  const { data, error } = await admin
    .from("mcp_api_keys")
    .select("id, name, role, key_prefix, revoked_at")
    .eq("key_hash", keyHash)
    .maybeSingle()

  if (error) {
    return { ok: false, status: 401, message: "Could not verify the API key. Try again." }
  }
  if (!data || data.revoked_at) {
    return { ok: false, status: 401, message: "Invalid or revoked API key." }
  }

  const key = mapMcpApiKeyRow(data)
  if (!key) {
    return { ok: false, status: 401, message: "Invalid or revoked API key." }
  }

  void admin
    .from("mcp_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", key.id)
    .then(() => undefined, () => undefined)

  return { ok: true, key }
}
