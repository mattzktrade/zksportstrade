import { notFound } from "next/navigation"
import { requireCmsPermission } from "@/lib/admin/require-admin"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import type { ContractStatus } from "@/lib/contracts/content"
import { loadInclusionContract } from "@/lib/contracts/queries"
import { ContractEditor } from "../contract-editor"

export const dynamic = "force-dynamic"

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ contractId: string }>
}) {
  const profile = await requireCmsPermission("deals.view")
  const { contractId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(contractId)) notFound()
  const contract = await loadInclusionContract(contractId)
  if (!contract) notFound()
  const signingUrl = contract.signingToken
    ? `${getServerSiteOrigin()}/sign/contract/${encodeURIComponent(contract.signingToken)}`
    : null

  return (
    <ContractEditor
      key={`${contract.id}-${contract.updatedAt}`}
      canManage={hasCmsPermission(profile, "deals.manage")}
      initial={{
        id: contract.id,
        documentRef: contract.documentRef,
        title: contract.title,
        companyName: contract.companyName,
        clientName: contract.clientName,
        clientEmail: contract.clientEmail,
        dealId: contract.dealId,
        dealReference: contract.dealReference,
        accountId: contract.accountId,
        contactId: contract.contactId,
        content: contract.content,
        status: contract.status as ContractStatus,
        expiresAt: contract.expiresAt,
        signedAt: contract.signedAt,
        signerName: contract.signerName,
        signerPosition: contract.signerPosition,
        lastError: contract.lastError,
        signingUrl: contract.status === "voided" || contract.status === "declined" ? null : signingUrl,
        templateNote: null,
        events: contract.events,
      }}
    />
  )
}
