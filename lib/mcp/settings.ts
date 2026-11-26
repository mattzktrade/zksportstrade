import type { SupabaseClient } from "@supabase/supabase-js"

export const DEFAULT_MCP_DEAL_PRICE_FLOOR = 0

export async function loadMcpDealPriceFloor(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin
    .from("mcp_settings")
    .select("deal_price_floor")
    .eq("id", "default")
    .maybeSingle()
  if (error || data?.deal_price_floor == null) return DEFAULT_MCP_DEAL_PRICE_FLOOR
  const value = Number(data.deal_price_floor)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_MCP_DEAL_PRICE_FLOOR
}
