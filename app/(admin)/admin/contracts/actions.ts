"use server"

import { revalidatePath } from "next/cache"
import { getPortalProfile } from "@/lib/supabase/profile"
import { createAdminClient } from "@/lib/supabase/admin"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import {
  CONTRACT_LINK_DAYS,
  contractIsEditable,
  contractSaveError,
  contractSendError,
  normalizeContractDraft,
  type ContractDraft,
} from "@/lib/contracts/content"
import {
  contractContentHash,
  generateContractSigningToken,
  generateInclusionDocumentRef,
} from "@/lib/contracts/hash"
import { generateInclusionContractPdf } from "@/lib/contracts/pdf"
import { missingContractsTable } from "@/lib/contracts/queries"
import { createContractDocumentUrl, uploadContractDocument } from "@/lib/contracts/storage"
import {
  sendInclusionContractEmail,
} from "@/lib/email/send-inclusion-contract"
import { createCrmAccount, upsertCrmContact } from "@/app/(admin)/admin/clients/profile-actions"

type Result =
  | { ok: true; message: string; id?: string; signingUrl?: string }
  | { ok: false; message: string; id?: string }
type UrlResult = { ok: true; url: string } | { ok: false; message: string }
type PdfResult = { ok: true; pdfBase64: string; filename: string } | { ok: false; message: string }

export type ContractPartyHit = {
  kind: "account" | "contact" | "deal"
  id: string
  label: string
  detail: string
  companyName: string
  clientName: string
  clientEmail: string
  accountId: string | null
  contactId: string | null
  dealId: string | null
  dealReference: string | null
}

type SaveInput = {
  id?: string | null
  draft: ContractDraft
  dealId?: string | null
  accountId?: string | null
  contactId?: string | null
  skipEvent?: boolean
}

function signingUrl(token: string): string {
  return `${getServerSiteOrigin()}/sign/contract/${encodeURIComponent(token)}`
}

function cleanId(value: string | null | undefined): string | null {
  const id = String(value ?? "").trim()
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Something went wrong."
  if (missingContractsTable(message)) {
    return "Contracts are not available in the database yet. Apply the latest migration and try again."
  }
  return message
}

async function requireManage() {
  const profile = await getPortalProfile()
  if (!profile || !hasCmsPermission(profile, "deals.manage")) {
    throw new Error("You do not have permission to edit contracts.")
  }
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  return { profile, admin }
}

async function requireView() {
  const profile = await getPortalProfile()
  if (!profile || !hasCmsPermission(profile, "deals.view")) {
    throw new Error("You do not have permission to view contracts.")
  }
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  return { profile, admin }
}

function revalidateContract(id: string | null) {
  revalidatePath("/admin/contracts")
  if (id) revalidatePath(`/admin/contracts/${id}`)
}

async function recordEvent(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  contractId: string,
  eventType: string,
  actor: { id: string; email: string },
) {
  const { error } = await admin.from("inclusion_contract_events").insert({
    contract_id: contractId,
    event_type: eventType,
    actor_profile_id: actor.id,
    actor_email: actor.email,
  })
  if (error) console.warn("[contracts] could not record event:", error.message)
}

async function writeUnsignedPdf(
  documentRef: string,
  draft: ContractDraft,
): Promise<string> {
  const bytes = await generateInclusionContractPdf({ documentRef, draft })
  const path = `contracts/${documentRef}/unsigned.pdf`
  await uploadContractDocument(path, bytes, "application/pdf")
  return path
}

async function findAccountByName(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  name: string,
) {
  const { data, error } = await admin
    .from("crm_accounts")
    .select("id, name")
    .eq("active", true)
    .ilike("name", name)
    .limit(20)
  if (error) return null
  const needle = name.trim().toLowerCase()
  return (data ?? []).find((row) => String(row.name ?? "").trim().toLowerCase() === needle) ?? null
}

