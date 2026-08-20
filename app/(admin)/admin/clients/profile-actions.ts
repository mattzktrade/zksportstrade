"use server"

import { revalidatePath } from "next/cache"
import { requireAdminAction } from "@/app/(admin)/actions"
import {
  parseAccountKinds,
  primaryAccountType,
  type AccountKind,
} from "@/lib/crm/account-kinds"
import { adminAccountPath, adminContactPath, adminSupplierPath } from "@/lib/crm/profile-links"
import { ensureSupplierForAccount } from "@/lib/inventory/suppliers"
import type { SupabaseClient } from "@supabase/supabase-js"

type Result =
  | { ok: true; message?: string; accountId?: string; contactId?: string }
  | { ok: false; message: string }

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ACCOUNT_SOURCES = new Set(["manual", "website", "referral", "marketing", "other"])

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed ? trimmed : null
}

function revalidateCompany(accountId: string, contactId?: string | null, supplierId?: string | null) {
  revalidatePath(adminAccountPath(accountId), "layout")
  revalidatePath("/admin/clients", "layout")
  revalidatePath("/admin/leads")
  revalidatePath("/admin/deals", "layout")
  revalidatePath("/admin/suppliers")
  revalidatePath("/admin/purchase-orders")
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/inventory")
  if (contactId) revalidatePath(adminContactPath(accountId, contactId))
  if (supplierId) revalidatePath(adminSupplierPath(supplierId))
}

function mapCrmRpcError(message: string): string {
  const key = message.toLowerCase()
  if (key.includes("forbidden")) return "You do not have permission to do this."
  if (key.includes("same_record")) return "Choose a different record to merge into."
  if (key.includes("account_not_found") || key.includes("account_required")) return "Company not found."
  if (key.includes("contact_not_found") || key.includes("contact_required")) return "Contact not found."
  return message
}

