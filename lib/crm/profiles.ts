import { unstable_noStore as noStore } from "next/cache"
import { parseAccountKinds, type AccountKind } from "@/lib/crm/account-kinds"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import { createClient } from "@/lib/supabase/server"
import { canonicalDealStage, type DealStage } from "@/lib/crm/deal-types"
import type { AccountSource, LeadStatus } from "@/lib/crm/lead-types"

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export type CrmProfileContact = {
  id: string
  fullName: string
  email: string | null
  phone: string | null
  jobTitle: string | null
  notes: string | null
  isPrimary: boolean
  active: boolean
}

export type CrmProfileLead = {
  id: string
  reference: string
  contactId: string | null
  contactName: string | null
  status: LeadStatus
  source: string
  interest: string | null
  eventName: string | null
  packageName: string | null
  quantity: number
  estimatedValue: number | null
  currency: string
  nextAction: string | null
  nextActionDueAt: string | null
  createdAt: string
  updatedAt: string
}

export type CrmProfileDeal = {
  id: string
  reference: string
  contactId: string | null
  contactName: string | null
  stage: DealStage
  totalAmount: number
  currency: string
  source: string
  eventNames: string[]
  products: Array<{ id: string; name: string; quantity: number }>
  nextAction: string | null
  nextActionDueAt: string | null
  lossReason: string | null
  createdAt: string
  updatedAt: string
}

export type CrmProfileOrder = {
  id: string
  reference: string
  status: string
  totalAmount: number
  currency: string
  createdAt: string
}

export type CrmEntityProfile = {
  account: {
    id: string
    name: string
    accountType: string
    accountTypes: AccountKind[]
    email: string | null
    phone: string | null
    address: string[]
    billing: {
      line1: string | null
      line2: string | null
      city: string | null
      postcode: string | null
      country: string | null
    }
    notes: string | null
    active: boolean
    ownerProfileId: string | null
    ownerName: string | null
    source: AccountSource
    createdAt: string
    updatedAt: string
  }
  selectedContact: CrmProfileContact | null
  contacts: CrmProfileContact[]
  interestRaceIds: string[]
  leads: CrmProfileLead[]
  deals: CrmProfileDeal[]
  orders: CrmProfileOrder[]
}

type DealQueryRow = {
  id: string
  reference: string
  primary_contact_id: string | null
  stage: string
  total_amount: number | string | null
  currency: string
  source: string
  race_id: string | null
  next_action: string | null
  next_action_due_at: string | null
  loss_reason: string | null
  created_at: string
  updated_at: string
  crm_contacts: { full_name: string } | Array<{ full_name: string }> | null
  races:
    | { name: string; season: number | null }
    | Array<{ name: string; season: number | null }>
    | null
  deal_line_items: Array<{
    package_id: string
    quantity: number | string
    packages:
      | {
          name: string
          races:
            | { name: string; season: number | null }
            | Array<{ name: string; season: number | null }>
            | null
        }
      | Array<{
          name: string
          races:
            | { name: string; season: number | null }
            | Array<{ name: string; season: number | null }>
            | null
        }>
      | null
  }>
}