async function resolveContractParty(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  draft: ContractDraft,
  inputAccountId: string | null,
  inputContactId: string | null,
): Promise<{ accountId: string | null; contactId: string | null; error?: string }> {
  let accountId = cleanId(inputAccountId)
  let contactId = cleanId(inputContactId)
  const company = draft.companyName.trim()
  const name = draft.clientName.trim()
  const email = draft.clientEmail.trim()
  if (!company) return { accountId, contactId }

  if (!accountId) {
    const existing = await findAccountByName(admin, company)
    if (existing) {
      accountId = String(existing.id)
    } else {
      const created = await createCrmAccount({
        name: company,
        accountTypes: ["direct_client"],
        source: "manual",
        email: email || null,
        contacts: name ? [{ fullName: name, email: email || null }] : [],
      })
      if (!created.ok) {
        if (/already uses that name/i.test(created.message)) {
          const again = await findAccountByName(admin, company)
          if (again) accountId = String(again.id)
          else return { accountId, contactId, error: created.message }
        } else {
          return { accountId, contactId, error: created.message }
        }
      } else {
        return {
          accountId: created.accountId ?? null,
          contactId: created.contactId ?? contactId,
        }
      }
    }
  }

  if (accountId && name && !contactId) {
    const { data: contacts } = await admin
      .from("crm_contacts")
      .select("id, full_name, email")
      .eq("account_id", accountId)
      .eq("active", true)
    const match = (contacts ?? []).find((row) => {
      const rowEmail = String(row.email ?? "").trim().toLowerCase()
      if (email && rowEmail === email.toLowerCase()) return true
      return String(row.full_name ?? "").trim().toLowerCase() === name.toLowerCase()
    })
    if (match) {
      contactId = String(match.id)
    } else {
      const created = await upsertCrmContact({
        accountId,
        fullName: name,
        email: email || null,
        isPrimary: (contacts ?? []).length === 0,
      })
      if (!created.ok) return { accountId, contactId, error: created.message }
      contactId = created.contactId ?? contactId
    }
  }

  return { accountId, contactId }
}

