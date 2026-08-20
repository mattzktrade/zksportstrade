import type { SupabaseClient } from "@supabase/supabase-js"
import {
  raceDaysForThreeDayPackage,
  shellSingleTicketName,
  shellSingleTicketPackageId,
  SHELL_SINGLE_TICKET_FAMILY,
  type ShellDayDuration,
} from "@/lib/catalog/shell-single-tickets"
import { isNativePlatformMode } from "@/lib/platform/runtime-mode"

export type EnsureShellsResult = {
  /** Newly-created shell package ids in this call. */
  created: string[]
  /** All shell package ids that back this parent (new + pre-existing). */
  shellPackageIds: string[]
}

type ParentRow = {
  id: string
  race_id: string
  name: string
  circuit: string | null
  location: string | null
  country: string | null
  country_code: string | null
  event_date: string | null
  date_range: string | null
  currency: string | null
  duration: string | null
  inventory_group_id: string | null
  shell_parent_package_id: string | null
  image: string | null
}

/**
 * Ensures that a 3-day parent package has the three Single Ticket shell children it needs
 * for Salesforce. Safe to call repeatedly.
 *
 * Design invariants:
 *   - Shells are ALWAYS created for the three race days, even if a real sellable single-day
 *     sibling exists in the same inventory group. Single Ticket children are the canonical
 *     Salesforce line-item template; sellable single-day Packages (e.g. "Sunday Paddock
 *     Club") link to the SAME shell separately (see `syncSalesforcePackageItems`).
 *   - Shells carry no value: `trade_price = 0`, `is_hidden = true`, `is_enquiry = false`.
 *   - Shells never join the parent's `inventory_group_id` (the SQL linked-inventory
 *     reconciliation would otherwise treat their qty of 0 as the min). Instead, their
 *     Salesforce inventory is mirrored from the parent (or the real single-day sibling)
 *     at sync time — see `syncPackageToSalesforce`.
 */
export async function ensureShellSingleTicketsForParent(
  supabase: SupabaseClient,
  parentPackageId: string,
): Promise<EnsureShellsResult> {
  const id = parentPackageId.trim()
  if (!id) return { created: [], shellPackageIds: [] }

  // Native CMS/CRM mode does not create Salesforce reporting shells.
  // Existing shell rows are left untouched for historical reference.
  if (isNativePlatformMode()) {
    return { created: [], shellPackageIds: [] }
  }

  const { data: parentRow, error: parentErr } = await supabase
    .from("packages")
    .select(
      "id, race_id, name, circuit, location, country, country_code, event_date, date_range, currency, duration, inventory_group_id, shell_parent_package_id, image",
    )
    .eq("id", id)
    .maybeSingle()

  if (parentErr) throw new Error(parentErr.message)
  if (!parentRow) throw new Error(`ensureShellSingleTicketsForParent: package ${id} not found.`)

  const parent = parentRow as ParentRow

  if (parent.shell_parent_package_id) {
    // Shells themselves never spawn more shells.
    return { created: [], shellPackageIds: [] }
  }
  if (parent.duration !== "3_day") {
    return { created: [], shellPackageIds: [] }
  }

  const requiredDurations = raceDaysForThreeDayPackage(parent.event_date)

  const { data: existingShells, error: shellErr } = await supabase
    .from("packages")
    .select("id, duration")
    .eq("shell_parent_package_id", id)
  if (shellErr) throw new Error(shellErr.message)

  const existingShellsByDuration = new Map<string, string>()
  for (const row of existingShells ?? []) {
    const dur = (row as { duration: string | null }).duration
    const shellId = (row as { id: string }).id
    if (dur && shellId) existingShellsByDuration.set(dur, shellId)
  }

  const created: string[] = []
  const shellPackageIds: string[] = []

  const currency = (parent.currency ?? "USD").trim() || "USD"

  for (const duration of requiredDurations) {
    const existingId = existingShellsByDuration.get(duration)
    if (existingId) {
      shellPackageIds.push(existingId)
      continue
    }

    const shellId = shellSingleTicketPackageId(id, duration)
    const shellName = shellSingleTicketName(parent.name, duration)

    const { error: insErr } = await supabase.from("packages").insert({
      id: shellId,
      race_id: parent.race_id,
      name: shellName,
      circuit: parent.circuit ?? "",
      location: parent.location ?? "",
      country: parent.country ?? "",
      country_code: parent.country_code ?? "",
      event_date: parent.event_date,
      date_range: parent.date_range ?? "",
      description:
        `Auto-generated Salesforce Single Ticket child of "${parent.name}". No portal value; do not sell directly.`,
      image: parent.image,
      gallery_images: [],
      currency,
      total_capacity: 0,
      duration,
      inventory_group_id: null,
      shell_parent_package_id: id,
      is_enquiry: false,
      is_hidden: true,
      requires_booking_approval: false,
      tier: "paddock",
      includes: [],
      featured: false,
      sort_order: 0,
      trade_price: 0,
      brochure_url: null,
      product_code: null,
      salesforce_product_family: SHELL_SINGLE_TICKET_FAMILY,
      sell_on_trade_portal: false,
      sell_on_wix: false,
      sell_on_partners: false,
      integration_sync_status: "pending",
    })

    if (insErr) {
      // Someone raced us to create this exact shell — accept it and move on.
      if (!/duplicate|already exists/i.test(insErr.message)) {
        throw new Error(`Failed to create shell single ticket (${duration}): ${insErr.message}`)
      }
    }

    const { error: invErr } = await supabase
      .from("package_inventory")
      .insert({ package_id: shellId, qty_available: 0, qty_held: 0 })
    if (invErr && !/duplicate/i.test(invErr.message)) {
      throw new Error(`Failed to create shell inventory row (${duration}): ${invErr.message}`)
    }

    created.push(shellId)
    shellPackageIds.push(shellId)
  }

  return { created, shellPackageIds }
}

