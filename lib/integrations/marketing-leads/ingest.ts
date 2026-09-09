import { createAdminClient } from "@/lib/supabase/admin"
import { suggestedEnquiryAction } from "@/lib/crm/deal-pipeline"
import {
  formatMarketingLeadNotes,
  normalizeMarketingAlias,
  normalizeMarketingPhone,
  type MarketingLeadPayload,
} from "@/lib/integrations/marketing-leads/parse"

export type IngestMarketingLeadResult =
  | { ok: true; dealId: string; dealReference: string; duplicate: boolean }
  | { ok: false; message: string }

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>

type ContactRow = {
  id: string
  account_id: string
  full_name: string
  email: string | null
  phone: string | null
  is_primary: boolean
  active: boolean
}

type PackageRow = {
  id: string
  name: string
  race_id: string | null
  currency: string | null
  is_hidden: boolean | null
  shell_parent_package_id: string | null
}

function postgresUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === "23505" || /duplicate key/i.test(error.message ?? "")
}

async function uniqueAccountName(admin: AdminClient, baseName: string, suffix: string): Promise<string> {
  const trimmed = baseName.trim()
  const { data: existing } = await admin
    .from("crm_accounts")
    .select("id")
    .ilike("name", trimmed)
    .limit(1)
    .maybeSingle()
  if (!existing) return trimmed
  const withSuffix = `${trimmed} (${suffix})`.slice(0, 180)
  const { data: clash } = await admin
    .from("crm_accounts")
    .select("id")
    .ilike("name", withSuffix)
    .limit(1)
    .maybeSingle()
  if (!clash) return withSuffix
  return `${trimmed} (${suffix.slice(0, 8)}-${Date.now().toString(36)})`.slice(0, 180)
}

async function findContactByEmail(admin: AdminClient, email: string): Promise<ContactRow | null> {
  const { data } = await admin
    .from("crm_contacts")
    .select("id, account_id, full_name, email, phone, is_primary, active")
    .eq("active", true)
    .ilike("email", email)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as ContactRow | null) ?? null
}

async function findAccountByEmail(admin: AdminClient, email: string): Promise<{ id: string } | null> {
  const { data } = await admin
    .from("crm_accounts")
    .select("id")
    .eq("active", true)
    .ilike("email", email)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  return data ? { id: String(data.id) } : null
}

async function findContactByPhone(admin: AdminClient, phone: string): Promise<ContactRow | null> {
  const digits = normalizeMarketingPhone(phone)
  if (digits.length < 8) {
    const { data } = await admin
      .from("crm_contacts")
      .select("id, account_id, full_name, email, phone, is_primary, active")
      .eq("active", true)
      .eq("phone", phone)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
    return (data as ContactRow | null) ?? null
  }

  const { data } = await admin
    .from("crm_contacts")
    .select("id, account_id, full_name, email, phone, is_primary, active, created_at")
    .eq("active", true)
    .not("phone", "is", null)
    .order("created_at", { ascending: true })
    .limit(500)
  const rows = (data ?? []) as Array<ContactRow>
  return rows.find((row) => normalizeMarketingPhone(row.phone) === digits) ?? null
}

