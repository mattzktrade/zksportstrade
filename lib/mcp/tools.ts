import type { SupabaseClient } from "@supabase/supabase-js"
import { mcpCreateBookingForm } from "@/lib/mcp/booking-form"
import {
  mcpCreateOrUpdateContact,
  mcpGetContact,
  mcpLogActivity,
  mcpSearchContacts,
} from "@/lib/mcp/contacts"
import { mcpCreateDeal, mcpGetDeal, mcpListDeals, mcpUpdateDealStatus } from "@/lib/mcp/deals"
import { mcpSearchFaqs } from "@/lib/mcp/faqs"
import { mcpGetProduct, mcpListProducts } from "@/lib/mcp/products"
import { boolArg, numberArg, parseToolArguments, stringArg } from "@/lib/mcp/schema"
import {
  isMcpToolName,
  isMcpWriteTool,
  MCP_ACTIVITY_TYPES,
  MCP_CONTACT_SOURCES,
  MCP_DEAL_STATUSES,
  McpToolError,
  type McpApiKey,
  type McpToolDefinition,
  type McpToolName,
} from "@/lib/mcp/types"

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: "list_products",
    role: "read",
    description:
      "List sellable hospitality packages. Optional race filter (event name or id). Set available_only to true to hide sold-out products. Returns id, race, venue, date, package name, price, currency, quantity_available, and a short inclusions summary. Do not invent prices or inclusions.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        race: { type: "string", description: "Event name or race id to filter by, for example Singapore or abu-dhabi-2026." },
        available_only: { type: "boolean", description: "If true, only return products with sellable stock greater than zero." },
      },
    },
  },
  {
    name: "get_product",
    role: "read",
    description:
      "Load one package by id: description, inclusions, FAQs, ZK ticketing terms, media URLs, brochure URLs, price, and sellable quantity. Never invent itineraries, partner logos, on-ground contacts, or prices.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string", description: "Package id from list_products." },
      },
    },
  },
  {
    name: "search_faqs",
    role: "read",
    description:
      "Search company knowledge articles and product FAQs. Returns matching Q&A with ids. Use this before answering policy, dress code, inclusions, or how-to questions.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Natural-language question or keywords.", minLength: 2 },
      },
    },
  },
  {
    name: "search_contacts",
    role: "read",
    description: "Search CRM contacts by name, email, phone, or company. Returns up to 25 matches with ids.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Name, email, phone, or company.", minLength: 2 },
      },
    },
  },
  {
    name: "get_contact",
    role: "read",
    description: "Load one CRM contact by id, including company, email, phone, title, LinkedIn, source, and notes.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string", description: "Contact UUID from search_contacts or create_or_update_contact." },
      },
    },
  },
  {
    name: "list_deals",
    role: "read",
    description:
      "List recent deals. Optional status filter: draft, negotiating (CRM proposal/sourcing), or lost (closed_lost). Optional owner filter by person name or profile id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "string",
          description: "draft, negotiating, lost, or a CRM stage name.",
        },
        owner: { type: "string", description: "Owner name or profile UUID." },
      },
    },
  },
  {
    name: "get_deal",
    role: "read",
    description: "Load one deal by id, including contact, lines, amounts, CRM stage, and recent activity.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string", description: "Deal UUID." },
      },
    },
  },
  {
    name: "create_or_update_contact",
    role: "write",
    description:
      "Create a contact or update the existing one with the same email. Always search first when possible. Company is required and is used to find or create the CRM account.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "email", "company", "title", "source"],
      properties: {
        name: { type: "string", description: "Full name." },
        email: { type: "string", description: "Unique email used to dedupe." },
        company: { type: "string", description: "Company or account name." },
        title: { type: "string", description: "Job title." },
        phone: { type: "string", description: "Phone number with country code when known." },
        linkedin: { type: "string", description: "https LinkedIn profile URL." },
        source: {
          type: "string",
          description: "How we met them.",
          enum: MCP_CONTACT_SOURCES,
        },
        notes: { type: "string", description: "Free-text notes to store on the contact." },
      },
    },
  },
  {
    name: "log_activity",
    role: "write",
    description:
      "Record an email sent, reply, call, or note against a contact. Also copies the note onto open deals for that contact.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["contact_id", "type", "summary", "timestamp"],
      properties: {
        contact_id: { type: "string", description: "Contact UUID." },
        type: { type: "string", description: "Activity type.", enum: MCP_ACTIVITY_TYPES },
        summary: { type: "string", description: "What happened, in one or two sentences." },
        timestamp: { type: "string", description: "ISO-8601 timestamp, for example 2026-11-26T10:00:00Z." },
      },
    },
  },
  {
    name: "create_deal",
    role: "write",
    description:
      "Create a draft deal for a contact and product. Fails if quantity exceeds sellable stock or agreed_price is below the admin-configured floor. Does not hold stock and does not send a booking form.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["contact_id", "product_id", "quantity", "agreed_price"],
      properties: {
        contact_id: { type: "string", description: "Contact UUID." },
        product_id: { type: "string", description: "Package id from list_products." },
        quantity: { type: "integer", description: "Number of places.", minimum: 1 },
        agreed_price: { type: "number", description: "Unit sale price in the package currency.", minimum: 0 },
        notes: { type: "string", description: "Internal deal notes." },
      },
    },
  },
  {
    name: "create_booking_form",
    role: "write",
    description:
      "Prepare the native booking form for a deal and send it to the directors (Ollie and Michel) for approval. The assistant must never email the form to the client, never send it for signature, and never countersign. Stock is not reserved until an admin sends it.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["deal_id"],
      properties: {
        deal_id: { type: "string", description: "Deal UUID." },
      },
    },
  },
  {
    name: "update_deal_status",
    role: "write",
    description:
      "Set an open pipeline deal to draft, negotiating, or lost. Cannot change signed, paid, or cancelled deals. Cannot approve, send, or delete anything.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["deal_id", "status"],
      properties: {
        deal_id: { type: "string", description: "Deal UUID." },
        status: { type: "string", description: "draft, negotiating, or lost.", enum: MCP_DEAL_STATUSES },
      },
    },
  },
]