export async function saveInclusionContract(input: SaveInput): Promise<Result> {
  try {
    const { profile, admin } = await requireManage()
    const draft = normalizeContractDraft(input.draft)
    const problem = contractSaveError(draft)
    if (problem) return { ok: false, message: problem }
    const hash = contractContentHash(draft)
    const now = new Date().toISOString()
    const dealId = cleanId(input.dealId)
    const party = await resolveContractParty(admin, draft, input.accountId ?? null, input.contactId ?? null)
    if (party.error) return { ok: false, message: party.error }
    const accountId = party.accountId
    const contactId = party.contactId

    if (!input.id) {
      const documentRef = generateInclusionDocumentRef()
      const { data, error } = await admin
        .from("inclusion_contracts")
        .insert({
          document_ref: documentRef,
          title: draft.title,
          status: "draft",
          deal_id: dealId,
          account_id: accountId,
          contact_id: contactId,
          company_name: draft.companyName,
          client_name: draft.clientName,
          client_email: draft.clientEmail,
          content: draft.content,
          content_hash: hash,
          created_by: profile.id,
          updated_at: now,
        })
        .select("id")
        .single()
      if (error || !data) return { ok: false, message: error?.message ?? "Could not save the contract." }
      await recordEvent(admin, data.id, "created", profile)
      revalidateContract(data.id)
      return { ok: true, message: "Draft saved.", id: data.id }
    }

    const { data: existing, error: loadError } = await admin
      .from("inclusion_contracts")
      .select("id, status, document_ref")
      .eq("id", input.id)
      .maybeSingle()
    if (loadError || !existing) return { ok: false, message: "Contract not found." }
    if (!contractIsEditable(String(existing.status))) {
      return { ok: false, message: "This contract is locked. Duplicate it if you need a new version." }
    }

    let unsignedPath: string | null = null
    if (existing.status !== "draft") {
      unsignedPath = await writeUnsignedPdf(String(existing.document_ref), draft)
    }

    const { data: updated, error } = await admin
      .from("inclusion_contracts")
      .update({
        title: draft.title,
        deal_id: dealId,
        account_id: accountId,
        contact_id: contactId,
        company_name: draft.companyName,
        client_name: draft.clientName,
        client_email: draft.clientEmail,
        content: draft.content,
        content_hash: hash,
        unsigned_pdf_path: unsignedPath,
        last_error: null,
        updated_at: now,
      })
      .eq("id", input.id)
      .in("status", ["draft", "sent", "viewed"])
      .select("id")
    if (error) return { ok: false, message: error.message }
    if (!updated?.length) return { ok: false, message: "This contract changed while you were editing. Refresh and try again." }
    if (!input.skipEvent) await recordEvent(admin, input.id, "saved", profile)
    revalidateContract(input.id)
    return {
      ok: true,
      message: existing.status === "draft" ? "Draft saved." : "Saved. The signing link now shows this version.",
      id: input.id,
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function sendInclusionContract(input: SaveInput): Promise<Result> {
  try {
    const { profile, admin } = await requireManage()
    const draft = normalizeContractDraft(input.draft)
    const problem = contractSendError(draft)
    if (problem) return { ok: false, message: problem }

    const saved = await saveInclusionContract({ ...input, skipEvent: true })
    if (!saved.ok || !saved.id) {
      return saved.ok ? { ok: false, message: "Could not save before sending." } : saved
    }

    const { data: row, error } = await admin
      .from("inclusion_contracts")
      .select("id, document_ref, status")
      .eq("id", saved.id)
      .maybeSingle()
    if (error || !row) return { ok: false, message: "Contract not found.", id: saved.id }
    if (!contractIsEditable(String(row.status))) {
      return { ok: false, message: "This contract can no longer be sent.", id: saved.id }
    }

    const issued = generateContractSigningToken()
    const expiresAt = new Date(Date.now() + CONTRACT_LINK_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const pdf = await generateInclusionContractPdf({ documentRef: String(row.document_ref), draft })
    const pdfPath = `contracts/${row.document_ref}/unsigned.pdf`
    await uploadContractDocument(pdfPath, pdf, "application/pdf")
    const url = signingUrl(issued.token)
    const email = await sendInclusionContractEmail({
      recipientEmail: draft.clientEmail,
      recipientName: draft.clientName,
      companyName: draft.companyName,
      documentRef: String(row.document_ref),
      title: draft.title,
      eventName: draft.content.event,
      signingUrl: url,
      expiresAt,
      pdf,
    })

    const { data: updated, error: updateError } = await admin
      .from("inclusion_contracts")
      .update({
        status: "sent",
        client_signing_token: issued.token,
        client_token_hash: issued.tokenHash,
        client_token_expires_at: expiresAt,
        sent_at: new Date().toISOString(),
        first_viewed_at: null,
        unsigned_pdf_path: pdfPath,
        last_error: email.ok ? null : email.error ?? email.skipped ?? "Email could not be sent.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", saved.id)
      .in("status", ["draft", "sent", "viewed"])
      .select("id")
    if (updateError) return { ok: false, message: updateError.message, id: saved.id }
    if (!updated?.length) {
      return { ok: false, message: "This contract changed while it was being sent. Refresh and try again.", id: saved.id }
    }

    await recordEvent(admin, saved.id, row.status === "draft" ? "sent" : "resent", profile)
    revalidateContract(saved.id)
    if (!email.ok) {
      return {
        ok: true,
        id: saved.id,
        signingUrl: url,
        message: `The signing link is ready, but the email was not sent. ${email.error ?? email.skipped ?? "Copy the link and send it yourself."}`,
      }
    }
    return {
      ok: true,
      id: saved.id,
      signingUrl: url,
      message: `Sent to ${draft.clientEmail}.`,
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function voidInclusionContract(id: string): Promise<Result> {
  try {
    const { profile, admin } = await requireManage()
    const { data, error } = await admin
      .from("inclusion_contracts")
      .update({
        status: "voided",
        voided_at: new Date().toISOString(),
        client_signing_token: null,
        client_token_hash: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .in("status", ["draft", "sent", "viewed"])
      .select("id")
    if (error) return { ok: false, message: error.message }
    if (!data?.length) return { ok: false, message: "Only an unsigned contract can be voided." }
    await recordEvent(admin, id, "voided", profile)
    revalidateContract(id)
    return { ok: true, message: "Contract voided. The signing link no longer works." }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function duplicateInclusionContract(id: string): Promise<Result> {
  try {
    const { profile, admin } = await requireManage()
    const { data: source, error } = await admin
      .from("inclusion_contracts")
      .select("title, company_name, client_name, client_email, content, deal_id, account_id, contact_id")
      .eq("id", id)
      .maybeSingle()
    if (error || !source) return { ok: false, message: "Contract not found." }
    const draft = normalizeContractDraft({
      title: String(source.title),
      companyName: String(source.company_name ?? ""),
      clientName: String(source.client_name ?? ""),
      clientEmail: String(source.client_email ?? ""),
      content: source.content as ContractDraft["content"],
    })
    const documentRef = generateInclusionDocumentRef()
    const { data, error: insertError } = await admin
      .from("inclusion_contracts")
      .insert({
        document_ref: documentRef,
        title: draft.title,
        status: "draft",
        deal_id: source.deal_id,
        account_id: source.account_id,
        contact_id: source.contact_id,
        company_name: draft.companyName,
        client_name: draft.clientName,
        client_email: draft.clientEmail,
        content: draft.content,
        content_hash: contractContentHash(draft),
        created_by: profile.id,
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single()
    if (insertError || !data) return { ok: false, message: insertError?.message ?? "Could not duplicate the contract." }
    await recordEvent(admin, data.id, "created", profile)
    revalidateContract(data.id)
    return { ok: true, message: "A new draft is ready to edit.", id: data.id }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function previewInclusionContractPdf(draftInput: ContractDraft): Promise<PdfResult> {
  try {
    await requireView()
    const draft = normalizeContractDraft(draftInput)
    const problem = contractSaveError(draft)
    if (problem) return { ok: false, message: problem }
    const bytes = await generateInclusionContractPdf({
      documentRef: "PREVIEW",
      draft,
    })
    return {
      ok: true,
      pdfBase64: Buffer.from(bytes).toString("base64"),
      filename: "inclusion-contract-preview.pdf",
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function downloadInclusionContractPdf(id: string): Promise<UrlResult> {
  try {
    const { admin } = await requireView()
    const { data, error } = await admin
      .from("inclusion_contracts")
      .select("document_ref, title, company_name, client_name, client_email, content, status, unsigned_pdf_path, signed_pdf_path, signer_name, signer_position, signed_at")
      .eq("id", id)
      .maybeSingle()
    if (error || !data) return { ok: false, message: "Contract not found." }
    const stored = data.status === "signed" ? data.signed_pdf_path : data.unsigned_pdf_path
    if (stored) return { ok: true, url: await createContractDocumentUrl(String(stored)) }
    const draft = normalizeContractDraft({
      title: String(data.title),
      companyName: String(data.company_name ?? ""),
      clientName: String(data.client_name ?? ""),
      clientEmail: String(data.client_email ?? ""),
      content: data.content as ContractDraft["content"],
    })
    const path = await writeUnsignedPdf(String(data.document_ref), draft)
    await admin.from("inclusion_contracts").update({ unsigned_pdf_path: path }).eq("id", id)
    return { ok: true, url: await createContractDocumentUrl(path) }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function searchContractParties(query: string): Promise<ContractPartyHit[]> {
  try {
    const { admin } = await requireView()
    const term = query.trim().slice(0, 80)
    if (term.length < 2) {
      const { data } = await admin
        .from("deals")
        .select(
          "id, reference, account_id, primary_contact_id, crm_accounts(name, email), crm_contacts!primary_contact_id(full_name, email)",
        )
        .order("updated_at", { ascending: false })
        .limit(8)
      return (data ?? []).map((row) => dealHit(row))
    }
    const pattern = `%${term.replace(/[%_]/g, "")}%`
    const [accounts, contacts, emailContacts, deals] = await Promise.all([
      admin.from("crm_accounts").select("id, name, email").eq("active", true).ilike("name", pattern).order("name").limit(6),
      admin
        .from("crm_contacts")
        .select("id, account_id, full_name, email, crm_accounts(name)")
        .eq("active", true)
        .ilike("full_name", pattern)
        .order("full_name")
        .limit(6),
      admin
        .from("crm_contacts")
        .select("id, account_id, full_name, email, crm_accounts(name)")
        .eq("active", true)
        .ilike("email", pattern)
        .order("full_name")
        .limit(6),
      admin
        .from("deals")
        .select(
          "id, reference, account_id, primary_contact_id, crm_accounts(name, email), crm_contacts!primary_contact_id(full_name, email)",
        )
        .ilike("reference", pattern)
        .order("updated_at", { ascending: false })
        .limit(6),
    ])
    const hits: ContractPartyHit[] = []
    for (const row of accounts.data ?? []) {
      hits.push({
        kind: "account",
        id: String(row.id),
        label: String(row.name),
        detail: String(row.email ?? "Account"),
        companyName: String(row.name ?? ""),
        clientName: "",
        clientEmail: String(row.email ?? "").trim().toLowerCase(),
        accountId: String(row.id),
        contactId: null,
        dealId: null,
        dealReference: null,
      })
    }
    const seenContacts = new Set<string>()
    for (const row of [...(contacts.data ?? []), ...(emailContacts.data ?? [])]) {
      if (seenContacts.has(String(row.id))) continue
      seenContacts.add(String(row.id))
      const account = row.crm_accounts as { name?: string | null } | Array<{ name?: string | null }> | null
      const accountRow = Array.isArray(account) ? account[0] : account
      hits.push({
        kind: "contact",
        id: String(row.id),
        label: String(row.full_name),
        detail: [accountRow?.name, row.email].filter(Boolean).join(" · "),
        companyName: String(accountRow?.name ?? ""),
        clientName: String(row.full_name ?? ""),
        clientEmail: String(row.email ?? "").trim().toLowerCase(),
        accountId: row.account_id ? String(row.account_id) : null,
        contactId: String(row.id),
        dealId: null,
        dealReference: null,
      })
    }
    for (const row of deals.data ?? []) hits.push(dealHit(row))
    return hits
  } catch {
    return []
  }
}

function dealHit(row: {
  id: string
  reference: string | null
  account_id: string | null
  primary_contact_id: string | null
  crm_accounts: { name?: string | null; email?: string | null } | Array<{ name?: string | null; email?: string | null }> | null
  crm_contacts: { full_name?: string | null; email?: string | null } | Array<{ full_name?: string | null; email?: string | null }> | null
}): ContractPartyHit {
  const account = Array.isArray(row.crm_accounts) ? row.crm_accounts[0] : row.crm_accounts
  const contact = Array.isArray(row.crm_contacts) ? row.crm_contacts[0] : row.crm_contacts
  const companyName = String(account?.name ?? "").trim()
  const clientName = String(contact?.full_name ?? "").trim()
  return {
    kind: "deal",
    id: String(row.id),
    label: String(row.reference ?? "Deal"),
    detail: [companyName, clientName].filter(Boolean).join(" · ") || "Deal",
    companyName,
    clientName,
    clientEmail: String(contact?.email ?? account?.email ?? "").trim().toLowerCase(),
    accountId: row.account_id ? String(row.account_id) : null,
    contactId: row.primary_contact_id ? String(row.primary_contact_id) : null,
    dealId: String(row.id),
    dealReference: String(row.reference ?? ""),
  }
}
