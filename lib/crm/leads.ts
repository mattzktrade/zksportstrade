import { parseAccountKinds } from "@/lib/crm/account-kinds"
import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type {
  AccountSource,
  ClientDirectoryRow,
  LeadListRow,
  LeadSource,
  LeadStatus,
  StaffOption,
} from "@/lib/crm/lead-types"

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export async function getLeadListRows(): Promise<LeadListRow[]> {
  noStore()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("crm_leads")
    .select(`
      id, reference, status, source, account_id, contact_id, owner_profile_id, race_id,
      package_id, quantity, interest, estimated_value, currency, next_action, next_action_due_at,
      notes, converted_deal_id, created_at, updated_at,
      crm_accounts(name),
      crm_contacts(full_name, email, phone),
      packages(name)
    `)
    .order("updated_at", { ascending: false })
    .limit(750)

  if (error || !data) return []

  const ownerIds = [...new Set(data.map((row) => row.owner_profile_id).filter(Boolean))] as string[]
  const raceIds = [...new Set(data.map((row) => row.race_id).filter(Boolean))] as string[]
  const [{ data: owners }, { data: races }] = await Promise.all([
    ownerIds.length
      ? supabase.from("profiles").select("id, full_name, email").in("id", ownerIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; email: string }> }),
    raceIds.length
      ? supabase.from("races").select("id, name").in("id", raceIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ])
  const ownerName = new Map(
    (owners ?? []).map((row) => [row.id, row.full_name?.trim() || row.email]),
  )
  const raceName = new Map((races ?? []).map((row) => [row.id, row.name]))

  return data.map((row) => {
    const account = one(row.crm_accounts as { name: string } | { name: string }[] | null)
    const contact = one(
      row.crm_contacts as
        | { full_name: string; email: string | null; phone: string | null }
        | Array<{ full_name: string; email: string | null; phone: string | null }>
        | null,
    )
    const product = one(row.packages as { name: string } | { name: string }[] | null)
    return {
      id: row.id,
      reference: row.reference,
      status: row.status as LeadStatus,
      source: row.source as LeadSource,
      account_id: row.account_id,
      contact_id: row.contact_id,
      owner_profile_id: row.owner_profile_id,
      race_id: row.race_id,
      package_id: row.package_id,
      quantity: Number(row.quantity ?? 1),
      account_name: account?.name ?? "Unknown account",
      contact_name: contact?.full_name ?? null,
      contact_email: contact?.email ?? null,
      contact_phone: contact?.phone ?? null,
      owner_name: row.owner_profile_id ? ownerName.get(row.owner_profile_id) ?? null : null,
      event_name: row.race_id ? raceName.get(row.race_id) ?? null : null,
      package_name: product?.name ?? null,
      interest: row.interest,
      estimated_value: row.estimated_value == null ? null : Number(row.estimated_value),
      currency: row.currency,
      next_action: row.next_action,
      next_action_due_at: row.next_action_due_at,
      notes: row.notes,
      converted_deal_id: row.converted_deal_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  })
}

export async function getClientDirectoryRows(): Promise<ClientDirectoryRow[]> {
  noStore()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("crm_accounts")
    .select(`
      id, name, account_type, account_types, email, phone, owner_profile_id, portal_profile_id, source, created_at, updated_at,
      crm_contacts(id, full_name, email, phone, job_title, is_primary, active),
      deals(total_amount, updated_at, stage, order_id)
    `)
    .eq("active", true)

  if (error || !data) return []

  const ownerIds = [...new Set(data.map((row) => row.owner_profile_id).filter(Boolean))] as string[]
  const portalProfileIds = [
    ...new Set(data.map((row) => row.portal_profile_id).filter(Boolean)),
  ] as string[]
  const [{ data: owners }, { data: historicalOrders }] = await Promise.all([
    ownerIds.length
      ? supabase.from("profiles").select("id, full_name, email").in("id", ownerIds)
      : Promise.resolve({
          data: [] as Array<{ id: string; full_name: string | null; email: string }>,
        }),
    portalProfileIds.length
      ? supabase
          .from("orders")
          .select("agent_profile_id, total_amount, status, created_at")
          .in("agent_profile_id", portalProfileIds)
      : Promise.resolve({
          data: [] as Array<{
            agent_profile_id: string
            total_amount: number
            status: string
            created_at: string
          }>,
        }),
  ])
  const ownerName = new Map(
    (owners ?? []).map((row) => [row.id, row.full_name?.trim() || row.email]),
  )
  const ordersByProfile = new Map<
    string,
    Array<{ total_amount: number; status: string; created_at: string }>
  >()
  for (const order of historicalOrders ?? []) {
    const list = ordersByProfile.get(order.agent_profile_id) ?? []
    list.push(order)
    ordersByProfile.set(order.agent_profile_id, list)
  }

  return data.map((account) => {
    const deals = (account.deals ?? []) as Array<{
      total_amount: number
      updated_at: string
      stage: string
      order_id: string | null
    }>
    const orders = account.portal_profile_id
      ? ordersByProfile.get(account.portal_profile_id) ?? []
      : []
    const contacts = (
      (account.crm_contacts ?? []) as Array<{
        id: string
        full_name: string
        email: string | null
        phone: string | null
        job_title: string | null
        is_primary: boolean
        active: boolean
      }>
    )
      .filter((contact) => contact.active)
      .map(({ active: _active, ...contact }) => contact)
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.full_name.localeCompare(b.full_name))
    const wonStages = new Set(["paid_confirmed", "in_fulfilment", "fulfilled"])
    const standaloneWonDeals = deals.filter(
      (deal) => wonStages.has(deal.stage) && deal.order_id == null,
    )
    const completedOrders = orders.filter((order) => order.status !== "cancelled")
    const activityDates = [
      account.updated_at,
      ...deals.map((deal) => deal.updated_at),
      ...orders.map((order) => order.created_at),
    ]
    return {
      id: account.id,
      name: account.name,
      account_type: account.account_type,
      account_types: parseAccountKinds(account.account_types),
      email: account.email,
      phone: account.phone,
      owner_profile_id: account.owner_profile_id ?? null,
      owner_name: account.owner_profile_id
        ? ownerName.get(account.owner_profile_id) ?? null
        : null,
      source: (account.source as AccountSource | null) ?? "manual",
      created_at: account.created_at,
      contacts,
      deal_count: deals.filter((deal) => deal.order_id == null).length + orders.length,
      lifetime_spend:
        standaloneWonDeals.reduce((sum, deal) => sum + Number(deal.total_amount ?? 0), 0) +
        completedOrders.reduce((sum, order) => sum + Number(order.total_amount ?? 0), 0),
      last_activity_at: activityDates.sort().at(-1) ?? account.updated_at,
    }
  }).sort((a, b) => {
    const unassigned = Number(Boolean(a.owner_profile_id)) - Number(Boolean(b.owner_profile_id))
    if (unassigned !== 0) return unassigned
    return b.created_at.localeCompare(a.created_at) || a.name.localeCompare(b.name)
  })
}

export async function getSalesStaffOptions(): Promise<StaffOption[]> {
  noStore()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .in("role", ["admin", "sales"])
    .order("full_name")

  if (error || !data) return []
  return data.map((profile) => ({
    id: profile.id,
    name: profile.full_name?.trim() || profile.email,
    role: profile.role,
  }))
}

