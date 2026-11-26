export const MCP_KEY_ROLES = ["read_only", "sales_agent"] as const
export type McpKeyRole = (typeof MCP_KEY_ROLES)[number]

export const MCP_WRITE_TOOLS = [
  "create_or_update_contact",
  "log_activity",
  "create_deal",
  "create_booking_form",
  "update_deal_status",
] as const

export type McpWriteTool = (typeof MCP_WRITE_TOOLS)[number]

export const MCP_READ_TOOLS = [
  "list_products",
  "get_product",
  "search_faqs",
  "search_contacts",
  "get_contact",
  "list_deals",
  "get_deal",
] as const

export type McpReadTool = (typeof MCP_READ_TOOLS)[number]

export const MCP_TOOL_NAMES = [...MCP_READ_TOOLS, ...MCP_WRITE_TOOLS] as const
export type McpToolName = (typeof MCP_TOOL_NAMES)[number]

export const MCP_ACTIVITY_TYPES = ["email_sent", "reply", "call", "note"] as const
export type McpActivityType = (typeof MCP_ACTIVITY_TYPES)[number]

export const MCP_DEAL_STATUSES = ["draft", "negotiating", "lost"] as const
export type McpDealStatus = (typeof MCP_DEAL_STATUSES)[number]

export const MCP_CONTACT_SOURCES = [
  "manual",
  "website",
  "referral",
  "marketing",
  "other",
  "whatsapp",
  "email",
  "portal",
  "assistant",
] as const
export type McpContactSource = (typeof MCP_CONTACT_SOURCES)[number]

export type McpApiKey = {
  id: string
  name: string
  role: McpKeyRole
  keyPrefix: string
}

export type JsonSchemaProperty = {
  type: "string" | "number" | "integer" | "boolean"
  description: string
  enum?: readonly string[]
  minimum?: number
  maximum?: number
  minLength?: number
}

export type JsonSchema = {
  type: "object"
  properties: Record<string, JsonSchemaProperty>
  required?: readonly string[]
  additionalProperties: false
}

export type McpToolDefinition = {
  name: McpToolName
  description: string
  inputSchema: JsonSchema
  role: "read" | "write"
}

export type McpAuthContext = {
  key: McpApiKey
}

export class McpToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "McpToolError"
  }
}

export function isMcpKeyRole(value: string | null | undefined): value is McpKeyRole {
  return value === "read_only" || value === "sales_agent"
}

export function isMcpWriteTool(name: string): name is McpWriteTool {
  return (MCP_WRITE_TOOLS as readonly string[]).includes(name)
}

export function isMcpToolName(name: string): name is McpToolName {
  return (MCP_TOOL_NAMES as readonly string[]).includes(name)
}

export function mcpRoleLabel(role: McpKeyRole): string {
  return role === "sales_agent" ? "Sales agent" : "Read-only"
}
