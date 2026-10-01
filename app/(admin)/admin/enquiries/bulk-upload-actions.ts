"use server"

import { revalidatePath } from "next/cache"
import { requireAdminAction } from "@/app/(admin)/actions"
import {
  ENQUIRY_BULK_MAX_ROWS,
  markPackageDuplicates,
  matrixFromCsv,
  parseEnquiryBulkMatrix,
  type ParsedEnquiryBulkRow,
  type ParsedEnquiryBulkUpload,
} from "@/lib/crm/enquiry-bulk-upload"
import { suggestedEnquiryAction } from "@/lib/crm/deal-pipeline"
import { normalizeMarketingPhone } from "@/lib/integrations/marketing-leads/parse"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows"

const SPREADSHEET_MAX_BYTES = 20 * 1024 * 1024
const CLOSED_DEAL_STAGES = new Set(["cancelled", "closed_lost"])

type PreviewResult = ({ ok: true } & ParsedEnquiryBulkUpload) | { ok: false; message: string }

type ApplyResult =
  | { ok: true; message: string; created: number; skipped: number; failed: number }
  | { ok: false; message: string }

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>

type ContactMatch = {
  id: string
  account_id: string
  full_name: string
  email: string | null
  phone: string | null
}

type AccountMatch = {
  id: string
  name: string
  email: string | null
}

type PackageMatch = {
  id: string
  name: string
  race_id: string | null
  currency: string | null
  shell_parent_package_id: string | null
}

function clientKey(row: ParsedEnquiryBulkRow): string {
  if (row.email) return `email:${row.email}`
  return `phone:${normalizeMarketingPhone(row.phone)}`
}

function quotedOr(column: string, values: string[]): string {
  return values.map((value) => `${column}.ilike."${value.replaceAll('"', "")}"`).join(",")
}

async function matrixFromUpload(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase()
  if (name.endsWith(".xls") && !name.endsWith(".xlsx")) {
    throw new Error("Please save the workbook as .xlsx (Excel workbook), not the older .xls format.")
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    const { matrixFromXlsx } = await import("@/lib/crm/enquiry-bulk-xlsx")
    return matrixFromXlsx(Buffer.from(await file.arrayBuffer()))
  }
  if (name.endsWith(".csv") || name.endsWith(".txt") || file.type.includes("csv") || file.type.includes("text")) {
    return matrixFromCsv(await file.text())
  }
  throw new Error("Upload an Excel workbook (.xlsx) or a CSV export.")
}

async function fileFromForm(formData: FormData): Promise<File> {
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a CSV or Excel (.xlsx) file.")
  }
  if (file.size > SPREADSHEET_MAX_BYTES) {
    throw new Error("Please keep the spreadsheet to 20MB or smaller.")
  }
  return file
}

