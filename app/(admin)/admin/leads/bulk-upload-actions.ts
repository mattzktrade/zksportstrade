"use server"

import type { SupabaseClient } from "@supabase/supabase-js"
import { revalidatePath } from "next/cache"
import { requireAdminAction } from "@/app/(admin)/actions"
import {
  accountBulkKey,
  parseAccountBulkCsv,
  type BulkUploadDefaults,
  type BulkUploadStaff,
  type ParsedAccountBulkRow,
} from "@/lib/crm/account-bulk-upload"
import { parseAccountKinds, primaryAccountType } from "@/lib/crm/account-kinds"
import { newAccountLifecycle } from "@/lib/crm/account-lifecycle"
import { ACCOUNT_SOURCES, type AccountSource } from "@/lib/crm/lead-types"
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows"

type PreviewResult =
  | {
      ok: true
      totalRows: number
      validRows: number
      errorRows: number
      sample: ParsedAccountBulkRow[]
    }
  | { ok: false; message: string }

type ApplyResult =
  | {
      ok: true
      message: string
      accountsCreated: number
      contactsCreated: number
      skipped: number
      failed: number
    }
  | { ok: false; message: string }

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed ? trimmed : null
}

function defaultsFrom(input: {
  source?: string | null
  accountTypes?: string[] | null
  ownerProfileId?: string | null
  staff?: BulkUploadStaff[]
}): BulkUploadDefaults | { ok: false; message: string } {
  const source = (blank(input.source) ?? "marketing") as AccountSource
  if (!(ACCOUNT_SOURCES as readonly string[]).includes(source)) {
    return { ok: false, message: "Choose a valid default source." }
  }
  const ownerProfileId = blank(input.ownerProfileId)
  if (ownerProfileId && !/^[0-9a-f-]{36}$/i.test(ownerProfileId)) {
    return { ok: false, message: "Choose a valid owner." }
  }
  return {
    source,
    accountTypes: parseAccountKinds(input.accountTypes ?? []),
    ownerProfileId,
    staff: input.staff ?? [],
  }
}

async function loadStaff(supabase: SupabaseClient): Promise<BulkUploadStaff[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("role", ["admin", "sales"])
  return (data ?? []).map((profile) => ({
    id: String(profile.id),
    name: String(profile.full_name?.trim() || profile.email || ""),
    email: profile.email ? String(profile.email) : null,
  }))
}

