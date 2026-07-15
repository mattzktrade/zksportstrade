import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"

export type FulfilmentBlockRow = {
  id: string
  package_id: string
  name: string
  location_note: string | null
  salesforce_block_ref: string | null
  created_at: string
  updated_at: string
}

export type FulfilmentBlockUsage = {
  block_id: string
  layer_count: number
  quantity_purchased: number
  quantity_remaining: number
}

export type FulfilmentBlockWithUsage = FulfilmentBlockRow & {
  usage: FulfilmentBlockUsage
}

const BLOCK_COLUMNS =
  "id, package_id, name, location_note, salesforce_block_ref, created_at, updated_at" as const

export async function getFulfilmentBlocksForPackage(
  packageId: string,
): Promise<FulfilmentBlockRow[]> {
  noStore()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("fulfilment_blocks")
    .select(BLOCK_COLUMNS)
    .eq("package_id", packageId)
    .order("created_at", { ascending: true })
  if (error || !data) return []
  return data as FulfilmentBlockRow[]
}

export async function getFulfilmentBlockUsage(
  blockIds: readonly string[],
): Promise<Map<string, FulfilmentBlockUsage>> {
  const out = new Map<string, FulfilmentBlockUsage>()
  if (blockIds.length === 0) return out
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("package_cost_layers")
    .select("fulfilment_block_id, quantity, quantity_remaining")
    .in("fulfilment_block_id", blockIds)
  if (error || !data) return out
  for (const raw of data) {
    const row = raw as {
      fulfilment_block_id: string
      quantity: number | string
      quantity_remaining: number | string
    }
    const entry =
      out.get(row.fulfilment_block_id) ?? {
        block_id: row.fulfilment_block_id,
        layer_count: 0,
        quantity_purchased: 0,
        quantity_remaining: 0,
      }
    entry.layer_count += 1
    entry.quantity_purchased += Math.max(0, Math.floor(Number(row.quantity) || 0))
    entry.quantity_remaining += Math.max(0, Math.floor(Number(row.quantity_remaining) || 0))
    out.set(row.fulfilment_block_id, entry)
  }
  return out
}

export async function getFulfilmentBlocksWithUsage(
  packageId: string,
): Promise<FulfilmentBlockWithUsage[]> {
  const blocks = await getFulfilmentBlocksForPackage(packageId)
  if (blocks.length === 0) return []
  const usage = await getFulfilmentBlockUsage(blocks.map((b) => b.id))
  return blocks.map((b) => ({
    ...b,
    usage:
      usage.get(b.id) ?? {
        block_id: b.id,
        layer_count: 0,
        quantity_purchased: 0,
        quantity_remaining: 0,
      },
  }))
}
