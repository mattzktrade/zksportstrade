import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  raceDaysForThreeDayPackage,
  SHELL_SINGLE_TICKET_FAMILY,
  type ShellDayDuration,
} from "@/lib/catalog/shell-single-tickets"

/** A sellable (non-shell) portal package that shares inventory with the parent. */
export type LinkedDaySibling = {
  id: string
  name: string
  duration: string | null
  qty_available: number
  qty_held: number
  sellable: number
  trade_price: number | null
  currency: string
  is_hidden: boolean
  salesforce_product_id: string | null
  integration_sync_status: string | null
}

/** A hidden Salesforce Single Ticket shell child, owned by a 3-day parent in the same group. */
export type LinkedDayShell = {
  id: string
  name: string
  duration: ShellDayDuration
  parent_three_day_id: string
  salesforce_product_id: string | null
}

/** Everything the "Linked day packages" panel needs. */
export type LinkedDayPackageOverview = {
  /** Shared linked-inventory key across the group. Null when the package isn't grouped. */
  inventoryGroupId: string | null
  /** The single 3-day parent that owns the shells for this group (if any). */
  threeDayParentId: string | null
  /** Race event date, used to pick which day durations the race weekend covers. */
  raceEventDate: string | null
  /** Day durations expected for this race weekend (Fri/Sat/Sun, or Thu/Fri/Sat for LV). */
  expectedDayDurations: ShellDayDuration[]
  /** Sellable siblings in the same inventory group (excludes shells, includes 2-day). */
  siblings: LinkedDaySibling[]
  /** Hidden Single Ticket shells owned by the 3-day parent in this group. */
  shells: LinkedDayShell[]
  /** Day durations that don't yet have a sellable single-day sibling. */
  missingDayDurations: ShellDayDuration[]
  /** True when this weekend has Sat+Sun and the group has no 2-day (Saturday & Sunday) sibling. */
  missingTwoDay: boolean
  /**
   * Fields from the canonical 3-day parent that should pre-fill a new linked day package.
   * When the current package is the 3-day itself, this is that package.
   */
  parentPreset: LinkedDayPackagePreset | null
}

/** Values the quick-add dialog uses to populate a new linked day package. */
export type LinkedDayPackagePreset = {
  parentPackageId: string
  race_id: string
  circuit: string
  location: string
  country: string
  country_code: string
  event_date: string
  date_range: string
  currency: string
  description: string
  image: string | null
  gallery_images: string[]
  includes: string[]
  total_capacity: number
  brochure_url: string | null
  requires_booking_approval: boolean
  /** Base package name to derive day-specific names from, e.g. "3 Day Paddock Club - Club Suite". */
  parent_name: string
}

const DAY_DURATIONS: ReadonlySet<string> = new Set([
  "thursday_only",
  "friday_only",
  "saturday_only",
  "sunday_only",
])

function isDayDuration(value: string | null | undefined): value is ShellDayDuration {
  return typeof value === "string" && DAY_DURATIONS.has(value)
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((x): x is string => typeof x === "string")
}