async function syncLinkedSupplierFromAccount(supabase: SupabaseClient, accountId: string) {
  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id")
    .eq("crm_account_id", accountId)
    .maybeSingle()
  if (!supplier?.id) return null

  const [{ data: account }, { data: primary }] = await Promise.all([
    supabase
      .from("crm_accounts")
      .select("name, email, phone, notes, active")
      .eq("id", accountId)
      .maybeSingle(),
    supabase
      .from("crm_contacts")
      .select("full_name, email, phone")
      .eq("account_id", accountId)
      .eq("is_primary", true)
      .eq("active", true)
      .maybeSingle(),
  ])
  if (!account) return String(supplier.id)

  await supabase
    .from("suppliers")
    .update({
      name: account.name,
      ...(primary
        ? {
            contact_name: blank(primary.full_name),
            contact_email: blank(primary.email) ?? blank(account.email),
            contact_phone: blank(primary.phone) ?? blank(account.phone),
          }
        : {}),
      notes: blank(account.notes),
      active: account.active ?? true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", supplier.id)
  return String(supplier.id)
}

async function syncAccountFromSupplier(
  supabase: SupabaseClient,
  supplierId: string,
  input: {
    name: string
    contactName?: string | null
    contactEmail?: string | null
    contactPhone?: string | null
    notes?: string | null
    active?: boolean
  },
) {
  const { data: accountId, error } = await supabase.rpc("admin_ensure_account_for_supplier", {
    p_supplier_id: supplierId,
  })
  if (error || !accountId) return { accountId: null as string | null, error: error?.message ?? null }
  const id = String(accountId)

  await supabase
    .from("crm_accounts")
    .update({
      name: input.name,
      email: blank(input.contactEmail),
      phone: blank(input.contactPhone),
      notes: blank(input.notes),
      active: input.active ?? true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  const contactName = blank(input.contactName)
  if (contactName) {
    const { data: primary } = await supabase
      .from("crm_contacts")
      .select("id")
      .eq("account_id", id)
      .eq("is_primary", true)
      .maybeSingle()
    if (primary?.id) {
      await supabase
        .from("crm_contacts")
        .update({
          full_name: contactName,
          email: blank(input.contactEmail),
          phone: blank(input.contactPhone),
          updated_at: new Date().toISOString(),
        })
        .eq("id", primary.id)
    } else {
      await supabase.from("crm_contacts").insert({
        account_id: id,
        full_name: contactName,
        email: blank(input.contactEmail),
        phone: blank(input.contactPhone),
        is_primary: true,
        active: true,
      })
    }
  }

  return { accountId: id, error: null }
}

function resolveKinds(input: string[] | null | undefined): AccountKind[] {
  return parseAccountKinds(input ?? [])
}

export async function updateCrmAccountDetails(input: {
  accountId: string
  name: string
  accountTypes?: string[] | null
  email?: string | null
  phone?: string | null
  notes?: string | null
  ownerProfileId?: string | null
  source?: string | null
  active?: boolean
  billing?: {
    line1?: string | null
    line2?: string | null
    city?: string | null
    postcode?: string | null
    country?: string | null
  }
}): Promise<Result> {
  const gate = await requireAdminAction("accounts.manage")
  if (!gate.ok) return gate
  const accountId = input.accountId.trim()
  if (!UUID_RE.test(accountId)) return { ok: false, message: "Invalid company id." }
  const name = blank(input.name)
  if (!name) return { ok: false, message: "Company name is required." }
  const accountTypes = resolveKinds(input.accountTypes)
  const ownerProfileId = blank(input.ownerProfileId)
  if (ownerProfileId && !UUID_RE.test(ownerProfileId)) return { ok: false, message: "Invalid owner." }
  const source = blank(input.source) ?? "manual"
  if (!ACCOUNT_SOURCES.has(source)) return { ok: false, message: "Account source is not valid." }

  const { error } = await gate.supabase
    .from("crm_accounts")
    .update({
      name,
      account_type: primaryAccountType(accountTypes),
      account_types: accountTypes,
      email: blank(input.email),
      phone: blank(input.phone),
      notes: blank(input.notes),
      owner_profile_id: ownerProfileId,
      source,
      active: input.active ?? true,
      billing_address_line1: blank(input.billing?.line1),
      billing_address_line2: blank(input.billing?.line2),
      billing_city: blank(input.billing?.city),
      billing_postcode: blank(input.billing?.postcode),
      billing_country: blank(input.billing?.country),
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
  if (error) {
    if (error.message.toLowerCase().includes("crm_accounts_name_unique")) {
      return { ok: false, message: "Another company already uses that name." }
    }
    return { ok: false, message: error.message }
  }
  if (accountTypes.includes("supplier")) {
    await ensureSupplierForAccount(gate.supabase, accountId)
  }
  const supplierId = await syncLinkedSupplierFromAccount(gate.supabase, accountId)
  revalidateCompany(accountId, null, supplierId)
  return { ok: true, message: "Company details saved." }
}

export async function createCrmAccount(input: {
  name: string
  accountTypes?: string[] | null
  source?: string | null
  email?: string | null
  phone?: string | null
  notes?: string | null
  ownerProfileId?: string | null
  billing?: {
    line1?: string | null
    line2?: string | null
    city?: string | null
    postcode?: string | null
    country?: string | null
  }
  contacts?: Array<{
    fullName?: string | null
    email?: string | null
    phone?: string | null
    jobTitle?: string | null
  }>
  raceIds?: string[] | null
}): Promise<Result> {
  const gate = await requireAdminAction("accounts.manage")
  if (!gate.ok) return gate
  const name = blank(input.name)
  if (!name) return { ok: false, message: "Company name is required." }
  const accountTypes = resolveKinds(input.accountTypes)
  const source = blank(input.source) ?? "manual"
  if (!ACCOUNT_SOURCES.has(source)) return { ok: false, message: "Account source is not valid." }
  const ownerProfileId = blank(input.ownerProfileId)
  if (ownerProfileId && !UUID_RE.test(ownerProfileId)) return { ok: false, message: "Invalid owner." }

  const contacts = (input.contacts ?? [])
    .map((contact) => ({
      fullName: blank(contact.fullName),
      email: blank(contact.email),
      phone: blank(contact.phone),
      jobTitle: blank(contact.jobTitle),
    }))
    .filter((contact) => contact.fullName || contact.email || contact.phone || contact.jobTitle)
  const incomplete = contacts.find((contact) => !contact.fullName)
  if (incomplete) return { ok: false, message: "Each contact needs a name." }

  const primary = contacts[0] ?? null

  const { data, error } = await gate.supabase
    .from("crm_accounts")
    .insert({
      name,
      account_type: primaryAccountType(accountTypes),
      account_types: accountTypes,
      source,
      email: blank(input.email) ?? primary?.email ?? null,
      phone: blank(input.phone) ?? primary?.phone ?? null,
      notes: blank(input.notes),
      owner_profile_id: ownerProfileId,
      billing_address_line1: blank(input.billing?.line1),
      billing_address_line2: blank(input.billing?.line2),
      billing_city: blank(input.billing?.city),
      billing_postcode: blank(input.billing?.postcode),
      billing_country: blank(input.billing?.country),
      created_by: gate.profile.id,
    })
    .select("id")
    .maybeSingle()
  if (error) {
    if (error.message.toLowerCase().includes("crm_accounts_name_unique")) {
      return { ok: false, message: "Another company already uses that name." }
    }
    return { ok: false, message: error.message }
  }
  const accountId = data?.id ? String(data.id) : null
  if (!accountId) return { ok: false, message: "Account was created but its id was not returned." }

  let createdContactId: string | undefined
  if (contacts.length > 0) {
    const { data: contactRows, error: contactError } = await gate.supabase
      .from("crm_contacts")
      .insert(
        contacts.map((contact, index) => ({
          account_id: accountId,
          full_name: contact.fullName,
          email: contact.email,
          phone: contact.phone,
          job_title: contact.jobTitle,
          is_primary: index === 0,
          active: true,
          created_by: gate.profile.id,
        })),
      )
      .select("id")
    if (contactError) {
      revalidateCompany(accountId)
      return {
        ok: false,
        message: `Account created, but contacts could not be saved: ${contactError.message}`,
      }
    }
    createdContactId = contactRows?.[0]?.id ? String(contactRows[0].id) : undefined
  }

  if (accountTypes.includes("supplier")) {
    const supplier = await ensureSupplierForAccount(gate.supabase, accountId)
    if (!supplier.ok) {
      revalidateCompany(accountId)
      return {
        ok: false,
        message: `Account created, but the supplier record could not be set up: ${supplier.message}`,
      }
    }
  }

  const raceIds = [...new Set((input.raceIds ?? []).map((id) => id.trim()).filter((id) => UUID_RE.test(id)))]
  if (raceIds.length > 0) {
    const { error: interestError } = await gate.supabase.from("crm_account_event_interests").insert(
      raceIds.map((race_id) => ({ account_id: accountId, race_id })),
    )
    if (interestError) {
      revalidateCompany(accountId)
      return {
        ok: false,
        message: `Account created, but event interests could not be saved: ${interestError.message}`,
      }
    }
  }

  revalidateCompany(accountId, createdContactId)
  return { ok: true, message: "Account created.", accountId, contactId: createdContactId }
}

export async function assignAccountOwner(input: {
  accountId: string
  ownerProfileId?: string | null
}): Promise<Result> {
  const gate = await requireAdminAction("accounts.manage")
  if (!gate.ok) return gate
  const accountId = input.accountId.trim()
  if (!UUID_RE.test(accountId)) return { ok: false, message: "Invalid company id." }
  const ownerProfileId = blank(input.ownerProfileId)
  if (ownerProfileId && !UUID_RE.test(ownerProfileId)) return { ok: false, message: "Invalid owner." }

  const { error } = await gate.supabase
    .from("crm_accounts")
    .update({
      owner_profile_id: ownerProfileId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
  if (error) return { ok: false, message: error.message }
  revalidateCompany(accountId)
  return { ok: true, message: ownerProfileId ? "Owner assigned." : "Owner cleared." }
}

export async function updateCrmAccountInterests(input: {
  accountId: string
  raceIds: string[]
}): Promise<Result> {
  const gate = await requireAdminAction("accounts.manage")
  if (!gate.ok) return gate
  const accountId = input.accountId.trim()
  if (!UUID_RE.test(accountId)) return { ok: false, message: "Invalid company id." }
  const raceIds = [...new Set(input.raceIds.map((id) => id.trim()).filter(Boolean))]

  const { error: deleteError } = await gate.supabase
    .from("crm_account_event_interests")
    .delete()
    .eq("account_id", accountId)
  if (deleteError) return { ok: false, message: deleteError.message }
  if (raceIds.length > 0) {
    const { error } = await gate.supabase.from("crm_account_event_interests").insert(
      raceIds.map((race_id) => ({ account_id: accountId, race_id })),
    )
    if (error) return { ok: false, message: error.message }
  }
  revalidateCompany(accountId)
  return { ok: true, message: "Event interests saved." }
}

export async function upsertCrmContact(input: {
  accountId: string
  contactId?: string | null
  fullName: string
  email?: string | null
  phone?: string | null
  jobTitle?: string | null
  notes?: string | null
  isPrimary?: boolean
  active?: boolean
}): Promise<Result> {
  const gate = await requireAdminAction("accounts.manage")
  if (!gate.ok) return gate
  const accountId = input.accountId.trim()
  if (!UUID_RE.test(accountId)) return { ok: false, message: "Invalid company id." }
  const fullName = blank(input.fullName)
  if (!fullName) return { ok: false, message: "Contact name is required." }
  const contactId = blank(input.contactId)
  if (contactId && !UUID_RE.test(contactId)) return { ok: false, message: "Invalid contact id." }

  if (input.isPrimary) {
    await gate.supabase
      .from("crm_contacts")
      .update({ is_primary: false, updated_at: new Date().toISOString() })
      .eq("account_id", accountId)
      .eq("is_primary", true)
  }

  const payload = {
    full_name: fullName,
    email: blank(input.email),
    phone: blank(input.phone),
    job_title: blank(input.jobTitle),
    notes: blank(input.notes),
    is_primary: Boolean(input.isPrimary),
    active: input.active ?? true,
    updated_at: new Date().toISOString(),
  }

  if (contactId) {
    const { error } = await gate.supabase.from("crm_contacts").update(payload).eq("id", contactId).eq("account_id", accountId)
    if (error) return { ok: false, message: error.message }
    const supplierId = await syncLinkedSupplierFromAccount(gate.supabase, accountId)
    revalidateCompany(accountId, contactId, supplierId)
    return { ok: true, message: "Contact updated." }
  }

  const { data, error } = await gate.supabase
    .from("crm_contacts")
    .insert({
      account_id: accountId,
      ...payload,
      created_by: gate.profile.id,
    })
    .select("id")
    .maybeSingle()
  if (error) return { ok: false, message: error.message }
  const createdId = data?.id ? String(data.id) : undefined
  const supplierId = await syncLinkedSupplierFromAccount(gate.supabase, accountId)
  revalidateCompany(accountId, createdId, supplierId)
  return { ok: true, message: "Contact added.", contactId: createdId }
}

export async function updateSupplierDetails(input: {
  supplierId: string
  name: string
  code?: string | null
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  notes?: string | null
  active?: boolean
}): Promise<Result> {
  const gate = await requireAdminAction("accounts.manage")
  if (!gate.ok) return gate
  const supplierId = input.supplierId.trim()
  if (!UUID_RE.test(supplierId)) return { ok: false, message: "Invalid supplier id." }
  const name = blank(input.name)
  if (!name) return { ok: false, message: "Supplier name is required." }

  const { error } = await gate.supabase
    .from("suppliers")
    .update({
      name,
      code: blank(input.code),
      contact_name: blank(input.contactName),
      contact_email: blank(input.contactEmail),
      contact_phone: blank(input.contactPhone),
      notes: blank(input.notes),
      active: input.active ?? true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", supplierId)
  if (error) {
    if (error.message.toLowerCase().includes("suppliers_name_unique")) {
      return { ok: false, message: "Another supplier already uses that name." }
    }
    return { ok: false, message: error.message }
  }
  const synced = await syncAccountFromSupplier(gate.supabase, supplierId, {
    name,
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    notes: input.notes,
    active: input.active,
  })
  if (synced.error) {
    return {
      ok: false,
      message: `Supplier saved, but the Accounts record could not be updated: ${synced.error}`,
    }
  }
  revalidatePath(adminSupplierPath(supplierId))
  revalidatePath("/admin/suppliers")
  revalidatePath("/admin/purchase-orders")
  if (synced.accountId) revalidateCompany(synced.accountId, null, supplierId)
  return { ok: true, message: "Supplier details saved." }
}

export async function updateSupplierEventCoverage(input: {
  supplierId: string
  raceIds: string[]
}): Promise<Result> {
  const gate = await requireAdminAction("accounts.manage")
  if (!gate.ok) return gate
  const supplierId = input.supplierId.trim()
  if (!UUID_RE.test(supplierId)) return { ok: false, message: "Invalid supplier id." }
  const raceIds = [...new Set(input.raceIds.map((id) => id.trim()).filter(Boolean))]

  const { error: deleteError } = await gate.supabase
    .from("supplier_event_coverage")
    .delete()
    .eq("supplier_id", supplierId)
  if (deleteError) return { ok: false, message: deleteError.message }
  if (raceIds.length > 0) {
    const { error } = await gate.supabase.from("supplier_event_coverage").insert(
      raceIds.map((race_id) => ({ supplier_id: supplierId, race_id })),
    )
    if (error) return { ok: false, message: error.message }
  }
  revalidatePath(adminSupplierPath(supplierId))
  revalidatePath("/admin/suppliers")
  return { ok: true, message: "Supplier event coverage saved." }
}

export type CrmMergeAccountOption = { id: string; name: string }
export type CrmMergeContactOption = {
  id: string
  accountId: string
  fullName: string
  accountName: string
  email: string | null
}

export async function listCrmMergeAccountOptions(): Promise<CrmMergeAccountOption[]> {
  const gate = await requireAdminAction("accounts.manage")
  if (!gate.ok) return []
  const { data, error } = await gate.supabase
    .from("crm_accounts")
    .select("id, name")
    .order("name")
  if (error || !data) return []
  return data.map((row) => ({ id: String(row.id), name: String(row.name) }))
}

export async function listCrmMergeContactOptions(): Promise<CrmMergeContactOption[]> {
  const gate = await requireAdminAction("accounts.manage")
  if (!gate.ok) return []
  const { data, error } = await gate.supabase
    .from("crm_contacts")
    .select("id, full_name, email, account_id, crm_accounts(name)")
    .order("full_name")
  if (error || !data) return []
  return data.map((row) => {
    const account = Array.isArray(row.crm_accounts) ? row.crm_accounts[0] : row.crm_accounts
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      fullName: String(row.full_name),
      accountName: account?.name ? String(account.name) : "Unknown company",
      email: row.email ? String(row.email) : null,
    }
  })
}

export async function deleteCrmAccount(input: { accountId: string }): Promise<Result> {
  const gate = await requireAdminAction("accounts.manage")
  if (!gate.ok) return gate
  const accountId = input.accountId.trim()
  if (!UUID_RE.test(accountId)) return { ok: false, message: "Invalid company id." }

  const { error } = await gate.supabase.rpc("admin_delete_crm_account", { p_account_id: accountId })
  if (error) return { ok: false, message: mapCrmRpcError(error.message) }
  revalidateCompany(accountId)
  return { ok: true, message: "Company deleted." }
}

export async function deleteCrmContact(input: { contactId: string; accountId?: string | null }): Promise<Result> {
  const gate = await requireAdminAction("accounts.manage")
  if (!gate.ok) return gate
  const contactId = input.contactId.trim()
  if (!UUID_RE.test(contactId)) return { ok: false, message: "Invalid contact id." }
  const accountId = blank(input.accountId)
  if (accountId && !UUID_RE.test(accountId)) return { ok: false, message: "Invalid company id." }

  const { error } = await gate.supabase.rpc("admin_delete_crm_contact", { p_contact_id: contactId })
  if (error) return { ok: false, message: mapCrmRpcError(error.message) }
  if (accountId) revalidateCompany(accountId, contactId)
  else {
    revalidatePath("/admin/clients", "layout")
    revalidatePath("/admin/leads")
    revalidatePath("/admin/deals", "layout")
  }
  return { ok: true, message: "Contact deleted.", accountId: accountId ?? undefined }
}

export async function mergeCrmAccounts(input: {
  sourceAccountId: string
  targetAccountId: string
}): Promise<Result> {
  const gate = await requireAdminAction("accounts.manage")
  if (!gate.ok) return gate
  const sourceAccountId = input.sourceAccountId.trim()
  const targetAccountId = input.targetAccountId.trim()
  if (!UUID_RE.test(sourceAccountId) || !UUID_RE.test(targetAccountId)) {
    return { ok: false, message: "Invalid company id." }
  }
  if (sourceAccountId === targetAccountId) {
    return { ok: false, message: "Choose a different company to merge into." }
  }

  const { error } = await gate.supabase.rpc("admin_merge_crm_accounts", {
    p_source_id: sourceAccountId,
    p_target_id: targetAccountId,
  })
  if (error) return { ok: false, message: mapCrmRpcError(error.message) }
  const supplierId = await syncLinkedSupplierFromAccount(gate.supabase, targetAccountId)
  revalidateCompany(sourceAccountId)
  revalidateCompany(targetAccountId, null, supplierId)
  return { ok: true, message: "Companies merged.", accountId: targetAccountId }
}

export async function mergeCrmContacts(input: {
  sourceContactId: string
  targetContactId: string
}): Promise<Result> {
  const gate = await requireAdminAction("accounts.manage")
  if (!gate.ok) return gate
  const sourceContactId = input.sourceContactId.trim()
  const targetContactId = input.targetContactId.trim()
  if (!UUID_RE.test(sourceContactId) || !UUID_RE.test(targetContactId)) {
    return { ok: false, message: "Invalid contact id." }
  }
  if (sourceContactId === targetContactId) {
    return { ok: false, message: "Choose a different contact to merge into." }
  }

  const { data: source } = await gate.supabase
    .from("crm_contacts")
    .select("account_id")
    .eq("id", sourceContactId)
    .maybeSingle()

  const { error } = await gate.supabase.rpc("admin_merge_crm_contacts", {
    p_source_id: sourceContactId,
    p_target_id: targetContactId,
  })
  if (error) return { ok: false, message: mapCrmRpcError(error.message) }

  const { data: target } = await gate.supabase
    .from("crm_contacts")
    .select("id, account_id")
    .eq("id", targetContactId)
    .maybeSingle()
  const targetAccountId = target?.account_id ? String(target.account_id) : null
  const sourceAccountId = source?.account_id ? String(source.account_id) : null
  if (sourceAccountId) revalidateCompany(sourceAccountId, sourceContactId)
  if (targetAccountId) {
    const supplierId = await syncLinkedSupplierFromAccount(gate.supabase, targetAccountId)
    revalidateCompany(targetAccountId, targetContactId, supplierId)
  }
  return {
    ok: true,
    message: "Contacts merged.",
    accountId: targetAccountId ?? undefined,
    contactId: targetContactId,
  }
}
