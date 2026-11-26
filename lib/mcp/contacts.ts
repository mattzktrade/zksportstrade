import type { SupabaseClient } from "@supabase/supabase-js"
import { sanitizeHttpsUrl } from "@/lib/auth/safe-url"
import { likeContains } from "@/lib/admin/ranked-search"
import {
  MCP_ACTIVITY_TYPES,
  MCP_CONTACT_SOURCES,
  McpToolError,
  type McpActivityType,
  type McpApiKey,
  type McpContactSource,
} from "@/lib/mcp/types"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed ? trimmed : null
}

function requireUuid(id: string, label: string): string {
  const value = id.trim()
  if (!UUID_RE.test(value)) throw new McpToolError(`${label} is not a valid id.`)
  return value
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function isContactSource(value: string): value is McpContactSource {
  return (MCP_CONTACT_SOURCES as readonly string[]).includes(value)
}

function accountSourceFromContactSource(source: McpContactSource): string {
  if (source === "whatsapp" || source === "email" || source === "portal" || source === "assistant") {
    return "other"
  }
  return source
}

function isActivityType(value: string): value is McpActivityType {
  return (MCP_ACTIVITY_TYPES as readonly string[]).includes(value)
}

function mapContact(row: Record<string, unknown>, account?: Record<string, unknown> | null) {
  return {
    id: String(row.id),
    name: row.full_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    title: row.job_title ?? null,
    linkedin: row.linkedin_url ?? null,
    source: row.source ?? null,
    notes: row.notes ?? null,
    company: account
      ? { id: account.id, name: account.name }
      : row.account_id
        ? { id: row.account_id, name: null }
        : null,
    active: row.active !== false,
  }
}

export async function mcpSearchContacts(admin: SupabaseClient, query: string): Promise<unknown> {
  const needle = query.trim()
  if (needle.length < 2) throw new McpToolError("query must be at least 2 characters.")
  const like = likeContains(needle)

  const { data: contacts, error } = await admin
    .from("crm_contacts")
    .select("id, account_id, full_name, email, phone, job_title, linkedin_url, source, notes, active, crm_accounts(id, name)")
    .eq("active", true)
    .or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
    .order("full_name")
    .limit(25)
  if (error) throw new McpToolError(error.message)

  let extra: typeof contacts = []
  const { data: accounts } = await admin
    .from("crm_accounts")
    .select("id, name")
    .eq("active", true)
    .ilike("name", like)
    .limit(10)
  const accountIds = (accounts ?? []).map((row) => String(row.id))
  if (accountIds.length) {
    const { data: byCompany, error: companyError } = await admin
      .from("crm_contacts")
      .select("id, account_id, full_name, email, phone, job_title, linkedin_url, source, notes, active, crm_accounts(id, name)")
      .eq("active", true)
      .in("account_id", accountIds)
      .order("full_name")
      .limit(25)
    if (companyError) throw new McpToolError(companyError.message)
    extra = byCompany ?? []
  }

  const seen = new Set<string>()
  const contactsOut = []
  for (const row of [...(contacts ?? []), ...extra]) {
    const id = String(row.id)
    if (seen.has(id)) continue
    seen.add(id)
    const accountRaw = row.crm_accounts
    const account = Array.isArray(accountRaw) ? accountRaw[0] : accountRaw
    contactsOut.push(mapContact(row as Record<string, unknown>, account as Record<string, unknown> | null))
    if (contactsOut.length >= 25) break
  }

  return { contacts: contactsOut }
}

export async function mcpGetContact(admin: SupabaseClient, id: string): Promise<unknown> {
  const contactId = requireUuid(id, "Contact id")
  const { data, error } = await admin
    .from("crm_contacts")
    .select(
      "id, account_id, full_name, email, phone, job_title, linkedin_url, source, notes, active, created_at, updated_at, crm_accounts(id, name, email, phone, source)",
    )
    .eq("id", contactId)
    .maybeSingle()
  if (error) throw new McpToolError(error.message)
  if (!data) throw new McpToolError(`Contact not found: ${contactId}.`)
  const accountRaw = data.crm_accounts
  const account = Array.isArray(accountRaw) ? accountRaw[0] : accountRaw
  return mapContact(data as Record<string, unknown>, account as Record<string, unknown> | null)
}

export async function mcpCreateOrUpdateContact(
  admin: SupabaseClient,
  input: {
    name: string
    email: string
    company: string
    title: string
    source: string
    phone?: string
    linkedin?: string
    notes?: string
  },
): Promise<unknown> {
  const name = blank(input.name)
  const emailRaw = blank(input.email)
  const company = blank(input.company)
  const title = blank(input.title)
  const sourceRaw = blank(input.source)?.toLowerCase()
  if (!name) throw new McpToolError("name is required.")
  if (!emailRaw) throw new McpToolError("email is required.")
  const email = normalizeEmail(emailRaw)
  if (!EMAIL_RE.test(email)) throw new McpToolError("email is not valid.")
  if (!company) throw new McpToolError("company is required.")
  if (!title) throw new McpToolError("title is required.")
  if (!sourceRaw || !isContactSource(sourceRaw)) {
    throw new McpToolError(`source must be one of: ${MCP_CONTACT_SOURCES.join(", ")}.`)
  }
  const linkedin = input.linkedin?.trim()
    ? sanitizeHttpsUrl(input.linkedin.trim())
    : null
  if (input.linkedin?.trim() && !linkedin) {
    throw new McpToolError("linkedin must be an https URL.")
  }

  const now = new Date().toISOString()
  const { data: existing, error: existingError } = await admin
    .from("crm_contacts")
    .select("id, account_id")
    .ilike("email", email)
    .eq("active", true)
    .limit(1)
    .maybeSingle()
  if (existingError) throw new McpToolError(existingError.message)

  const payload = {
    full_name: name,
    email,
    phone: blank(input.phone),
    job_title: title,
    linkedin_url: linkedin,
    source: sourceRaw,
    notes: blank(input.notes),
    active: true,
    updated_at: now,
  }

  if (existing?.id) {
    const { error } = await admin.from("crm_contacts").update(payload).eq("id", existing.id)
    if (error) throw new McpToolError(error.message)
    return {
      contact_id: String(existing.id),
      created: false,
      account_id: existing.account_id ? String(existing.account_id) : null,
    }
  }

  let accountId: string | null = null
  const { data: account } = await admin
    .from("crm_accounts")
    .select("id")
    .ilike("name", company)
    .eq("active", true)
    .limit(1)
    .maybeSingle()
  if (account?.id) {
    accountId = String(account.id)
  } else {
    const { data: created, error: accountError } = await admin
      .from("crm_accounts")
      .insert({
        name: company,
        account_type: "direct_client",
        email,
        phone: blank(input.phone),
        source: accountSourceFromContactSource(sourceRaw),
        active: true,
      })
      .select("id")
      .maybeSingle()
    if (accountError || !created?.id) {
      throw new McpToolError(accountError?.message ?? "Could not create the company record.")
    }
    accountId = String(created.id)
  }

  const { count } = await admin
    .from("crm_contacts")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("active", true)

  const { data: inserted, error: insertError } = await admin
    .from("crm_contacts")
    .insert({
      account_id: accountId,
      ...payload,
      is_primary: (count ?? 0) === 0,
    })
    .select("id")
    .maybeSingle()
  if (insertError || !inserted?.id) {
    throw new McpToolError(insertError?.message ?? "Could not create the contact.")
  }

  return { contact_id: String(inserted.id), created: true, account_id: accountId }
}

export async function mcpLogActivity(
  admin: SupabaseClient,
  key: McpApiKey,
  input: { contactId: string; type: string; summary: string; timestamp: string },
): Promise<unknown> {
  const contactId = requireUuid(input.contactId, "contact_id")
  const type = input.type.trim()
  if (!isActivityType(type)) {
    throw new McpToolError(`type must be one of: ${MCP_ACTIVITY_TYPES.join(", ")}.`)
  }
  const summary = blank(input.summary)
  if (!summary) throw new McpToolError("summary is required.")
  const occurred = new Date(input.timestamp)
  if (Number.isNaN(occurred.getTime())) {
    throw new McpToolError("timestamp must be an ISO-8601 date, for example 2026-11-26T10:00:00Z.")
  }

  const { data: contact, error: contactError } = await admin
    .from("crm_contacts")
    .select("id")
    .eq("id", contactId)
    .maybeSingle()
  if (contactError) throw new McpToolError(contactError.message)
  if (!contact) throw new McpToolError(`Contact not found: ${contactId}.`)

  const { data: activity, error } = await admin
    .from("crm_contact_activities")
    .insert({
      contact_id: contactId,
      activity_type: type,
      summary,
      occurred_at: occurred.toISOString(),
      source: "mcp",
      mcp_api_key_id: key.id,
      metadata: { key_name: key.name },
    })
    .select("id")
    .maybeSingle()
  if (error) throw new McpToolError(error.message)

  const { data: deals } = await admin
    .from("deals")
    .select("id")
    .eq("primary_contact_id", contactId)
    .in("stage", ["draft", "sourcing", "proposal", "awaiting_booking_form_send"])
    .order("updated_at", { ascending: false })
    .limit(3)

  const action =
    type === "email_sent"
      ? "email_logged"
      : type === "reply"
        ? "reply_logged"
        : type === "call"
          ? "call_logged"
          : "note_logged"
  for (const deal of deals ?? []) {
    await admin.from("deal_activities").insert({
      deal_id: deal.id,
      action,
      summary,
      metadata: { mcp: true, contact_id: contactId, activity_type: type, key_name: key.name },
    })
  }

  return { activity_id: activity?.id ? String(activity.id) : null, logged: true }
}