async function loadPackage(admin: AdminClient, packageId: string): Promise<PackageMatch> {
  const id = packageId.trim()
  if (!id) throw new Error("Choose the package these enquiries are for.")
  const { data, error } = await admin
    .from("packages")
    .select("id, name, race_id, currency, shell_parent_package_id")
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error("That package was not found.")
  if (data.shell_parent_package_id) {
    throw new Error("Choose the main package, not a single-day part of it.")
  }
  return data as PackageMatch
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

async function loadLiveHolders(
  admin: AdminClient,
  packageId: string,
): Promise<{ accountIds: Set<string>; contactIds: Set<string> }> {
  const accountIds = new Set<string>()
  const contactIds = new Set<string>()
  const { data, error } = await fetchAllRows<{
    id: string
    deals:
      | { account_id: string | null; primary_contact_id: string | null; stage: string | null }
      | Array<{ account_id: string | null; primary_contact_id: string | null; stage: string | null }>
      | null
  }>((from, to) =>
    admin
      .from("deal_line_items")
      .select("id, deals!inner(account_id, primary_contact_id, stage)")
      .eq("package_id", packageId)
      .order("id")
      .range(from, to),
  )
  if (error) throw new Error(error.message)
  for (const row of data) {
    const deal = one(row.deals)
    if (!deal || CLOSED_DEAL_STAGES.has(deal.stage ?? "")) continue
    if (deal.account_id) accountIds.add(deal.account_id)
    if (deal.primary_contact_id) contactIds.add(deal.primary_contact_id)
  }
  return { accountIds, contactIds }
}

async function fetchByOr<T>(
  load: (filter: string) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  column: string,
  values: string[],
): Promise<T[]> {
  const rows: T[] = []
  for (let index = 0; index < values.length; index += 25) {
    const chunk = values.slice(index, index + 25).filter(Boolean)
    if (chunk.length === 0) continue
    const { data, error } = await load(quotedOr(column, chunk))
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
  }
  return rows
}

async function loadMatches(admin: AdminClient, rows: ParsedEnquiryBulkRow[]) {
  const ready = rows.filter((row) => row.status === "ready")
  const emails = [...new Set(ready.map((row) => row.email).filter((email): email is string => Boolean(email)))]
  const phones = [
    ...new Set(
      ready
        .filter((row) => !row.email && row.phone)
        .map((row) => row.phone)
        .filter((phone): phone is string => Boolean(phone)),
    ),
  ]
  const contacts = await fetchByOr<ContactMatch>(
    async (filter) =>
      admin
        .from("crm_contacts")
        .select("id, account_id, full_name, email, phone")
        .eq("active", true)
        .or(filter),
    "email",
    emails,
  )
  const accounts = await fetchByOr<AccountMatch>(
    async (filter) => admin.from("crm_accounts").select("id, name, email").eq("active", true).or(filter),
    "email",
    emails,
  )
  for (const phone of phones) {
    const digits = normalizeMarketingPhone(phone)
    if (digits.length < 8) continue
    const { data, error } = await admin
      .from("crm_contacts")
      .select("id, account_id, full_name, email, phone")
      .eq("active", true)
      .ilike("phone", `%${digits.slice(-8)}%`)
      .limit(20)
    if (error) throw new Error(error.message)
    for (const contact of (data ?? []) as ContactMatch[]) {
      if (normalizeMarketingPhone(contact.phone) === digits) contacts.push(contact)
    }
  }
  return { contacts, accounts }
}

function contactFor(
  row: ParsedEnquiryBulkRow,
  contacts: ContactMatch[],
  holders: { accountIds: Set<string>; contactIds: Set<string> },
): ContactMatch | null {
  if (row.email) {
    const matches = contacts.filter((contact) => (contact.email ?? "").trim().toLowerCase() === row.email)
    return (
      matches.find(
        (contact) => holders.accountIds.has(contact.account_id) || holders.contactIds.has(contact.id),
      ) ??
      matches[0] ??
      null
    )
  }
  const digits = normalizeMarketingPhone(row.phone)
  if (digits.length < 8) return null
  const matches = contacts.filter((contact) => normalizeMarketingPhone(contact.phone) === digits)
  return (
    matches.find(
      (contact) => holders.accountIds.has(contact.account_id) || holders.contactIds.has(contact.id),
    ) ??
    matches[0] ??
    null
  )
}

function accountFor(row: ParsedEnquiryBulkRow, accounts: AccountMatch[]): AccountMatch | null {
  if (!row.email) return null
  return accounts.find((account) => (account.email ?? "").trim().toLowerCase() === row.email) ?? null
}

async function withDuplicates(
  admin: AdminClient,
  packageId: string,
  parsed: ParsedEnquiryBulkUpload,
): Promise<ParsedEnquiryBulkUpload> {
  const holders = await loadLiveHolders(admin, packageId)
  const { contacts, accounts } = await loadMatches(admin, parsed.rows)
  const emails = new Set<string>()
  const phones = new Set<string>()
  for (const row of parsed.rows) {
    if (row.status !== "ready") continue
    const contact = contactFor(row, contacts, holders)
    const account = accountFor(row, accounts)
    const accountId = contact?.account_id ?? account?.id ?? null
    const held =
      (accountId != null && holders.accountIds.has(accountId)) ||
      (contact != null && holders.contactIds.has(contact.id))
    if (!held) continue
    if (row.email) emails.add(row.email)
    else {
      const digits = normalizeMarketingPhone(row.phone)
      if (digits.length >= 8) phones.add(digits)
    }
  }
  const rows = markPackageDuplicates(parsed.rows, { emails, phones })
  return {
    rows,
    totalRows: rows.length,
    readyRows: rows.filter((row) => row.status === "ready").length,
    duplicateRows: rows.filter((row) => row.status === "duplicate").length,
    errorRows: rows.filter((row) => row.status === "error").length,
  }
}

function claimName(taken: Set<string>, base: string, suffix: string): string {
  const clean = base.trim().replace(/\s+/g, " ").slice(0, 180)
  if (clean && !taken.has(clean.toLowerCase())) {
    taken.add(clean.toLowerCase())
    return clean
  }
  const withSuffix = `${clean} (${suffix})`.slice(0, 180)
  if (!taken.has(withSuffix.toLowerCase())) {
    taken.add(withSuffix.toLowerCase())
    return withSuffix
  }
  const extra = `${clean} (${suffix}-${taken.size})`.slice(0, 180)
  taken.add(extra.toLowerCase())
  return extra
}

function uniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === "23505" || /duplicate key|unique/i.test(error.message ?? "")
}

