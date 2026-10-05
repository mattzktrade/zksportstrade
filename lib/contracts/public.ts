import { createAdminClient } from "@/lib/supabase/admin"
import {
  contractLinkExpired,
  normalizeContractContent,
  normalizeContractDraft,
  type ContractContent,
  type ContractDraft,
} from "@/lib/contracts/content"
import { sha256 } from "@/lib/contracts/hash"

export type PublicInclusionContract = {
  title: string
  documentRef: string
  companyName: string
  clientName: string
  clientEmail: string
  content: ContractContent
  contentHash: string
  status: "sent" | "viewed" | "signed"
  createdAt: string
  expiresAt: string
  signedAt: string | null
  signerName: string | null
  signerPosition: string | null
}

export async function getPublicInclusionContract(token: string): Promise<{
  form: PublicInclusionContract | null
  unavailableReason: "invalid" | "expired" | null
}> {
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) {
    return { form: null, unavailableReason: "invalid" }
  }
  const admin = createAdminClient()
  if (!admin) return { form: null, unavailableReason: "invalid" }
  const { data, error } = await admin
    .from("inclusion_contracts")
    .select(
      "id, document_ref, title, status, company_name, client_name, client_email, content, content_hash, client_token_expires_at, signed_at, signer_name, signer_position, created_at, sent_at",
    )
    .eq("client_token_hash", sha256(token))
    .maybeSingle()
  if (error || !data) return { form: null, unavailableReason: "invalid" }

  const status = String(data.status)
  if (status === "voided" || status === "declined" || status === "draft") {
    return { form: null, unavailableReason: "invalid" }
  }
  const expiresAt = String(data.client_token_expires_at ?? "")
  if (status !== "signed" && contractLinkExpired(status, expiresAt)) {
    return { form: null, unavailableReason: "expired" }
  }
  if (status !== "sent" && status !== "viewed" && status !== "signed") {
    return { form: null, unavailableReason: "invalid" }
  }

  if (status === "sent") {
    const { data: viewed } = await admin
      .from("inclusion_contracts")
      .update({
        status: "viewed",
        first_viewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("status", "sent")
      .select("id")
    if (viewed?.length) {
      await admin.from("inclusion_contract_events").insert({
        contract_id: data.id,
        event_type: "viewed",
        actor_email: data.client_email,
      })
    }
  }

  const draft = normalizeContractDraft({
    title: String(data.title ?? ""),
    companyName: String(data.company_name ?? ""),
    clientName: String(data.client_name ?? ""),
    clientEmail: String(data.client_email ?? ""),
    content: normalizeContractContent(data.content),
  })

  return {
    unavailableReason: null,
    form: {
      title: draft.title,
      documentRef: String(data.document_ref),
      companyName: draft.companyName,
      clientName: draft.clientName,
      clientEmail: draft.clientEmail,
      content: draft.content,
      contentHash: String(data.content_hash),
      status: status === "signed" ? "signed" : status === "viewed" ? "viewed" : "sent",
      createdAt: String(data.created_at ?? data.sent_at ?? new Date().toISOString()),
      expiresAt,
      signedAt: data.signed_at ? String(data.signed_at) : null,
      signerName: data.signer_name ? String(data.signer_name) : null,
      signerPosition: data.signer_position ? String(data.signer_position) : null,
    },
  }
}

export function publicContractDraft(form: PublicInclusionContract): ContractDraft {
  return {
    title: form.title,
    companyName: form.companyName,
    clientName: form.clientName,
    clientEmail: form.clientEmail,
    content: form.content,
  }
}
