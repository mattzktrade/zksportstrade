/**
 * Fold person-named CRM accounts into the matching company when every
 * corporate email on those accounts shares one domain.
 *
 * Dry-run by default. Pass --apply to write.
 */
import { config } from "dotenv"
import { resolve } from "node:path"

config({ path: resolve(process.cwd(), ".env.local") })

import { createAdminClient } from "../lib/supabase/admin"
import { fetchAllRows } from "../lib/supabase/fetch-all-rows"
import {
  planDomainAccountMerges,
  type DomainGroupAccount,
} from "../lib/crm/email-domain-account-groups"
import type { SupabaseClient } from "@supabase/supabase-js"

const APPLY = process.argv.includes("--apply")

type AccountRow = {
  id: string
  name: string
  email: string | null
  phone: string | null
  notes: string | null
  owner_profile_id: string | null
  portal_profile_id: string | null
  salesforce_account_id: string | null
  account_type: string | null
  account_types: string[] | null
  source: string | null
  created_at: string
  billing_address_line1: string | null
  billing_address_line2: string | null
  billing_city: string | null
  billing_postcode: string | null
  billing_country: string | null
}

type ContactRow = {
  id: string
  account_id: string
  full_name: string
  email: string | null
  is_primary: boolean | null
}

async function loadAccounts(admin: SupabaseClient): Promise<{
  accounts: AccountRow[]
  grouped: DomainGroupAccount[]
}> {
  const [accountsRes, contactsRes, dealsRes, ordersRes, suppliersRes] = await Promise.all([
    fetchAllRows<AccountRow>((from, to) =>
      admin
        .from("crm_accounts")
        .select(
          "id, name, email, phone, notes, owner_profile_id, portal_profile_id, salesforce_account_id, account_type, account_types, source, created_at, billing_address_line1, billing_address_line2, billing_city, billing_postcode, billing_country",
        )
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<ContactRow>((from, to) =>
      admin
        .from("crm_contacts")
        .select("id, account_id, full_name, email, is_primary")
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<{ id: string; account_id: string | null }>((from, to) =>
      admin.from("deals").select("id, account_id").order("id").range(from, to),
    ),
    fetchAllRows<{ id: string; crm_account_id: string | null }>((from, to) =>
      admin.from("orders").select("id, crm_account_id").order("id").range(from, to),
    ),
    fetchAllRows<{ id: string; crm_account_id: string | null; name: string }>((from, to) =>
      admin.from("suppliers").select("id, crm_account_id, name").order("id").range(from, to),
    ),
  ])

  for (const [label, res] of [
    ["accounts", accountsRes],
    ["contacts", contactsRes],
    ["deals", dealsRes],
    ["orders", ordersRes],
    ["suppliers", suppliersRes],
  ] as const) {
    if (res.error) throw new Error(`${label}: ${res.error.message}`)
  }

  const contactsByAccount = new Map<string, ContactRow[]>()
  for (const contact of contactsRes.data) {
    const list = contactsByAccount.get(contact.account_id) ?? []
    list.push(contact)
    contactsByAccount.set(contact.account_id, list)
  }
  const dealsByAccount = new Map<string, number>()
  for (const deal of dealsRes.data) {
    if (!deal.account_id) continue
    dealsByAccount.set(deal.account_id, (dealsByAccount.get(deal.account_id) ?? 0) + 1)
  }
  const ordersByAccount = new Map<string, number>()
  for (const order of ordersRes.data) {
    if (!order.crm_account_id) continue
    ordersByAccount.set(order.crm_account_id, (ordersByAccount.get(order.crm_account_id) ?? 0) + 1)
  }
  const suppliersByAccount = new Map<string, string[]>()
  for (const supplier of suppliersRes.data) {
    if (!supplier.crm_account_id) continue
    const list = suppliersByAccount.get(supplier.crm_account_id) ?? []
    list.push(supplier.name)
    suppliersByAccount.set(supplier.crm_account_id, list)
  }

  const grouped: DomainGroupAccount[] = accountsRes.data.map((account) => {
    const contacts = contactsByAccount.get(account.id) ?? []
    return {
      id: account.id,
      name: account.name,
      email: account.email,
      accountTypes: account.account_types ?? [],
      contactNames: contacts.map((contact) => contact.full_name),
      contactEmails: contacts.map((contact) => contact.email).filter((email): email is string => Boolean(email)),
      dealCount: dealsByAccount.get(account.id) ?? 0,
      orderCount: ordersByAccount.get(account.id) ?? 0,
      supplierNames: suppliersByAccount.get(account.id) ?? [],
      createdAt: account.created_at,
    }
  })

  return { accounts: accountsRes.data, grouped }
}

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed ? trimmed : null
}

async function mergePersonAccountIntoCompany(
  admin: SupabaseClient,
  sourceId: string,
  targetId: string,
  byId: Map<string, AccountRow>,
) {
  const source = byId.get(sourceId)
  const target = byId.get(targetId)
  if (!source || !target) throw new Error("account_not_found")

  const { data: targetPrimary } = await admin
    .from("crm_contacts")
    .select("id")
    .eq("account_id", targetId)
    .eq("is_primary", true)
    .limit(1)
  if ((targetPrimary ?? []).length > 0) {
    const { error } = await admin
      .from("crm_contacts")
      .update({ is_primary: false, updated_at: new Date().toISOString() })
      .eq("account_id", sourceId)
      .eq("is_primary", true)
    if (error) throw error
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updated_at: now }
  const moves: Array<{ table: string; column: string }> = [
    { table: "crm_contacts", column: "account_id" },
    { table: "deals", column: "account_id" },
    { table: "crm_leads", column: "account_id" },
    { table: "orders", column: "crm_account_id" },
  ]
  for (const move of moves) {
    const { error } = await admin.from(move.table).update({ [move.column]: targetId }).eq(move.column, sourceId)
    if (error) throw new Error(`${move.table}: ${error.message}`)
  }

  const { data: sourceInterests, error: interestLoadError } = await admin
    .from("crm_account_event_interests")
    .select("race_id")
    .eq("account_id", sourceId)
  if (interestLoadError) throw interestLoadError
  if ((sourceInterests ?? []).length) {
    const { error: interestInsertError } = await admin.from("crm_account_event_interests").upsert(
      (sourceInterests ?? []).map((row) => ({ account_id: targetId, race_id: row.race_id })),
      { onConflict: "account_id,race_id", ignoreDuplicates: true },
    )
    if (interestInsertError) throw interestInsertError
    const { error: interestDeleteError } = await admin
      .from("crm_account_event_interests")
      .delete()
      .eq("account_id", sourceId)
    if (interestDeleteError) throw interestDeleteError
  }

  if (blank(source.salesforce_account_id)) {
    // keep target as-is
  } else if (blank(target.salesforce_account_id)) {
    const { error } = await admin.from("crm_accounts").update({ salesforce_account_id: null }).eq("id", sourceId)
    if (error) throw error
    patch.salesforce_account_id = source.salesforce_account_id
  } else {
    const { error } = await admin.from("crm_accounts").update({ salesforce_account_id: null }).eq("id", sourceId)
    if (error) throw error
  }

  if (!target.email && source.email) patch.email = source.email
  if (!target.phone && source.phone) patch.phone = source.phone
  if (!target.owner_profile_id && source.owner_profile_id) patch.owner_profile_id = source.owner_profile_id
  if (!target.portal_profile_id && source.portal_profile_id) patch.portal_profile_id = source.portal_profile_id
  if (!target.notes && source.notes) patch.notes = source.notes
  else if (target.notes && source.notes && target.notes !== source.notes) {
    patch.notes = `${target.notes}\n\n${source.notes}`
  }
  if (!target.billing_address_line1 && source.billing_address_line1) {
    patch.billing_address_line1 = source.billing_address_line1
  }
  if (!target.billing_address_line2 && source.billing_address_line2) {
    patch.billing_address_line2 = source.billing_address_line2
  }
  if (!target.billing_city && source.billing_city) patch.billing_city = source.billing_city
  if (!target.billing_postcode && source.billing_postcode) patch.billing_postcode = source.billing_postcode
  if (!target.billing_country && source.billing_country) patch.billing_country = source.billing_country

  const { error: patchError } = await admin.from("crm_accounts").update(patch).eq("id", targetId)
  if (patchError) throw patchError

  const { error: deleteError } = await admin.from("crm_accounts").delete().eq("id", sourceId)
  if (deleteError) throw deleteError

  byId.delete(sourceId)
}

async function main() {
  const admin = createAdminClient()
  if (!admin) {
    console.error("Missing SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL")
    process.exit(1)
  }

  const { accounts, grouped } = await loadAccounts(admin)
  const byId = new Map(accounts.map((account) => [account.id, account]))
  const plans = planDomainAccountMerges(grouped)
  const high = plans.filter((plan) => plan.confidence === "high" && plan.target && plan.sources.length)

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${high.length} company groups`)
  let merged = 0
  let skipped = 0

  for (const plan of high) {
    const target = plan.target!
    const sources = plan.sources.filter((source) => {
      if (source.id === target.id) return false
      if (source.supplierNames.length) {
        console.log(`  skip ${source.name} — linked supplier, merge manually`)
        skipped += 1
        return false
      }
      return true
    })
    if (!sources.length) continue

    console.log(`\n${target.name}  ←  ${plan.domain}`)
    for (const source of sources) {
      const emails = source.contactEmails.join(", ") || source.email || "no email"
      console.log(`  ${source.name}  (${emails})`)
      if (!APPLY) {
        merged += 1
        continue
      }
      try {
        await mergePersonAccountIntoCompany(admin, source.id, target.id, byId)
        merged += 1
      } catch (error) {
        skipped += 1
        console.error(`  FAILED ${source.name}:`, error instanceof Error ? error.message : error)
      }
    }
  }

  console.log(`\n${APPLY ? "Merged" : "Would merge"} ${merged} person accounts. Skipped ${skipped}.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