export async function previewAccountBulkUpload(input: {
  csvText: string
  source?: string | null
  accountTypes?: string[] | null
  ownerProfileId?: string | null
}): Promise<PreviewResult> {
  const gate = await requireAdminAction("accounts.manage")
  if (!gate.ok) return gate
  const defaults = defaultsFrom({ ...input, staff: await loadStaff(gate.supabase) })
  if ("ok" in defaults) return defaults
  try {
    const parsed = parseAccountBulkCsv(input.csvText, defaults)
    return {
      ok: true,
      totalRows: parsed.totalRows,
      validRows: parsed.validRows,
      errorRows: parsed.errorRows,
      sample: parsed.rows.slice(0, 80),
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not read that CSV." }
  }
}

export async function applyAccountBulkUpload(input: {
  csvText: string
  source?: string | null
  accountTypes?: string[] | null
  ownerProfileId?: string | null
}): Promise<ApplyResult> {
  const gate = await requireAdminAction("accounts.manage")
  if (!gate.ok) return gate
  const defaults = defaultsFrom({ ...input, staff: await loadStaff(gate.supabase) })
  if ("ok" in defaults) return defaults

  let parsed
  try {
    parsed = parseAccountBulkCsv(input.csvText, defaults)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not read that CSV." }
  }
  if (parsed.validRows === 0) {
    return { ok: false, message: "There are no valid rows to import." }
  }

  const { data: existingAccounts, error: accountLoadError } = await fetchAllRows<{
    id: string
    name: string
    email: string | null
    phone: string | null
    owner_profile_id: string | null
  }>((from, to) =>
    gate.supabase
      .from("crm_accounts")
      .select("id, name, email, phone, owner_profile_id")
      .order("id")
      .range(from, to),
  )
  if (accountLoadError) return { ok: false, message: accountLoadError.message }

  const accountsByKey = new Map<
    string,
    { id: string; email: string | null; phone: string | null; ownerProfileId: string | null }
  >()
  for (const row of existingAccounts ?? []) {
    accountsByKey.set(accountBulkKey(String(row.name)), {
      id: String(row.id),
      email: row.email ? String(row.email) : null,
      phone: row.phone ? String(row.phone) : null,
      ownerProfileId: row.owner_profile_id ? String(row.owner_profile_id) : null,
    })
  }

  const { data: existingContacts, error: contactLoadError } = await fetchAllRows<{
    id: string
    account_id: string
    full_name: string
    email: string | null
  }>((from, to) =>
    gate.supabase
      .from("crm_contacts")
      .select("id, account_id, full_name, email")
      .order("id")
      .range(from, to),
  )
  if (contactLoadError) return { ok: false, message: contactLoadError.message }

  const contactsByAccount = new Map<string, Array<{ name: string; email: string | null }>>()
  for (const row of existingContacts ?? []) {
    const accountId = String(row.account_id)
    const list = contactsByAccount.get(accountId) ?? []
    list.push({
      name: accountBulkKey(String(row.full_name)),
      email: row.email ? String(row.email).trim().toLowerCase() : null,
    })
    contactsByAccount.set(accountId, list)
  }

  let accountsCreated = 0
  let contactsCreated = 0
  let skipped = parsed.errorRows
  let failed = 0
  const createdBy = gate.profile.id
  const groups = new Map<string, ParsedAccountBulkRow[]>()
  for (const row of parsed.rows) {
    if (row.errors.length) continue
    const key = accountBulkKey(row.accountName)
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }

  for (const [key, group] of groups) {
    const first = group[0]
    const groupOwnerId = group.find((row) => row.ownerProfileId)?.ownerProfileId ?? null
    try {
      let account = accountsByKey.get(key)
      if (!account) {
        const created = newAccountLifecycle()
        const { data, error } = await gate.supabase
          .from("crm_accounts")
          .insert({
            name: first.accountName,
            account_type: primaryAccountType(first.accountTypes),
            account_types: first.accountTypes,
            source: first.source,
            email: first.email,
            phone: first.phone,
            notes: first.notes,
            owner_profile_id: groupOwnerId,
            lifecycle: created.lifecycle,
            lead_stage: created.leadStage,
            billing_city: first.city,
            billing_country: first.country,
            created_by: createdBy,
          })
          .select("id")
          .maybeSingle()
        if (error || !data?.id) throw new Error(error?.message ?? "Could not create the account.")
        account = {
          id: String(data.id),
          email: first.email,
          phone: first.phone,
          ownerProfileId: groupOwnerId,
        }
        accountsByKey.set(key, account)
        contactsByAccount.set(account.id, [])
        accountsCreated += 1
      }

      const existing = contactsByAccount.get(account.id) ?? []
      const toInsert: ParsedAccountBulkRow[] = []
      const seenInFile = new Set<string>()
      for (const row of group) {
        const emailKey = row.email || `name:${accountBulkKey(row.contactName)}`
        if (seenInFile.has(emailKey)) {
          skipped += 1
          continue
        }
        const already =
          (row.email && existing.some((contact) => contact.email === row.email)) ||
          existing.some((contact) => contact.name === accountBulkKey(row.contactName) && (!row.email || !contact.email))
        if (already) {
          skipped += 1
          continue
        }
        seenInFile.add(emailKey)
        toInsert.push(row)
      }

      if (toInsert.length) {
        const CONTACT_CHUNK = 200
        for (let offset = 0; offset < toInsert.length; offset += CONTACT_CHUNK) {
          const slice = toInsert.slice(offset, offset + CONTACT_CHUNK)
          const { error: contactError } = await gate.supabase.from("crm_contacts").insert(
            slice.map((row, index) => ({
              account_id: account.id,
              full_name: row.contactName,
              email: row.email,
              phone: row.phone,
              job_title: row.jobTitle,
              notes: row.notes,
              is_primary: existing.length === 0 && offset === 0 && index === 0,
              active: true,
              created_by: createdBy,
            })),
          )
          if (contactError) throw new Error(contactError.message)
        }
        for (const row of toInsert) {
          existing.push({ name: accountBulkKey(row.contactName), email: row.email })
        }
        contactsByAccount.set(account.id, existing)
        contactsCreated += toInsert.length
      }

      const patch: { email?: string | null; phone?: string | null; owner_profile_id?: string | null; updated_at: string } = {
        updated_at: new Date().toISOString(),
      }
      let changed = false
      if (!account.email && first.email) {
        patch.email = first.email
        account.email = first.email
        changed = true
      }
      if (!account.phone && first.phone) {
        patch.phone = first.phone
        account.phone = first.phone
        changed = true
      }
      if (!account.ownerProfileId && groupOwnerId) {
        patch.owner_profile_id = groupOwnerId
        account.ownerProfileId = groupOwnerId
        changed = true
      }
      if (changed) {
        await gate.supabase.from("crm_accounts").update(patch).eq("id", account.id)
      }
    } catch {
      failed += group.length
    }
  }

  revalidatePath("/admin/leads")
  revalidatePath("/admin/clients", "layout")
  revalidatePath("/admin/deals", "layout")

  const bits: string[] = []
  if (contactsCreated) bits.push(`${contactsCreated} contact${contactsCreated === 1 ? "" : "s"} added`)
  if (accountsCreated) bits.push(`${accountsCreated} new account${accountsCreated === 1 ? "" : "s"} created`)
  let message = bits.length ? `${bits.join(", ")}.` : "No new contacts were added."
  if (skipped) message += ` ${skipped} row${skipped === 1 ? "" : "s"} skipped.`
  if (failed) message += ` ${failed} row${failed === 1 ? "" : "s"} failed.`

  return {
    ok: true,
    message,
    accountsCreated,
    contactsCreated,
    skipped,
    failed,
  }
}
