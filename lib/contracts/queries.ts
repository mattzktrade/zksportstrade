import { createAdminClient } from "@/lib/supabase/admin"
import { normalizeContractContent, type ContractContent, type ContractStatus } from "@/lib/contracts/content"

export type InclusionContractEvent = {
  id: string
  eventType: string
  actorEmail: string | null
  createdAt: string
}

export type InclusionContractRecord = {
  id: string
  documentRef: string
  title: string
  status: ContractStatus
  dealId: string | null
  dealReference: string | null
  accountId: string | null
  contactId: string | null
  companyName: string
  clientName: string
  clientEmail: string
  content: ContractContent
  contentHash: string
  expiresAt: string | null
  sentAt: string | null
  firstViewedAt: string | null
  signedAt: string | null
  signerName: string | null
  signerPosition: string | null
  unsignedPdfPath: string | null
  signedPdfPath: string | null
  lastError: string | null
  signingToken: string | null
  updatedAt: string
  events: InclusionContractEvent[]
}

export type InclusionContractListItem = {
  id: string
  documentRef: string
  title: string
  status: ContractStatus
  companyName: string
  clientName: string
  clientEmail: string
  eventName: string
  dealReference: string | null
  expiresAt: string | null
  sentAt: string | null
  signedAt: string | null
  updatedAt: string
}

export type BookingFormRegisterItem = {
  id: string
  documentRef: string
  status: string
  clientName: string
  clientEmail: string
  dealId: string
  dealReference: string
  sentAt: string | null
  signedAt: string | null
  completedAt: string | null
  createdAt: string
}

type ContractRow = {
  id: string
  document_ref: string
  title: string
  status: ContractStatus
  deal_id: string | null
  account_id: string | null
  contact_id: string | null
  company_name: string
  client_name: string
  client_email: string
  content: unknown
  content_hash: string
  client_token_expires_at: string | null
  client_signing_token: string | null
  sent_at: string | null
  first_viewed_at: string | null
  signed_at: string | null
  signer_name: string | null
  signer_position: string | null
  unsigned_pdf_path: string | null
  signed_pdf_path: string | null
  last_error: string | null
  updated_at: string
  deals?: { reference?: string | null } | Array<{ reference?: string | null }> | null
}

function dealReference(value: ContractRow["deals"]): string | null {
  if (!value) return null
  const row = Array.isArray(value) ? value[0] : value
  const reference = String(row?.reference ?? "").trim()
  return reference || null
}

function eventName(content: ContractContent): string {
  return content.event.trim()
}

export function missingContractsTable(message: string): boolean {
  return /inclusion_contracts/i.test(message) && /does not exist|schema cache|could not find/i.test(message)
}

function mapRecord(row: ContractRow, events: InclusionContractEvent[]): InclusionContractRecord {
  return {
    id: row.id,
    documentRef: row.document_ref,
    title: row.title,
    status: row.status,
    dealId: row.deal_id,
    dealReference: dealReference(row.deals),
    accountId: row.account_id,
    contactId: row.contact_id,
    companyName: row.company_name,
    clientName: row.client_name,
    clientEmail: row.client_email,
    content: normalizeContractContent(row.content),
    contentHash: row.content_hash,
    expiresAt: row.client_token_expires_at,
    sentAt: row.sent_at,
    firstViewedAt: row.first_viewed_at,
    signedAt: row.signed_at,
    signerName: row.signer_name,
    signerPosition: row.signer_position,
    unsignedPdfPath: row.unsigned_pdf_path,
    signedPdfPath: row.signed_pdf_path,
    lastError: row.last_error,
    signingToken: row.client_signing_token,
    updatedAt: row.updated_at,
    events,
  }
}

const CONTRACT_COLUMNS = `
  id, document_ref, title, status, deal_id, account_id, contact_id,
  company_name, client_name, client_email, content, content_hash,
  client_token_expires_at, client_signing_token, sent_at, first_viewed_at,
  signed_at, signer_name, signer_position, unsigned_pdf_path, signed_pdf_path,
  last_error, updated_at, deals(reference)
`

