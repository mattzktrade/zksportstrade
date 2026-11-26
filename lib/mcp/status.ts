import { canonicalDealStage, dealStageIsUnsignedPipeline } from "@/lib/crm/deal-types"
import { MCP_DEAL_STATUSES, type McpDealStatus } from "@/lib/mcp/types"

const MCP_STATUS_TO_STAGE: Record<McpDealStatus, string> = {
  draft: "draft",
  negotiating: "proposal",
  lost: "closed_lost",
}

const STAGE_TO_MCP: Record<string, McpDealStatus> = {
  draft: "draft",
  sourcing: "negotiating",
  proposal: "negotiating",
  closed_lost: "lost",
}

export function isMcpDealStatus(value: string): value is McpDealStatus {
  return (MCP_DEAL_STATUSES as readonly string[]).includes(value)
}

/** CRM stages that match an MCP list filter (draft / negotiating / lost). */
export function crmStagesForMcpStatus(status: string): string[] | null {
  const value = status.trim().toLowerCase()
  if (value === "draft") return ["draft"]
  if (value === "negotiating") return ["sourcing", "proposal"]
  if (value === "lost") return ["closed_lost"]
  if (value) return [canonicalDealStage(value)]
  return null
}

export function mcpStatusFromCrmStage(stage: string | null | undefined): string {
  const canonical = canonicalDealStage(stage ?? "draft")
  return STAGE_TO_MCP[canonical] ?? canonical
}

export function crmStageForMcpStatus(status: McpDealStatus): string {
  return MCP_STATUS_TO_STAGE[status]
}

export function enquiryStageForMcpStatus(status: McpDealStatus): string | null {
  if (status === "draft") return "new"
  if (status === "negotiating") return "follow_up"
  if (status === "lost") return "not_interested"
  return null
}

export function canAssistantUpdateDealStage(stage: string | null | undefined): boolean {
  return dealStageIsUnsignedPipeline(canonicalDealStage(stage ?? "draft"))
}
