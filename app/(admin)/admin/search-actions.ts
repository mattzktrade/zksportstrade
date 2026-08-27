"use server"

import { requireAdminAction } from "@/app/(admin)/actions"
import {
  accountRecordHit,
  ADMIN_RECORD_KIND_LIMIT,
  contactRecordHit,
  dealRecordHit,
  eventRecordHit,
  orderRecordHit,
  type AdminRecordHit,
} from "@/lib/admin/admin-record-search"
import {
  ADMIN_SEARCH_MIN_QUERY,
  likeContains,
  likePrefix,
  sanitizeSearchQuery,
} from "@/lib/admin/ranked-search"
import { chunkList } from "@/lib/supabase/fetch-all-rows"
import type { CrmAccountOption, CrmContactOption } from "@/lib/crm/deal-types"
import { mergeCrmAccountOptions, searchCrmPartiesLocal, type CrmPartySearchHit } from "@/lib/crm/party-search"

type AccountNameRow = { id: string; name: string }
type ContactRow = {
  id: string
  account_id: string
  full_name: string
  email: string | null
  phone: string | null
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export async function searchCrmParties(query: string): Promise<CrmPartySearchHit[]> {
  const gate = await requireAdminAction("cms.access")
  if (!gate.ok) return []
  const q = sanitizeSearchQuery(query)
  if (q.length < ADMIN_SEARCH_MIN_QUERY) return []

  const prefix = likePrefix(q)
  const contains = likeContains(q)
  const supabase = gate.supabase

  const [prefixAccounts, containsAccounts, prefixContacts, nameContacts, emailContacts, phoneContacts] =
    await Promise.all([
      supabase.from("crm_accounts").select("id, name").eq("active", true).ilike("name", prefix).order("name").limit(40),
      supabase.from("crm_accounts").select("id, name").eq("active", true).ilike("name", contains).order("name").limit(40),
      supabase
        .from("crm_contacts")
        .select("id, account_id, full_name, email, phone")
        .eq("active", true)
        .ilike("full_name", prefix)
        .order("full_name")
        .limit(40),
      supabase
        .from("crm_contacts")
        .select("id, account_id, full_name, email, phone")
        .eq("active", true)
        .ilike("full_name", contains)
        .order("full_name")
        .limit(40),
      supabase
        .from("crm_contacts")
        .select("id, account_id, full_name, email, phone")
        .eq("active", true)
        .ilike("email", contains)
        .order("full_name")
        .limit(20),
      supabase
        .from("crm_contacts")
        .select("id, account_id, full_name, email, phone")
        .eq("active", true)
        .ilike("phone", contains)
        .order("full_name")
        .limit(20),
    ])

  const accounts = uniqueById<AccountNameRow>([
    ...((prefixAccounts.data ?? []) as AccountNameRow[]),
    ...((containsAccounts.data ?? []) as AccountNameRow[]),
  ])
  const matchedContacts = uniqueById<ContactRow>([
    ...((prefixContacts.data ?? []) as ContactRow[]),
    ...((nameContacts.data ?? []) as ContactRow[]),
    ...((emailContacts.data ?? []) as ContactRow[]),
    ...((phoneContacts.data ?? []) as ContactRow[]),
  ])

  const accountIds = uniqueById(
    [...accounts.map((row) => ({ id: row.id })), ...matchedContacts.map((row) => ({ id: row.account_id }))],
  ).map((row) => row.id)

  const missingAccountIds = accountIds.filter((id) => !accounts.some((account) => account.id === id))
  if (missingAccountIds.length > 0) {
    const extra: AccountNameRow[] = []
    await Promise.all(
      chunkList(missingAccountIds).map(async (chunk) => {
        const { data } = await supabase
          .from("crm_accounts")
          .select("id, name")
          .eq("active", true)
          .in("id", chunk)
        extra.push(...((data ?? []) as AccountNameRow[]))
      }),
    )
    accounts.push(...extra)
  }

  const activeAccountIds = accounts.map((account) => account.id)
  const contacts: ContactRow[] = []
  await Promise.all(
    chunkList(activeAccountIds).map(async (chunk) => {
      if (chunk.length === 0) return
      const { data } = await supabase
        .from("crm_contacts")
        .select("id, account_id, full_name, email, phone")
        .eq("active", true)
        .in("account_id", chunk)
        .order("full_name")
      contacts.push(...((data ?? []) as ContactRow[]))
    }),
  )

  const contactsByAccount = new Map<string, CrmContactOption[]>()
  for (const contact of contacts) {
    const list = contactsByAccount.get(contact.account_id) ?? []
    list.push({
      id: contact.id,
      full_name: contact.full_name,
      email: contact.email,
      phone: contact.phone,
    })
    contactsByAccount.set(contact.account_id, list)
  }

  const options: CrmAccountOption[] = accounts.map((account) => ({
    id: account.id,
    name: account.name,
    contacts: (contactsByAccount.get(account.id) ?? []).sort((a, b) => a.full_name.localeCompare(b.full_name)),
  }))

  return searchCrmPartiesLocal(mergeCrmAccountOptions(options), q)
}

export async function searchAdminRecords(query: string): Promise<AdminRecordHit[]> {
  const gate = await requireAdminAction("cms.access")
  if (!gate.ok) return []
  const q = sanitizeSearchQuery(query)
  if (q.length < ADMIN_SEARCH_MIN_QUERY) return []

  const prefix = likePrefix(q)
  const contains = likeContains(q)
  const supabase = gate.supabase
  const limit = ADMIN_RECORD_KIND_LIMIT

  const [
    prefixAccounts,
    containsAccounts,
    prefixContacts,
    containsContacts,
    emailContacts,
    prefixDeals,
    containsDeals,
    prefixOrders,
    containsOrders,
    clientOrders,
    prefixEvents,
    containsEvents,
  ] = await Promise.all([
    supabase.from("crm_accounts").select("id, name, email").eq("active", true).ilike("name", prefix).order("name").limit(limit),
    supabase.from("crm_accounts").select("id, name, email").eq("active", true).ilike("name", contains).order("name").limit(limit),
    supabase
      .from("crm_contacts")
      .select("id, account_id, full_name, email, crm_accounts(name, active)")
      .eq("active", true)
      .ilike("full_name", prefix)
      .order("full_name")
      .limit(limit),
    supabase
      .from("crm_contacts")
      .select("id, account_id, full_name, email, crm_accounts(name, active)")
      .eq("active", true)
      .ilike("full_name", contains)
      .order("full_name")
      .limit(limit),
    supabase
      .from("crm_contacts")
      .select("id, account_id, full_name, email, crm_accounts(name, active)")
      .eq("active", true)
      .ilike("email", contains)
      .order("full_name")
      .limit(limit),
    supabase
      .from("deals")
      .select("id, reference, crm_accounts(name)")
      .ilike("reference", prefix)
      .order("reference", { ascending: false })
      .limit(limit),
    supabase
      .from("deals")
      .select("id, reference, crm_accounts(name)")
      .ilike("reference", contains)
      .order("reference", { ascending: false })
      .limit(limit),
    supabase
      .from("orders")
      .select("id, reference, deal_id, client_name")
      .ilike("reference", prefix)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("orders")
      .select("id, reference, deal_id, client_name")
      .ilike("reference", contains)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("orders")
      .select("id, reference, deal_id, client_name")
      .ilike("client_name", contains)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("races")
      .select("id, name, season, event_date")
      .eq("is_archived", false)
      .ilike("name", prefix)
      .order("event_date")
      .limit(limit),
    supabase
      .from("races")
      .select("id, name, season, event_date")
      .eq("is_archived", false)
      .ilike("name", contains)
      .order("event_date")
      .limit(limit),
  ])

  const accountHits = uniqueById(
    [...(prefixAccounts.data ?? []), ...(containsAccounts.data ?? [])].map((row) =>
      accountRecordHit({ id: String(row.id), name: String(row.name), email: row.email ? String(row.email) : null }),
    ),
  )

  type ContactJoinRow = {
    id: string
    account_id: string
    full_name: string
    email: string | null
    crm_accounts: { name: string; active: boolean } | { name: string; active: boolean }[] | null
  }
  const contactHits = uniqueById(
    [...(prefixContacts.data ?? []), ...(containsContacts.data ?? []), ...(emailContacts.data ?? [])]
      .map((row) => {
        const contact = row as ContactJoinRow
        const account = one(contact.crm_accounts)
        if (!account?.active) return null
        return contactRecordHit({
          id: String(contact.id),
          accountId: String(contact.account_id),
          fullName: String(contact.full_name),
          accountName: String(account.name),
          email: contact.email ? String(contact.email) : null,
        })
      })
      .filter((hit): hit is AdminRecordHit => Boolean(hit)),
  )

  type DealJoinRow = {
    id: string
    reference: string
    crm_accounts: { name: string } | { name: string }[] | null
  }
  const dealHits = uniqueById(
    [...(prefixDeals.data ?? []), ...(containsDeals.data ?? [])].map((row) => {
      const deal = row as DealJoinRow
      return dealRecordHit({
        id: String(deal.id),
        reference: String(deal.reference),
        accountName: one(deal.crm_accounts)?.name ?? null,
      })
    }),
  )

  const orderHits = uniqueById(
    [...(prefixOrders.data ?? []), ...(containsOrders.data ?? []), ...(clientOrders.data ?? [])].map((row) =>
      orderRecordHit({
        id: String(row.id),
        reference: String(row.reference),
        dealId: row.deal_id ? String(row.deal_id) : null,
        clientName: row.client_name ? String(row.client_name) : null,
      }),
    ),
  )

  const eventHits = uniqueById(
    [...(prefixEvents.data ?? []), ...(containsEvents.data ?? [])].map((row) =>
      eventRecordHit({
        id: String(row.id),
        name: String(row.name),
        season: typeof row.season === "number" ? row.season : null,
        eventDate: row.event_date ? String(row.event_date) : null,
      }),
    ),
  )

  return [...accountHits, ...contactHits, ...dealHits, ...orderHits, ...eventHits]
}