export async function loadInclusionContracts(): Promise<{
  contracts: InclusionContractListItem[]
  unavailable: boolean
}> {
  const admin = createAdminClient()
  if (!admin) return { contracts: [], unavailable: true }
  const { data, error } = await admin
    .from("inclusion_contracts")
    .select(CONTRACT_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(300)
  if (error) {
    if (missingContractsTable(error.message)) return { contracts: [], unavailable: true }
    throw new Error(error.message)
  }
  const contracts = ((data ?? []) as ContractRow[]).map((row) => {
    const content = normalizeContractContent(row.content)
    return {
      id: row.id,
      documentRef: row.document_ref,
      title: row.title,
      status: row.status,
      companyName: row.company_name,
      clientName: row.client_name,
      clientEmail: row.client_email,
      eventName: eventName(content),
      dealReference: dealReference(row.deals),
      expiresAt: row.client_token_expires_at,
      sentAt: row.sent_at,
      signedAt: row.signed_at,
      updatedAt: row.updated_at,
    }
  })
  return { contracts, unavailable: false }
}

export async function loadInclusionContract(id: string): Promise<InclusionContractRecord | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data, error } = await admin
    .from("inclusion_contracts")
    .select(CONTRACT_COLUMNS)
    .eq("id", id)
    .maybeSingle()
  if (error) {
    if (missingContractsTable(error.message)) return null
    throw new Error(error.message)
  }
  if (!data) return null
  const { data: eventRows } = await admin
    .from("inclusion_contract_events")
    .select("id, event_type, actor_email, created_at")
    .eq("contract_id", id)
    .order("created_at", { ascending: false })
    .limit(30)
  const events: InclusionContractEvent[] = (eventRows ?? []).map((row) => ({
    id: String(row.id),
    eventType: String(row.event_type),
    actorEmail: row.actor_email ? String(row.actor_email) : null,
    createdAt: String(row.created_at),
  }))
  return mapRecord(data as ContractRow, events)
}

export async function loadBookingFormRegister(): Promise<BookingFormRegisterItem[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data, error } = await admin
    .from("booking_forms")
    .select(
      "id, deal_id, document_ref, status, client_name, client_email, sent_at, client_signed_at, completed_at, created_at, deals(reference)",
    )
    .order("created_at", { ascending: false })
    .limit(300)
  if (error) {
    console.warn("[contracts] could not load booking forms:", error.message)
    return []
  }
  return (data ?? []).map((row) => {
    const deals = row.deals as { reference?: string | null } | Array<{ reference?: string | null }> | null
    const deal = Array.isArray(deals) ? deals[0] : deals
    return {
      id: String(row.id),
      documentRef: String(row.document_ref),
      status: String(row.status),
      clientName: String(row.client_name ?? ""),
      clientEmail: String(row.client_email ?? ""),
      dealId: String(row.deal_id),
      dealReference: String(deal?.reference ?? "").trim() || "Deal",
      sentAt: row.sent_at ? String(row.sent_at) : null,
      signedAt: row.client_signed_at ? String(row.client_signed_at) : null,
      completedAt: row.completed_at ? String(row.completed_at) : null,
      createdAt: String(row.created_at),
    }
  })
}

export type DealPrefill = {
  dealId: string
  dealReference: string
  accountId: string | null
  contactId: string | null
  companyName: string
  clientName: string
  clientEmail: string
}

export async function loadDealPrefill(dealId: string): Promise<DealPrefill | null> {
  const admin = createAdminClient()
  if (!admin || !/^[0-9a-f-]{36}$/i.test(dealId)) return null
  const { data, error } = await admin
    .from("deals")
    .select(
      "id, reference, account_id, primary_contact_id, crm_accounts(name, email), crm_contacts!primary_contact_id(full_name, email)",
    )
    .eq("id", dealId)
    .maybeSingle()
  if (error || !data) return null
  const account = data.crm_accounts as { name?: string | null; email?: string | null } | Array<{
    name?: string | null
    email?: string | null
  }> | null
  const contact = data.crm_contacts as { full_name?: string | null; email?: string | null } | Array<{
    full_name?: string | null
    email?: string | null
  }> | null
  const accountRow = Array.isArray(account) ? account[0] : account
  const contactRow = Array.isArray(contact) ? contact[0] : contact
  return {
    dealId: String(data.id),
    dealReference: String(data.reference ?? ""),
    accountId: data.account_id ? String(data.account_id) : null,
    contactId: data.primary_contact_id ? String(data.primary_contact_id) : null,
    companyName: String(accountRow?.name ?? "").trim(),
    clientName: String(contactRow?.full_name ?? "").trim(),
    clientEmail: String(contactRow?.email ?? accountRow?.email ?? "").trim().toLowerCase(),
  }
}
