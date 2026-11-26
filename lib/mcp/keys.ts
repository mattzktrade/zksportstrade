import { createHash, randomBytes } from "crypto"
import type { McpApiKey, McpKeyRole } from "@/lib/mcp/types"
import { isMcpKeyRole } from "@/lib/mcp/types"

export const MCP_KEY_TOKEN_PREFIX = "zkmcp_"

export function generateMcpApiKey(): string {
  return `${MCP_KEY_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`
}

export function hashMcpApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex")
}

export function mcpKeyPrefix(key: string): string {
  return key.slice(0, 12)
}

export function looksLikeMcpApiKey(value: string): boolean {
  return value.startsWith(MCP_KEY_TOKEN_PREFIX) && value.length >= MCP_KEY_TOKEN_PREFIX.length + 32
}

export function bearerTokenFromHeader(header: string | null | undefined): string | null {
  const raw = header?.trim() ?? ""
  if (!raw) return null
  const match = /^Bearer\s+(\S+)/i.exec(raw)
  return match?.[1]?.trim() || null
}

export function mapMcpApiKeyRow(row: {
  id: string
  name: string
  role: string
  key_prefix: string
}): McpApiKey | null {
  if (!isMcpKeyRole(row.role)) return null
  return {
    id: String(row.id),
    name: String(row.name),
    role: row.role as McpKeyRole,
    keyPrefix: String(row.key_prefix),
  }
}