async function resolveAccountAndContact(
  admin: AdminClient,
  payload: MarketingLeadPayload,
): Promise<{ accountId: string; contactId: string }> {
  const email = payload.contact.email
  const phone = payload.contact.phone
  let contact =
    (email ? await findContactByEmail(admin, email) : null) ??
    (phone ? await findContactByPhone(admin, phone) : null)

  if (contact) {
    const patch: Record<string, string> = {}
    if (!contact.phone && phone) patch.phone = phone
    if (!contact.email && email) patch.email = email
    if (Object.keys(patch).length > 0) {
      await admin.from("crm_contacts").update(patch).eq("id", contact.id)
    }
    if (email || phone) {
      const { data: account } = await admin
        .from("crm_accounts")
        .select("id, email, phone")
        .eq("id", contact.account_id)
        .maybeSingle()
      const accountPatch: Record<string, string> = {}
      if (account && !account.email && email) accountPatch.email = email
      if (account && !account.phone && phone) accountPatch.phone = phone
      if (Object.keys(accountPatch).length > 0) {
        await admin.from("crm_accounts").update(accountPatch).eq("id", contact.account_id)
      }
    }
    return { accountId: contact.account_id, contactId: contact.id }
  }

  let accountId = email ? (await findAccountByEmail(admin, email))?.id ?? null : null
  if (!accountId) {
    const name = await uniqueAccountName(
      admin,
      payload.contact.fullName,
      email || phone || payload.leadId,
    )
    const insertAccount = async (accountName: string) =>
      admin
        .from("crm_accounts")
        .insert({
          name: accountName,
          account_type: "direct_client",
          account_types: ["direct_client"],
          email,
          phone,
          source: "marketing",
          lifecycle: "lead",
          lead_stage: "new",
          active: true,
        })
        .select("id")
        .single()

    let { data: created, error } = await insertAccount(name)
    if (postgresUniqueViolation(error)) {
      const retryName = await uniqueAccountName(admin, payload.contact.fullName, payload.leadId)
      const retry = await insertAccount(`${retryName} ${payload.leadId.slice(0, 6)}`.slice(0, 180))
      created = retry.data
      error = retry.error
    }
    if (error || !created) {
      throw new Error(error?.message || "Could not create CRM account for marketing lead.")
    }
    accountId = String(created.id)
  }

  const { count } = await admin
    .from("crm_contacts")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("active", true)
    .eq("is_primary", true)

  const { data: createdContact, error: contactError } = await admin
    .from("crm_contacts")
    .insert({
      account_id: accountId,
      full_name: payload.contact.fullName,
      email,
      phone,
      is_primary: !count,
      active: true,
    })
    .select("id")
    .single()
  if (contactError || !createdContact) {
    throw new Error(contactError?.message || "Could not create CRM contact for marketing lead.")
  }
  return { accountId, contactId: String(createdContact.id) }
}

async function resolvePackage(
  admin: AdminClient,
  payload: MarketingLeadPayload,
): Promise<PackageRow | null> {
  const raw = payload.interest.package?.trim() || ""
  if (!raw) return null
  const needle = normalizeMarketingAlias(raw)

  const { data: alias } = await admin
    .from("marketing_package_aliases")
    .select("package_id")
    .eq("alias_normalized", needle)
    .maybeSingle()
  if (alias?.package_id) {
    const { data: mapped } = await admin
      .from("packages")
      .select("id, name, race_id, currency, is_hidden, shell_parent_package_id")
      .eq("id", alias.package_id)
      .maybeSingle()
    const row = mapped as PackageRow | null
    if (row && !row.is_hidden && !row.shell_parent_package_id) return row
  }

  const { data: byId } = await admin
    .from("packages")
    .select("id, name, race_id, currency, is_hidden, shell_parent_package_id")
    .eq("id", raw)
    .maybeSingle()
  const idRow = byId as PackageRow | null
  if (idRow && !idRow.is_hidden && !idRow.shell_parent_package_id) return idRow

  const { data: packages } = await admin
    .from("packages")
    .select("id, name, race_id, currency, is_hidden, shell_parent_package_id")
    .eq("is_hidden", false)
    .is("shell_parent_package_id", null)
    .limit(4000)
  const matches = ((packages ?? []) as PackageRow[]).filter(
    (row) => normalizeMarketingAlias(row.name) === needle,
  )
  return matches.length === 1 ? matches[0] : null
}

async function resolveRaceId(
  admin: AdminClient,
  payload: MarketingLeadPayload,
  packageRow: PackageRow | null,
): Promise<string | null> {
  if (packageRow?.race_id) return packageRow.race_id
  const eventName = payload.interest.event?.trim() || payload.interest.package?.trim() || ""
  const needle = normalizeMarketingAlias(eventName)
  if (!needle) return null
  const { data: races } = await admin.from("races").select("id, name").limit(500)
  const matches = (races ?? []).filter((row) => normalizeMarketingAlias(String(row.name)) === needle)
  return matches.length === 1 ? String(matches[0].id) : null
}

