import type { SupabaseClient } from "@supabase/supabase-js"
import { assistantPhoneDigits, normalizeAssistantEmail, phonesMatch } from "@/lib/assistant/phone"
import type { AssistantIdentityStatus } from "@/lib/assistant/types"

type AdminClient = SupabaseClient

export type IdentityContact = {
  id: string
  accountId: string
  fullName: string
  email: string | null
  phone: string | null
}

export type IdentityMatch = {
  status: AssistantIdentityStatus
  contacts: IdentityContact[]
  accountId: string | null
  contactId: string | null
}

type ContactRow = {
  id: string
  account_id: string
  full_name: string
  email: string | null
  phone: string | null
}

function toContact(row: ContactRow): IdentityContact {
  return {
    id: row.id,
    accountId: row.account_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
  }
}

export function pickIdentityMatch(contacts: IdentityContact[]): IdentityMatch {
  if (contacts.length === 0) {
    return { status: "new", contacts: [], accountId: null, contactId: null }
  }
  const uniqueAccounts = new Set(contacts.map((row) => row.accountId))
  if (contacts.length > 1 && uniqueAccounts.size > 1) {
    return { status: "ambiguous", contacts, accountId: null, contactId: null }
  }
  if (contacts.length > 1 && uniqueAccounts.size === 1) {
    const primary = contacts[0]
    return { status: "unique", contacts, accountId: primary.accountId, contactId: primary.id }
  }
  return {
    status: "unique",
    contacts,
    accountId: contacts[0].accountId,
    contactId: contacts[0].id,
  }
}

export async function matchContactsByPhone(admin: AdminClient, phone: string): Promise<IdentityContact[]> {
  const digits = assistantPhoneDigits(phone)
  if (digits.length < 8) return []
  const { data } = await admin
    .from("crm_contacts")
    .select("id, account_id, full_name, email, phone")
    .eq("active", true)
    .not("phone", "is", null)
    .order("created_at", { ascending: true })
    .limit(800)
  const rows = (data ?? []) as ContactRow[]
  return rows.filter((row) => phonesMatch(row.phone, digits)).map(toContact)
}

export async function matchContactsByEmail(admin: AdminClient, email: string): Promise<IdentityContact[]> {
  const normalized = normalizeAssistantEmail(email)
  if (!normalized) return []
  const { data } = await admin
    .from("crm_contacts")
    .select("id, account_id, full_name, email, phone")
    .eq("active", true)
    .ilike("email", normalized)
    .order("created_at", { ascending: true })
    .limit(20)
  return ((data ?? []) as ContactRow[]).map(toContact)
}

async function uniqueAccountName(admin: AdminClient, baseName: string, suffix: string): Promise<string> {
  const trimmed = baseName.trim().slice(0, 180) || "WhatsApp customer"
  const { data: existing } = await admin.from("crm_accounts").select("id").ilike("name", trimmed).limit(1).maybeSingle()
  if (!existing) return trimmed
  const withSuffix = `${trimmed} (${suffix})`.slice(0, 180)
  const { data: clash } = await admin.from("crm_accounts").select("id").ilike("name", withSuffix).limit(1).maybeSingle()
  if (!clash) return withSuffix
  return `${trimmed} (${suffix.slice(0, 8)})`.slice(0, 180)
}

export async function createAccountAndContact(
  admin: AdminClient,
  input: { fullName: string; email?: string | null; phone?: string | null; source: "whatsapp" | "email" },
): Promise<{ accountId: string; contactId: string }> {
  const email = normalizeAssistantEmail(input.email)
  const phone = input.phone?.trim() || null
  const name = await uniqueAccountName(admin, input.fullName, email || assistantPhoneDigits(phone) || "new")
  const { data: account, error: accountError } = await admin
    .from("crm_accounts")
    .insert({
      name,
      account_type: "direct_client",
      account_types: ["direct_client"],
      email,
      phone,
      source: input.source,
      lifecycle: "lead",
      lead_stage: "new",
      active: true,
    })
    .select("id")
    .single()
  if (accountError || !account) {
    throw new Error(accountError?.message || "Could not create CRM account.")
  }
  const { data: contact, error: contactError } = await admin
    .from("crm_contacts")
    .insert({
      account_id: account.id,
      full_name: input.fullName.trim() || name,
      email,
      phone,
      is_primary: true,
      active: true,
    })
    .select("id")
    .single()
  if (contactError || !contact) {
    throw new Error(contactError?.message || "Could not create CRM contact.")
  }
  return { accountId: String(account.id), contactId: String(contact.id) }
}

export async function resolveAssistantIdentity(
  admin: AdminClient,
  input: { phone?: string | null; email?: string | null; displayName: string; channel: "whatsapp" | "email" },
): Promise<IdentityMatch & { created?: boolean }> {
  const byEmail = input.email ? await matchContactsByEmail(admin, input.email) : []
  const byPhone = input.phone ? await matchContactsByPhone(admin, input.phone) : []
  const merged = [...byEmail]
  for (const row of byPhone) {
    if (!merged.some((existing) => existing.id === row.id)) merged.push(row)
  }
  const match = pickIdentityMatch(merged)
  if (match.status !== "new") return match
  const created = await createAccountAndContact(admin, {
    fullName: input.displayName,
    email: input.email,
    phone: input.phone,
    source: input.channel,
  })
  return {
    status: "new",
    contacts: [],
    accountId: created.accountId,
    contactId: created.contactId,
    created: true,
  }
}