export function mcpToolsForRole(role: McpApiKey["role"]): McpToolDefinition[] {
  if (role === "sales_agent") return MCP_TOOL_DEFINITIONS
  return MCP_TOOL_DEFINITIONS.filter((tool) => tool.role === "read")
}

export async function executeMcpTool(
  admin: SupabaseClient,
  key: McpApiKey,
  name: string,
  rawArgs: unknown,
): Promise<unknown> {
  if (!isMcpToolName(name)) {
    throw new McpToolError(`Unknown tool: ${name}. Call tools/list for the supported tools.`)
  }
  if (isMcpWriteTool(name) && key.role !== "sales_agent") {
    throw new McpToolError(
      "This API key is read-only. Use a sales-agent key to create contacts, log activity, or change deals.",
    )
  }
  const definition = MCP_TOOL_DEFINITIONS.find((tool) => tool.name === name)
  if (!definition) throw new McpToolError(`Unknown tool: ${name}.`)
  const parsed = parseToolArguments(definition.inputSchema, rawArgs)
  if (!parsed.ok) throw new McpToolError(parsed.error)
  const args = parsed.value
  return runTool(admin, key, name, args)
}

async function runTool(
  admin: SupabaseClient,
  key: McpApiKey,
  name: McpToolName,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "list_products":
      return mcpListProducts(admin, {
        race: stringArg(args, "race"),
        availableOnly: boolArg(args, "available_only") === true,
      })
    case "get_product":
      return mcpGetProduct(admin, stringArg(args, "id") ?? "")
    case "search_faqs":
      return mcpSearchFaqs(admin, stringArg(args, "query") ?? "")
    case "search_contacts":
      return mcpSearchContacts(admin, stringArg(args, "query") ?? "")
    case "get_contact":
      return mcpGetContact(admin, stringArg(args, "id") ?? "")
    case "list_deals":
      return mcpListDeals(admin, {
        status: stringArg(args, "status"),
        owner: stringArg(args, "owner"),
      })
    case "get_deal":
      return mcpGetDeal(admin, stringArg(args, "id") ?? "")
    case "create_or_update_contact":
      return mcpCreateOrUpdateContact(admin, {
        name: stringArg(args, "name") ?? "",
        email: stringArg(args, "email") ?? "",
        company: stringArg(args, "company") ?? "",
        title: stringArg(args, "title") ?? "",
        source: stringArg(args, "source") ?? "",
        phone: stringArg(args, "phone"),
        linkedin: stringArg(args, "linkedin"),
        notes: stringArg(args, "notes"),
      })
    case "log_activity":
      return mcpLogActivity(admin, key, {
        contactId: stringArg(args, "contact_id") ?? "",
        type: stringArg(args, "type") ?? "",
        summary: stringArg(args, "summary") ?? "",
        timestamp: stringArg(args, "timestamp") ?? "",
      })
    case "create_deal":
      return mcpCreateDeal(admin, key, {
        contactId: stringArg(args, "contact_id") ?? "",
        productId: stringArg(args, "product_id") ?? "",
        quantity: numberArg(args, "quantity") ?? 0,
        agreedPrice: numberArg(args, "agreed_price") ?? -1,
        notes: stringArg(args, "notes"),
      })
    case "create_booking_form":
      return mcpCreateBookingForm(admin, key, stringArg(args, "deal_id") ?? "")
    case "update_deal_status":
      return mcpUpdateDealStatus(admin, key, {
        dealId: stringArg(args, "deal_id") ?? "",
        status: stringArg(args, "status") ?? "",
      })
    default:
      throw new McpToolError(`Unknown tool: ${name}.`)
  }
}