export async function ingestMarketingLead(payload: MarketingLeadPayload): Promise<IngestMarketingLeadResult> {
  const client = createAdminClient()
  if (!client) return { ok: false, message: "Service role not configured." }
  const admin: AdminClient = client

  const { data: existing } = await admin
    .from("marketing_lead_ingest")
    .select("id, status, deal_id, created_at")
    .eq("lead_id", payload.leadId)
    .maybeSingle()

  async function duplicateResult(dealId: string): Promise<IngestMarketingLeadResult> {
    const { data: deal } = await admin
      .from("deals")
      .select("id, reference")
      .eq("id", dealId)
      .maybeSingle()
    if (!deal) return { ok: false, message: "Previous import is missing its enquiry. Retry after an admin checks the ingest log." }
    return {
      ok: true,
      dealId: String(deal.id),
      dealReference: String(deal.reference),
      duplicate: true,
    }
  }

  if (existing?.deal_id) return duplicateResult(String(existing.deal_id))

  if (!existing) {
    const { error: insertError } = await admin.from("marketing_lead_ingest").insert({
      lead_id: payload.leadId,
      payload,
      status: "received",
    })
    if (insertError && !postgresUniqueViolation(insertError)) {
      return { ok: false, message: insertError.message }
    }
    if (postgresUniqueViolation(insertError)) {
      return ingestMarketingLead(payload)
    }
  } else if (existing.status === "failed") {
    const { data: claimedFailed } = await admin
      .from("marketing_lead_ingest")
      .update({ status: "received", error: null, payload })
      .eq("lead_id", payload.leadId)
      .eq("status", "failed")
      .select("id")
      .maybeSingle()
    if (!claimedFailed) return ingestMarketingLead(payload)
  } else if (existing.status === "received" && !existing.deal_id) {
    const started = existing.created_at ? Date.parse(String(existing.created_at)) : Number.NaN
    const stale = Number.isFinite(started) && Date.now() - started > 120_000
    if (!stale) {
      return { ok: false, message: "This lead is already being imported. Retry shortly." }
    }
    await admin
      .from("marketing_lead_ingest")
      .update({ payload, error: null })
      .eq("lead_id", payload.leadId)
      .is("deal_id", null)
  }

  const { data: claimed } = await admin
    .from("marketing_lead_ingest")
    .select("id, deal_id")
    .eq("lead_id", payload.leadId)
    .maybeSingle()
  if (claimed?.deal_id) return duplicateResult(String(claimed.deal_id))

  try {
    const { accountId, contactId } = await resolveAccountAndContact(admin, payload)
    const packageRow = await resolvePackage(admin, payload)
    const raceId = await resolveRaceId(admin, payload, packageRow)
    const quantity = payload.interest.quantity && payload.interest.quantity > 0 ? payload.interest.quantity : 1
    const notes = formatMarketingLeadNotes(payload)
    const currency = packageRow?.currency?.trim() || "USD"

    const { data: deal, error: dealError } = await admin
      .from("deals")
      .insert({
        reference: "DL0000",
        account_id: accountId,
        primary_contact_id: contactId,
        source: "marketing",
        stage: "draft",
        enquiry_stage: "new",
        enquiry_temperature: "warm",
        currency,
        total_amount: 0,
        notes,
        next_action: suggestedEnquiryAction("new"),
        race_id: raceId,
      })
      .select("id, reference")
      .single()
    if (dealError || !deal) {
      throw new Error(dealError?.message || "Could not create enquiry.")
    }

    if (packageRow) {
      const { error: lineError } = await admin.from("deal_line_items").insert({
        deal_id: deal.id,
        package_id: packageRow.id,
        quantity,
        unit_sale_price: 0,
        currency,
        reservation_status: "none",
        sourcing_mode: "owned",
        sort_order: 0,
      })
      if (lineError) {
        throw new Error(lineError.message)
      }
    }

    await admin.from("deal_activities").insert({
      deal_id: deal.id,
      actor_profile_id: null,
      action: "deal_created",
      summary: "Marketing lead imported from Meta",
      metadata: {
        leadId: payload.leadId,
        campaign: payload.campaign.name,
        formName: payload.campaign.formName,
        package: payload.interest.package,
        quantity: payload.interest.quantity,
      },
    })

    await admin
      .from("marketing_lead_ingest")
      .update({
        status: "processed",
        deal_id: deal.id,
        account_id: accountId,
        contact_id: contactId,
        error: null,
        processed_at: new Date().toISOString(),
        payload,
      })
      .eq("lead_id", payload.leadId)

    return {
      ok: true,
      dealId: String(deal.id),
      dealReference: String(deal.reference),
      duplicate: false,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Marketing lead ingest failed."
    await admin
      .from("marketing_lead_ingest")
      .update({
        status: "failed",
        error: message,
        payload,
      })
      .eq("lead_id", payload.leadId)
    return { ok: false, message }
  }
}
