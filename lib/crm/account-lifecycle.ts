import type { AccountKind } from "@/lib/crm/account-kinds"
import { DEAL_SOLD_STAGES } from "@/lib/crm/deal-types"

export const ACCOUNT_LIFECYCLES = ["lead", "client"] as const
export type AccountLifecycle = (typeof ACCOUNT_LIFECYCLES)[number]

export const ACCOUNT_LEAD_STAGES = ["new", "reach_out", "talking", "later", "not_a_fit"] as const
export type AccountLeadStage = (typeof ACCOUNT_LEAD_STAGES)[number]

export const ACCOUNT_LIFECYCLE_LABELS: Record<AccountLifecycle, string> = {
  lead: "Lead",
  client: "Client",
}

export const ACCOUNT_LEAD_STAGE_LABELS: Record<AccountLeadStage, string> = {
  new: "New",
  reach_out: "Reach out",
  talking: "Talking",
  later: "Later",
  not_a_fit: "Not a fit",
}

export const LEAD_WORK_QUEUE_STAGES: readonly AccountLeadStage[] = ["new", "reach_out"]

export const LEAD_KPI_STAGES: readonly AccountLeadStage[] = ["new", "reach_out", "talking", "later"]

export type LeadStageFilter = "work" | AccountLeadStage | "all"

export const LEAD_STAGE_FILTER_LABELS: Record<LeadStageFilter, string> = {
  work: "Work queue",
  new: "New",
  reach_out: "Reach out",
  talking: "Talking",
  later: "Later",
  not_a_fit: "Not a fit",
  all: "All leads",
}

export const DEFAULT_LEAD_STAGE_FILTER: LeadStageFilter = "work"

export function isAccountLifecycle(value: string): value is AccountLifecycle {
  return (ACCOUNT_LIFECYCLES as readonly string[]).includes(value)
}

export function isAccountLeadStage(value: string): value is AccountLeadStage {
  return (ACCOUNT_LEAD_STAGES as readonly string[]).includes(value)
}

export function isLeadStageFilter(value: string): value is LeadStageFilter {
  return value === "work" || value === "all" || isAccountLeadStage(value)
}

export function parseAccountLifecycle(value: unknown): AccountLifecycle {
  return typeof value === "string" && isAccountLifecycle(value) ? value : "lead"
}

export function parseAccountLeadStage(value: unknown): AccountLeadStage {
  return typeof value === "string" && isAccountLeadStage(value) ? value : "new"
}

/** Supplier-only companies stay in Accounts, not the Leads work queue. */
export function isSupplierOnlyAccount(kinds: AccountKind[]): boolean {
  return kinds.length > 0 && kinds.every((kind) => kind === "supplier")
}

export function isLeadWorkQueueAccount(input: {
  lifecycle: AccountLifecycle
  account_types: AccountKind[]
}): boolean {
  return input.lifecycle === "lead" && !isSupplierOnlyAccount(input.account_types)
}

export function leadStageMatchesFilter(stage: AccountLeadStage, filter: LeadStageFilter): boolean {
  if (filter === "all") return true
  if (filter === "work") return (LEAD_WORK_QUEUE_STAGES as readonly string[]).includes(stage)
  return stage === filter
}

export function dealStageCountsAsBooked(stage: string): boolean {
  return (DEAL_SOLD_STAGES as readonly string[]).includes(stage)
}

export function orderCountsAsBooked(status: string): boolean {
  return status !== "cancelled"
}

/** Historical backfill: booked → client; everyone else stays a lead in Later, not New. */
export function classifyExistingAccount(input: {
  hasBookedDeal: boolean
  hasNonCancelledOrder: boolean
}): { lifecycle: AccountLifecycle; leadStage: AccountLeadStage } {
  if (input.hasBookedDeal || input.hasNonCancelledOrder) {
    return { lifecycle: "client", leadStage: "later" }
  }
  return { lifecycle: "lead", leadStage: "later" }
}

export function newAccountLifecycle(): { lifecycle: AccountLifecycle; leadStage: AccountLeadStage } {
  return { lifecycle: "lead", leadStage: "new" }
}

/** Auto-promote is one way. Manual override can move a client back to a lead. */
export function promoteLeadToClient(current: AccountLifecycle): AccountLifecycle {
  return current === "lead" ? "client" : current
}

export const LEAD_STAGE_SORT_ORDER: Record<AccountLeadStage, number> = {
  new: 0,
  reach_out: 1,
  talking: 2,
  later: 3,
  not_a_fit: 4,
}

export function compareLeadQueueRows(
  a: { lead_stage: AccountLeadStage; owner_profile_id: string | null; created_at: string; name: string },
  b: { lead_stage: AccountLeadStage; owner_profile_id: string | null; created_at: string; name: string },
): number {
  const stage = LEAD_STAGE_SORT_ORDER[a.lead_stage] - LEAD_STAGE_SORT_ORDER[b.lead_stage]
  if (stage !== 0) return stage
  const unassigned = Number(Boolean(a.owner_profile_id)) - Number(Boolean(b.owner_profile_id))
  if (unassigned !== 0) return unassigned
  return b.created_at.localeCompare(a.created_at) || a.name.localeCompare(b.name)
}

export function lifecycleTone(lifecycle: AccountLifecycle): "green" | "amber" | "blue" {
  return lifecycle === "client" ? "green" : "blue"
}

export function leadStageTone(stage: AccountLeadStage): "green" | "amber" | "red" | "blue" | "purple" | "gray" {
  if (stage === "new") return "amber"
  if (stage === "reach_out") return "blue"
  if (stage === "talking") return "purple"
  if (stage === "not_a_fit") return "gray"
  return "green"
}