async function readPrepared(formData: FormData) {
  const gate = await requireAdminAction("deals.manage")
  if (!gate.ok) return gate
  const admin = createAdminClient()
  if (!admin) return { ok: false as const, message: "Service role is not configured." }
  const file = await fileFromUpload(formData)
  const packageId = String(formData.get("packageId") ?? "")
  const packageRow = await loadPackage(admin, packageId)
  const parsed = parseEnquiryBulkMatrix(await matrixFromUpload(file))
  if (parsed.totalRows === 0) {
    return { ok: false as const, message: "That file has no data rows." }
  }
  if (parsed.totalRows > ENQUIRY_BULK_MAX_ROWS) {
    return { ok: false as const, message: `Please keep the upload to ${ENQUIRY_BULK_MAX_ROWS} rows or fewer.` }
  }
  const prepared = await withDuplicates(admin, packageRow.id, parsed)
  return { ok: true as const, admin, profileId: gate.profile.id, packageRow, prepared }
}

async function fileFromUpload(formData: FormData): Promise<File> {
  return fileFromForm(formData)
}

export async function previewEnquiryBulkUpload(formData: FormData): Promise<PreviewResult> {
  try {
    const result = await readPrepared(formData)
    if (!result.ok) return result
    return { ok: true, ...result.prepared }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The spreadsheet could not be read." }
  }
}