export async function getCrmEntityProfile(
  accountId: string,
  contactId?: string,
): Promise<CrmEntityProfile | null> {
  noStore()
  const supabase = await createClient()
  const cleanAccountId = accountId.trim()
  const cleanContactId = contactId?.trim() || null
  if (!cleanAccountId) return null

  const { data: account, error: accountError } = await supabase
    .from("crm_accounts")
    .select(`
      id, name, account_type, account_types, email, phone, billing_address_line1, billing_address_line2,
      billing_city, billing_postcode, billing_country, notes, active, owner_profile_id,
      portal_profile_id, source, created_at, updated_at,
      crm_contacts(id, full_name, email, phone, job_title, notes, is_primary, active)
    `)
    .eq("id", cleanAccountId)
    .maybeSingle()
  if (accountError || !account) return null

  const rawContacts = (account.crm_contacts ?? []) as Array<{
    id: string
    full_name: string
    email: string | null
    phone: string | null
    job_title: string | null
    notes: string | null
    is_primary: boolean
    active: boolean
  }>
  const contacts: CrmProfileContact[] = rawContacts
    .map((contact) => ({
      id: contact.id,
      fullName: contact.full_name,
      email: contact.email,
      phone: contact.phone,
      jobTitle: contact.job_title,
      notes: contact.notes,
      isPrimary: Boolean(contact.is_primary),
      active: Boolean(contact.active),
    }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.fullName.localeCompare(b.fullName))
  const selectedContact = cleanContactId
    ? contacts.find((contact) => contact.id === cleanContactId) ?? null
    : null
  if (cleanContactId && !selectedContact) return null

  let leadQuery = supabase
    .from("crm_leads")
    .select(`
      id, reference, contact_id, status, source, interest, quantity, estimated_value, currency,
      next_action, next_action_due_at, created_at, updated_at,
      crm_contacts(full_name), races(name, season), packages(name)
    `)
    .eq("account_id", cleanAccountId)
  if (cleanContactId) leadQuery = leadQuery.eq("contact_id", cleanContactId)

  let dealQuery = supabase
    .from("deals")
    .select(`
      id, reference, primary_contact_id, stage, total_amount, currency, source, race_id,
      next_action, next_action_due_at, loss_reason, created_at, updated_at,
      crm_contacts(full_name), races(name, season),
      deal_line_items(package_id, quantity, packages(name, races(name, season)))
    `)
    .eq("account_id", cleanAccountId)
  if (cleanContactId) dealQuery = dealQuery.eq("primary_contact_id", cleanContactId)

  let nativeOrderQuery = supabase
    .from("orders")
    .select("id, reference, status, total_amount, currency, created_at")
    .eq("crm_account_id", cleanAccountId)
  if (cleanContactId) nativeOrderQuery = nativeOrderQuery.eq("crm_contact_id", cleanContactId)

  const [{ data: owner }, { data: leadRows }, { data: dealRows }, { data: nativeOrders }, portalOrders, { data: interestRows }] =
    await Promise.all([
      account.owner_profile_id
        ? supabase
            .from("profiles")
            .select("id, full_name, email")
            .eq("id", account.owner_profile_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      leadQuery.order("updated_at", { ascending: false }),
      dealQuery.order("updated_at", { ascending: false }),
      nativeOrderQuery.order("created_at", { ascending: false }),
      !cleanContactId && account.portal_profile_id
        ? supabase
            .from("orders")
            .select("id, reference, status, total_amount, currency, created_at")
            .eq("agent_profile_id", account.portal_profile_id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase
        .from("crm_account_event_interests")
        .select("race_id")
        .eq("account_id", cleanAccountId),
    ])

  const leads: CrmProfileLead[] = (leadRows ?? []).map((raw) => {
    const contact = one(raw.crm_contacts as { full_name: string } | Array<{ full_name: string }> | null)
    const race = one(
      raw.races as
        | { name: string; season: number | null }
        | Array<{ name: string; season: number | null }>
        | null,
    )
    const pkg = one(raw.packages as { name: string } | Array<{ name: string }> | null)
    return {
      id: raw.id,
      reference: raw.reference,
      contactId: raw.contact_id,
      contactName: contact?.full_name ?? null,
      status: raw.status as LeadStatus,
      source: raw.source,
      interest: raw.interest,
      eventName: race ? eventSeasonLabel(race.name, race.season) : null,
      packageName: pkg?.name ?? null,
      quantity: Number(raw.quantity ?? 1),
      estimatedValue: raw.estimated_value == null ? null : Number(raw.estimated_value),
      currency: raw.currency,
      nextAction: raw.next_action,
      nextActionDueAt: raw.next_action_due_at,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    }
  })

  const deals: CrmProfileDeal[] = ((dealRows ?? []) as DealQueryRow[]).map((raw) => {
    const contact = one(raw.crm_contacts)
    const directRace = one(raw.races)
    const eventNames = new Set<string>()
    if (directRace) eventNames.add(eventSeasonLabel(directRace.name, directRace.season))
    const products = (raw.deal_line_items ?? []).map((line) => {
      const pkg = one(line.packages)
      const race = one(pkg?.races)
      if (race) eventNames.add(eventSeasonLabel(race.name, race.season))
      return {
        id: line.package_id,
        name: pkg?.name ?? "Unknown product",
        quantity: Number(line.quantity ?? 0),
      }
    })
    return {
      id: raw.id,
      reference: raw.reference,
      contactId: raw.primary_contact_id,
      contactName: contact?.full_name ?? null,
      stage: canonicalDealStage(raw.stage),
      totalAmount: Number(raw.total_amount ?? 0),
      currency: raw.currency,
      source: raw.source,
      eventNames: [...eventNames],
      products,
      nextAction: raw.next_action,
      nextActionDueAt: raw.next_action_due_at,
      lossReason: raw.loss_reason,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    }
  })

  const orderById = new Map<
    string,
    { id: string; reference: string; status: string; total_amount: number; currency: string; created_at: string }
  >()
  for (const raw of [...(nativeOrders ?? []), ...(portalOrders.data ?? [])]) {
    orderById.set(raw.id, raw)
  }
  const orders: CrmProfileOrder[] = [...orderById.values()]
    .map((order) => ({
      id: order.id,
      reference: order.reference,
      status: order.status,
      totalAmount: Number(order.total_amount ?? 0),
      currency: order.currency,
      createdAt: order.created_at,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const address = [
    account.billing_address_line1,
    account.billing_address_line2,
    account.billing_city,
    account.billing_postcode,
    account.billing_country,
  ].filter((part): part is string => Boolean(part?.trim()))

  return {
    account: {
      id: account.id,
      name: account.name,
      accountType: account.account_type,
      accountTypes: parseAccountKinds(account.account_types),
      email: account.email,
      phone: account.phone,
      address,
      billing: {
        line1: account.billing_address_line1,
        line2: account.billing_address_line2,
        city: account.billing_city,
        postcode: account.billing_postcode,
        country: account.billing_country,
      },
      notes: account.notes,
      active: Boolean(account.active),
      ownerProfileId: account.owner_profile_id ?? null,
      ownerName: owner?.full_name?.trim() || owner?.email || null,
      source: (account.source as AccountSource | null) ?? "manual",
      createdAt: account.created_at,
      updatedAt: account.updated_at,
    },
    selectedContact,
    contacts,
    interestRaceIds: [...new Set((interestRows ?? []).map((row) => String(row.race_id)).filter(Boolean))],
    leads,
    deals,
    orders,
  }
}
