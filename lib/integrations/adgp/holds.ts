import { ADGP_HOLD_MINUTES } from "@/lib/integrations/adgp/config"
import { catalogItemFor, loadAdgpCatalog } from "@/lib/integrations/adgp/catalog"
import type { AdgpHoldResult } from "@/lib/integrations/adgp/types"
import { createAdminClient } from "@/lib/supabase/admin"

type HoldRpc = {
  hold_id?: string
  expires_at?: string
  package_id?: string
  package_name?: string
  guests?: number
  unit_price?: number
  currency?: string
}

export async function createAdgpHold(input: {
  slug: string
  day: string
  guests: number
  agentProfileId: string
}): Promise<{ ok: true; hold: AdgpHoldResult } | { ok: false; message: string }> {
  const guests = Math.floor(input.guests)
  if (!Number.isFinite(guests) || guests < 1 || guests > 200) {
    return { ok: false, message: "Enter the number of guests." }
  }
  const catalog = await loadAdgpCatalog()
  if (!catalog.ok) return catalog
  const item = catalogItemFor(catalog.items, input.slug.trim(), input.day.trim())
  if (!item) return { ok: false, message: "That package is not available for online checkout." }
  if (!item.buyable) {
    if (item.reason === "sold_out") return { ok: false, message: "That day is sold out." }
    return { ok: false, message: "That package is not available for online checkout." }
  }
  if (item.sellable < guests) {
    return { ok: false, message: "There are not enough seats left for that guest count." }
  }

  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role is not configured." }

  const { data, error } = await admin.rpc("place_website_checkout_hold", {
    p_package_id: item.packageId,
    p_slug: item.slug,
    p_day: item.day,
    p_guests: guests,
    p_unit_price: item.unitPrice,
    p_currency: item.currency,
    p_agent_profile_id: input.agentProfileId,
    p_hold_minutes: ADGP_HOLD_MINUTES,
  })
  if (error) return { ok: false, message: error.message }

  const row = data as HoldRpc
  const holdId = String(row.hold_id ?? "")
  if (!holdId) return { ok: false, message: "Could not reserve those seats." }
  const unitPrice = Number(row.unit_price ?? item.unitPrice)
  const currency = String(row.currency ?? item.currency)
  return {
    ok: true,
    hold: {
      holdId,
      expiresAt: String(row.expires_at ?? ""),
      packageId: String(row.package_id ?? item.packageId),
      packageName: String(row.package_name ?? item.name),
      slug: item.slug,
      day: item.day,
      guests,
      unitPrice,
      currency,
      total: Math.round(unitPrice * guests * 100) / 100,
    },
  }
}

export async function attachAdgpHoldSession(input: {
  holdId: string
  stripeSessionId: string
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role is not configured." }
  const { error } = await admin
    .from("website_checkout_holds")
    .update({
      stripe_session_id: input.stripeSessionId.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.holdId)
    .eq("status", "active")
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

export async function releaseAdgpHold(input: {
  holdId?: string | null
  stripeSessionId?: string | null
}): Promise<{ ok: true; duplicate?: boolean } | { ok: false; message: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role is not configured." }

  let holdId = input.holdId?.trim() || ""
  if (!holdId && input.stripeSessionId?.trim()) {
    const { data } = await admin
      .from("website_checkout_holds")
      .select("id")
      .eq("stripe_session_id", input.stripeSessionId.trim())
      .maybeSingle()
    holdId = data?.id ? String(data.id) : ""
  }
  if (!holdId) return { ok: false, message: "Missing hold id." }

  const { data, error } = await admin.rpc("release_website_checkout_hold", {
    p_hold_id: holdId,
  })
  if (error) return { ok: false, message: error.message }
  return { ok: true, duplicate: Boolean((data as { duplicate?: boolean } | null)?.duplicate) }
}