export async function applyEnquiryBulkUpload(formData: FormData): Promise<ApplyResult> {
  try {
    const result = await readPrepared(formData)
    if (!result.ok) return result
    const { admin, profileId, packageRow, prepared } = result
    const ready = prepared.rows.filter((row) => row.status === "ready" && row.quantity != null && row.fullName)
    if (ready.length === 0) {
      return {
        ok: false,
        message:
          prepared.duplicateRows > 0
            ? "Everyone in that file already has an enquiry or deal for this package."
            : "There are no valid rows to import.",
      }
    }

    const holders = await loadLiveHolders(admin, packageRow.id)
    const { contacts, accounts } = await loadMatches(admin, ready)
    const takenNames = new Set(accounts.map((account) => account.name.trim().toLowerCase()))
    const accountIdByKey = new Map<string, string>()
    const contactIdByKey = new Map<string, string>()
    const phonePatches: Array<{ id: string; phone: string }> = []

    type NewAccount = { key: string; name: string; email: string | null; phone: string | null }
    type NewContact = { key: string; accountKey: string; accountId: string | null; fullName: string; email: string | null; phone: string | null; isPrimary: boolean }
    const newAccounts: NewAccount[] = []
    const newContacts: NewContact[] = []

    for (const row of ready) {
      const key = clientKey(row)
      const contact = contactFor(row, contacts, holders)
      if (contact) {
        accountIdByKey.set(key, contact.account_id)
        contactIdByKey.set(key, contact.id)
        if (!contact.phone && row.phone) phonePatches.push({ id: contact.id, phone: row.phone })
        continue
      }
      const account = accountFor(row, accounts)
      if (account) {
        accountIdByKey.set(key, account.id)
        newContacts.push({
          key,
          accountKey: key,
          accountId: account.id,
          fullName: row.fullName,
          email: row.email,
          phone: row.phone,
          isPrimary: false,
        })
        continue
      }
      const suffix = row.email ?? normalizeMarketingPhone(row.phone) ?? "lead"
      newAccounts.push({
        key,
        name: claimName(takenNames, row.fullName, suffix),
        email: row.email,
        phone: row.phone,
      })
      newContacts.push({
        key,
        accountKey: key,
        accountId: null,
        fullName: row.fullName,
        email: row.email,
        phone: row.phone,
        isPrimary: true,
      })
    }

    const accountIds = new Map<string, string>()
    if (newAccounts.length > 0) {
      const payloads = newAccounts.map((account) => ({
        name: account.name,
        account_type: "direct_client",
        account_types: ["direct_client"],
        email: account.email,
        phone: account.phone,
        source: "marketing",
        lifecycle: "lead",
        lead_stage: "new",
        active: true,
        created_by: profileId,
      }))
      const inserted = await admin.from("crm_accounts").insert(payloads).select("id, name")
      if (inserted.error && uniqueViolation(inserted.error)) {
        for (const account of newAccounts) {
          let name = account.name
          let createdId: string | null = null
          for (let attempt = 0; attempt < 3 && !createdId; attempt += 1) {
            const single = await admin
              .from("crm_accounts")
              .insert({
                name,
                account_type: "direct_client",
                account_types: ["direct_client"],
                email: account.email,
                phone: account.phone,
                source: "marketing",
                lifecycle: "lead",
                lead_stage: "new",
                active: true,
                created_by: profileId,
              })
              .select("id")
              .single()
            if (!single.error && single.data) {
              createdId = String(single.data.id)
              break
            }
            if (!uniqueViolation(single.error)) {
              return { ok: false, message: single.error?.message || "Could not create a client account." }
            }
            name = `${account.name} (${account.email ?? attempt + 1})`.slice(0, 180)
          }
          if (!createdId) return { ok: false, message: `Could not create an account for ${account.name}.` }
          accountIds.set(account.key, createdId)
        }
      } else if (inserted.error || !inserted.data) {
        return { ok: false, message: inserted.error?.message || "Could not create client accounts." }
      } else {
        const byName = new Map(inserted.data.map((row) => [String(row.name).trim().toLowerCase(), String(row.id)]))
        for (const account of newAccounts) {
          const id = byName.get(account.name.trim().toLowerCase())
          if (!id) return { ok: false, message: `Could not create an account for ${account.name}.` }
          accountIds.set(account.key, id)
        }
      }
    }

    for (const contact of newContacts) {
      if (!contact.accountId) {
        const created = accountIds.get(contact.accountKey)
        if (!created) return { ok: false, message: `Could not create an account for ${contact.fullName}.` }
        contact.accountId = created
      }
    }

    if (newContacts.length > 0) {
      const payloads = newContacts.map((contact) => ({
        account_id: contact.accountId,
        full_name: contact.fullName,
        email: contact.email,
        phone: contact.phone,
        is_primary: contact.isPrimary,
        active: true,
        created_by: profileId,
      }))
      const inserted = await admin.from("crm_contacts").insert(payloads).select("id, email, phone, account_id")
      if (inserted.error || !inserted.data) {
        return { ok: false, message: inserted.error?.message || "Could not create contacts." }
      }
      for (const contact of newContacts) {
        const match = inserted.data.find((row) => {
          const email = (row.email ?? "").trim().toLowerCase()
          if (contact.email) return email === contact.email && row.account_id === contact.accountId
          return normalizeMarketingPhone(row.phone) === normalizeMarketingPhone(contact.phone) && row.account_id === contact.accountId
        })
        if (!match) return { ok: false, message: `Could not create a contact for ${contact.fullName}.` }
        contactIdByKey.set(contact.key, String(match.id))
        accountIdByKey.set(contact.key, String(contact.accountId))
      }
    }

    for (let index = 0; index < phonePatches.length; index += 20) {
      const chunk = phonePatches.slice(index, index + 20)
      await Promise.all(
        chunk.map((patch) => admin.from("crm_contacts").update({ phone: patch.phone }).eq("id", patch.id)),
      )
    }

    const currency = packageRow.currency?.trim() || "USD"
    const deals = ready.map((row) => {
      const key = clientKey(row)
      return {
        id: crypto.randomUUID(),
        reference: "DL0000",
        account_id: accountIdByKey.get(key),
        primary_contact_id: contactIdByKey.get(key),
        source: "marketing",
        stage: "draft",
        enquiry_stage: "new",
        enquiry_temperature: "warm",
        currency,
        total_amount: 0,
        notes: row.notes,
        next_action: suggestedEnquiryAction("new"),
        race_id: packageRow.race_id,
        created_by: profileId,
        row,
      }
    })
    if (deals.some((deal) => !deal.account_id || !deal.primary_contact_id)) {
      return { ok: false, message: "A contact could not be matched for one of the rows." }
    }

    const createdIds: string[] = []
    for (let index = 0; index < deals.length; index += 40) {
      const slice = deals.slice(index, index + 40)
      const chunk = slice.map((deal) => ({
        id: deal.id,
        reference: deal.reference,
        account_id: deal.account_id,
        primary_contact_id: deal.primary_contact_id,
        source: deal.source,
        stage: deal.stage,
        enquiry_stage: deal.enquiry_stage,
        enquiry_temperature: deal.enquiry_temperature,
        currency: deal.currency,
        total_amount: deal.total_amount,
        notes: deal.notes,
        next_action: deal.next_action,
        race_id: deal.race_id,
        created_by: deal.created_by,
      }))
      const inserted = await admin.from("deals").insert(chunk)
      if (inserted.error) {
        if (!uniqueViolation(inserted.error)) {
          if (createdIds.length > 0) await admin.from("deals").delete().in("id", createdIds)
          return { ok: false, message: inserted.error.message }
        }
        for (const deal of chunk) {
          const single = await admin.from("deals").insert(deal)
          if (single.error) {
            if (createdIds.length > 0) await admin.from("deals").delete().in("id", createdIds)
            return { ok: false, message: single.error.message }
          }
          createdIds.push(deal.id)
        }
      } else {
        createdIds.push(...chunk.map((deal) => deal.id))
      }

      const lineInsert = await admin.from("deal_line_items").insert(
        slice.map((deal) => ({
          deal_id: deal.id,
          package_id: packageRow.id,
          quantity: deal.row.quantity,
          unit_sale_price: 0,
          currency,
          reservation_status: "none",
          sourcing_mode: "owned",
          sort_order: 0,
        })),
      )
      if (lineInsert.error) {
        await admin.from("deals").delete().in("id", createdIds)
        return { ok: false, message: lineInsert.error.message }
      }

      await admin.from("deal_activities").insert(
        slice.map((deal) => ({
          deal_id: deal.id,
          actor_profile_id: profileId,
          action: "deal_created",
          summary: "Historical enquiry imported from a spreadsheet",
          metadata: {
            packageId: packageRow.id,
            packageName: packageRow.name,
            email: deal.row.email,
            phone: deal.row.phone,
            quantity: deal.row.quantity,
            ticketText: deal.row.ticketText,
          },
        })),
      )
    }

    revalidatePath("/admin/enquiries")
    revalidatePath("/admin/leads")
    revalidatePath("/admin/sales-tracker")

    const skipped = prepared.duplicateRows
    const failed = prepared.errorRows
    const parts = [`Created ${ready.length} ${ready.length === 1 ? "enquiry" : "enquiries"} for ${packageRow.name}.`]
    if (skipped) parts.push(`${skipped} already had this package and were skipped.`)
    if (failed) parts.push(`${failed} ${failed === 1 ? "row needs" : "rows need"} a fix and ${failed === 1 ? "was" : "were"} left out.`)
    return { ok: true, message: parts.join(" "), created: ready.length, skipped, failed }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The import failed." }
  }
}
