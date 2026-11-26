"use server"

import { revalidatePath } from "next/cache"
import { requireAdminAction } from "@/app/(admin)/actions"
import { generateMcpApiKey, hashMcpApiKey, mcpKeyPrefix } from "@/lib/mcp/keys"
import { isMcpKeyRole } from "@/lib/mcp/types"

type Result = { ok: true; message: string } | { ok: false; message: string }
type CreateResult = Result & { key?: string; name?: string }

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function revalidateMcp() {
  revalidatePath("/admin/mcp")
  revalidatePath("/admin/settings")
}

export async function createMcpApiKeyAction(input: {
  name: string
  role: string
}): Promise<CreateResult> {
  const gate = await requireAdminAction("settings.manage")
  if (!gate.ok) return gate
  const name = input.name.trim()
  if (!name) return { ok: false, message: "Give this key a name, for example Grok Bot." }
  if (!isMcpKeyRole(input.role)) return { ok: false, message: "Role must be read-only or sales-agent." }

  const plaintext = generateMcpApiKey()
  const { error } = await gate.supabase.from("mcp_api_keys").insert({
    name,
    role: input.role,
    key_hash: hashMcpApiKey(plaintext),
    key_prefix: mcpKeyPrefix(plaintext),
    created_by: gate.profile.id,
  })
  if (error) return { ok: false, message: error.message }
  revalidateMcp()
  return {
    ok: true,
    message: "Key created. Copy it now — it will not be shown again.",
    key: plaintext,
    name,
  }
}

export async function revokeMcpApiKeyAction(keyId: string): Promise<Result> {
  const gate = await requireAdminAction("settings.manage")
  if (!gate.ok) return gate
  const id = keyId.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Invalid key id." }

  const { data, error: loadError } = await gate.supabase
    .from("mcp_api_keys")
    .select("id, revoked_at")
    .eq("id", id)
    .maybeSingle()
  if (loadError) return { ok: false, message: loadError.message }
  if (!data) return { ok: false, message: "Key not found." }
  if (data.revoked_at) return { ok: false, message: "That key is already revoked." }

  const { error } = await gate.supabase
    .from("mcp_api_keys")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: gate.profile.id,
    })
    .eq("id", id)
  if (error) return { ok: false, message: error.message }
  revalidateMcp()
  return { ok: true, message: "Key revoked. The assistant can no longer use it." }
}

export async function updateMcpDealPriceFloorAction(floor: number): Promise<Result> {
  const gate = await requireAdminAction("settings.manage")
  if (!gate.ok) return gate
  if (!Number.isFinite(floor) || floor < 0) {
    return { ok: false, message: "Price floor must be zero or a positive number." }
  }

  const { error } = await gate.supabase.from("mcp_settings").upsert({
    id: "default",
    deal_price_floor: floor,
    updated_at: new Date().toISOString(),
    updated_by: gate.profile.id,
  })
  if (error) return { ok: false, message: error.message }
  revalidateMcp()
  return { ok: true, message: `Deal price floor is now ${floor}.` }
}