export async function getLinkedDayPackageOverview(packageId: string): Promise<LinkedDayPackageOverview> {
  const empty: LinkedDayPackageOverview = {
    inventoryGroupId: null,
    threeDayParentId: null,
    raceEventDate: null,
    expectedDayDurations: [],
    siblings: [],
    shells: [],
    missingDayDurations: [],
    missingTwoDay: false,
    parentPreset: null,
  }

  const id = packageId.trim()
  if (!id) return empty

  const supabase = await createClient()

  const { data: current } = await supabase
    .from("packages")
    .select("id, race_id, duration, inventory_group_id, shell_parent_package_id, event_date")
    .eq("id", id)
    .maybeSingle()
  if (!current) return empty

  const currentRow = current as {
    id: string
    race_id: string
    duration: string | null
    inventory_group_id: string | null
    shell_parent_package_id: string | null
    event_date: string | null
  }

  // Shells themselves don't show this panel — the caller can render their own note.
  if (currentRow.shell_parent_package_id) return empty

  const groupId = currentRow.inventory_group_id?.trim() || null

  // Collect siblings from the group (if any); include self for completeness.
  const packageIdsInGroup = new Set<string>([id])
  if (groupId) {
    const { data: groupRows } = await supabase
      .from("packages")
      .select("id")
      .eq("inventory_group_id", groupId)
    for (const row of groupRows ?? []) {
      const rid = String((row as { id: string }).id ?? "").trim()
      if (rid) packageIdsInGroup.add(rid)
    }
  }

  const packageIds = [...packageIdsInGroup]

  // Full package rows for siblings.
  const { data: pkgRows } = await supabase
    .from("packages")
    .select(
      "id, name, duration, trade_price, currency, is_hidden, salesforce_product_id, integration_sync_status, shell_parent_package_id, salesforce_product_family",
    )
    .in("id", packageIds)

  const { data: invRows } = await (createAdminClient() ?? supabase)
    .from("package_inventory")
    .select("package_id, qty_available, qty_held")
    .in("package_id", packageIds)
  const invByPkg = new Map<string, { qty_available: number; qty_held: number }>()
  for (const r of invRows ?? []) {
    const row = r as { package_id: string; qty_available: number; qty_held: number }
    if (row.package_id) invByPkg.set(row.package_id, { qty_available: row.qty_available, qty_held: row.qty_held })
  }

  // Linked-group SF heal runs in the background from the package detail page (after()) so
  // this overview stays a fast DB read.
  // 3-day parent in the group; there is normally one — pick the first if there are several.
  let threeDayParentId: string | null = null
  for (const p of pkgRows ?? []) {
    const row = p as { id: string; duration: string | null; shell_parent_package_id: string | null }
    if (row.shell_parent_package_id) continue
    if ((row.duration ?? "").trim() === "3_day") {
      threeDayParentId = row.id
      break
    }
  }

  const siblings: LinkedDaySibling[] = []
  for (const p of pkgRows ?? []) {
    const row = p as {
      id: string
      name: string
      duration: string | null
      trade_price: number | string | null
      currency: string | null
      is_hidden: boolean
      salesforce_product_id: string | null
      integration_sync_status: string | null
      shell_parent_package_id: string | null
      salesforce_product_family: string | null
    }
    if (row.shell_parent_package_id) continue
    if ((row.salesforce_product_family ?? "").trim() === SHELL_SINGLE_TICKET_FAMILY) continue
    const inv = invByPkg.get(row.id) ?? { qty_available: 0, qty_held: 0 }
    const sellable = Math.max(0, Number(inv.qty_available ?? 0) - Number(inv.qty_held ?? 0))
    siblings.push({
      id: row.id,
      name: row.name,
      duration: row.duration,
      qty_available: Number(inv.qty_available ?? 0),
      qty_held: Number(inv.qty_held ?? 0),
      sellable,
      trade_price: row.trade_price == null ? null : Number(row.trade_price),
      currency: (row.currency ?? "USD").trim() || "USD",
      is_hidden: row.is_hidden,
      salesforce_product_id: row.salesforce_product_id ?? null,
      integration_sync_status: row.integration_sync_status ?? null,
    })
  }
  siblings.sort((a, b) => a.name.localeCompare(b.name))

  // Shells owned by the 3-day parent (they live outside the inventory group by design).
  const shells: LinkedDayShell[] = []
  if (threeDayParentId) {
    const { data: shellRows } = await supabase
      .from("packages")
      .select("id, name, duration, salesforce_product_id, shell_parent_package_id")
      .eq("shell_parent_package_id", threeDayParentId)
    for (const s of shellRows ?? []) {
      const row = s as {
        id: string
        name: string
        duration: string | null
        salesforce_product_id: string | null
        shell_parent_package_id: string
      }
      if (!isDayDuration(row.duration)) continue
      shells.push({
        id: row.id,
        name: row.name,
        duration: row.duration,
        parent_three_day_id: row.shell_parent_package_id,
        salesforce_product_id: row.salesforce_product_id,
      })
    }
  }
  shells.sort((a, b) => a.duration.localeCompare(b.duration))

  const raceEventDate = currentRow.event_date
  const expectedDayDurations = raceDaysForThreeDayPackage(raceEventDate)

  const siblingDaysWithSellable = new Set<string>()
  for (const s of siblings) {
    const d = (s.duration ?? "").trim()
    if (isDayDuration(d)) siblingDaysWithSellable.add(d)
  }
  const missingDayDurations = expectedDayDurations.filter((d) => !siblingDaysWithSellable.has(d))
  const hasSaturdayAndSunday =
    expectedDayDurations.includes("saturday_only") && expectedDayDurations.includes("sunday_only")
  const missingTwoDay =
    hasSaturdayAndSunday && !siblings.some((s) => (s.duration ?? "").trim() === "2_day")

  // Build the preset from the 3-day parent when we know it. Otherwise fall back to the
  // current package (still useful when admin is editing a single-day product first).
  const presetSourceId = threeDayParentId ?? id
  let parentPreset: LinkedDayPackagePreset | null = null
  const { data: presetRow } = await supabase
    .from("packages")
    .select(
      "id, race_id, name, circuit, location, country, country_code, event_date, date_range, currency, description, image, gallery_images, includes, total_capacity, brochure_url, requires_booking_approval",
    )
    .eq("id", presetSourceId)
    .maybeSingle()
  if (presetRow) {
    const row = presetRow as {
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
      description: string | null
      image: string | null
      gallery_images: unknown
      includes: unknown
      total_capacity: number | string | null
      brochure_url: string | null
      requires_booking_approval: boolean | null
    }
    parentPreset = {
      parentPackageId: row.id,
      race_id: row.race_id,
      circuit: row.circuit ?? "",
      location: row.location ?? "",
      country: row.country ?? "",
      country_code: row.country_code ?? "",
      event_date: (row.event_date ?? "").slice(0, 10),
      date_range: row.date_range ?? "",
      currency: (row.currency ?? "USD").trim() || "USD",
      description: row.description ?? "",
      image: row.image,
      gallery_images: toStringArray(row.gallery_images),
      includes: toStringArray(row.includes),
      total_capacity: Number(row.total_capacity ?? 0) || 0,
      brochure_url: row.brochure_url,
      requires_booking_approval: !!row.requires_booking_approval,
      parent_name: row.name,
    }
  }

  return {
    inventoryGroupId: groupId,
    threeDayParentId,
    raceEventDate,
    expectedDayDurations,
    siblings,
    shells,
    missingDayDurations,
    missingTwoDay,
    parentPreset,
  }
}