export type ShellInventorySource = {
  /**
   * Package id whose `package_inventory` row represents the day-specific available capacity.
   * When a sellable single-day sibling exists (e.g. "Sunday Paddock Club"), that sibling's
   * qty_available accurately reflects the Sunday-only availability after both 3-day sales
   * (which cascade to all day siblings) and Sunday-only sales. Otherwise falls back to the
   * parent 3-day.
   */
  qtyAvailablePackageId: string
  /**
   * Package id whose `package_cost_layers` represent the underlying stock ledger. Always the
   * parent 3-day, since day siblings share the parent's stock via cascade rather than
   * carrying their own cost layers.
   */
  costLayerPackageId: string
  /** True when a sellable single-day sibling drove the qty selection. */
  isRealSibling: boolean
  /** Descriptor for surfacing in sync notes. */
  description: string
}

/**
 * For a Single Ticket shell, decides where to read inventory numbers from when syncing to
 * Salesforce. The shell itself carries no value — its SF Available/Stock/Sold figures must
 * mirror the underlying day capacity.
 */
export async function resolveShellInventorySource(
  supabase: SupabaseClient,
  shellPackageId: string,
): Promise<ShellInventorySource | null> {
  const { data: shellRow, error: shellErr } = await supabase
    .from("packages")
    .select("id, duration, shell_parent_package_id")
    .eq("id", shellPackageId)
    .maybeSingle()
  if (shellErr) throw new Error(shellErr.message)
  if (!shellRow) return null

  const shell = shellRow as { id: string; duration: string | null; shell_parent_package_id: string | null }
  const parentId = shell.shell_parent_package_id?.trim()
  if (!parentId || !shell.duration) return null

  const { data: parentRow, error: parentErr } = await supabase
    .from("packages")
    .select("id, inventory_group_id")
    .eq("id", parentId)
    .maybeSingle()
  if (parentErr) throw new Error(parentErr.message)
  if (!parentRow) return null

  const parent = parentRow as { id: string; inventory_group_id: string | null }

  let qtyAvailablePackageId = parent.id
  let isRealSibling = false
  let siblingId: string | null = null

  if (parent.inventory_group_id) {
    const { data: realSiblings } = await supabase
      .from("packages")
      .select("id, shell_parent_package_id")
      .eq("inventory_group_id", parent.inventory_group_id)
      .eq("duration", shell.duration as ShellDayDuration)
    for (const row of realSiblings ?? []) {
      const sibling = row as { id: string; shell_parent_package_id: string | null }
      if (sibling.shell_parent_package_id) continue // skip other shells
      if (sibling.id === shellPackageId) continue
      qtyAvailablePackageId = sibling.id
      siblingId = sibling.id
      isRealSibling = true
      break
    }
  }

  const description = isRealSibling
    ? `sellable single-day sibling ${siblingId} (day capacity), cost layers from parent ${parent.id}`
    : `parent 3-day ${parent.id}`

  return {
    qtyAvailablePackageId,
    costLayerPackageId: parent.id,
    isRealSibling,
    description,
  }
}

