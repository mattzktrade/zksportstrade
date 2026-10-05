import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { requireCmsPermission } from "@/lib/admin/require-admin"
import { AdminPageHeader } from "@/components/admin/admin-page-kit"
import {
  blankContractContent,
  syHoldingsContractContent,
  syHoldingsContractTitle,
} from "@/lib/contracts/content"
import { loadDealPrefill } from "@/lib/contracts/queries"
import { ContractEditor } from "../contract-editor"

export const dynamic = "force-dynamic"

export default async function NewContractPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; deal?: string }>
}) {
  await requireCmsPermission("deals.manage")
  const params = await searchParams
  const template = params.template === "blank" || params.template === "sy" ? params.template : null
  const dealId = typeof params.deal === "string" ? params.deal : ""
  const dealQuery = dealId ? `&deal=${encodeURIComponent(dealId)}` : ""

  if (!template) {
    return (
      <div className="mx-auto max-w-[1540px] space-y-4 p-3 sm:p-5 lg:p-7">
        <Link href="/admin/contracts" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#5f636b] hover:text-[#18191c]">
          <ArrowLeft className="h-4 w-4" />
          All contracts
        </Link>
        <AdminPageHeader
          title="New contract"
          description="Choose a starting point. You can edit every line before anyone sees it."
        />
        <div className="grid gap-3 md:grid-cols-2">
          <Link
            href={`/admin/contracts/new?template=sy${dealQuery}`}
            className="rounded-lg border border-[#eceef1] bg-white p-5 hover:border-[#F90202]/40"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#F90202]">Ready to edit</p>
            <h2 className="mt-1 text-base font-semibold">SY Holdings – Singapore Velocity Terrace</h2>
            <p className="mt-2 text-sm leading-6 text-[#5f636b]">
              Private terrace, staffing, branding, food and drink, arrival, entertainment, and photography for the 2026 Singapore Grand Prix. Change any line, then add who should sign.
            </p>
          </Link>
          <Link
            href={`/admin/contracts/new?template=blank${dealQuery}`}
            className="rounded-lg border border-[#eceef1] bg-white p-5 hover:border-[#F90202]/40"
          >
            <h2 className="text-base font-semibold">Blank contract</h2>
            <p className="mt-2 text-sm leading-6 text-[#5f636b]">
              Start from an empty page and write the inclusions for this client.
            </p>
          </Link>
        </div>
      </div>
    )
  }

  const prefill = dealId ? await loadDealPrefill(dealId) : null
  const content = template === "sy" ? syHoldingsContractContent() : blankContractContent()

  return (
    <ContractEditor
      canManage
      initial={{
        id: null,
        documentRef: null,
        title: template === "sy" ? syHoldingsContractTitle() : "",
        companyName: prefill?.companyName ?? (template === "sy" ? "SY Holdings" : ""),
        clientName: prefill?.clientName ?? "",
        clientEmail: prefill?.clientEmail ?? "",
        dealId: prefill?.dealId ?? null,
        dealReference: prefill?.dealReference ?? null,
        accountId: prefill?.accountId ?? null,
        contactId: prefill?.contactId ?? null,
        content,
        status: "draft",
        expiresAt: null,
        signedAt: null,
        signerName: null,
        signerPosition: null,
        lastError: null,
        signingUrl: null,
        templateNote:
          template === "sy"
            ? "Started from the Singapore Velocity Terrace inclusions. Edit anything before you send it."
            : null,
        events: [],
      }}
    />
  )
}
