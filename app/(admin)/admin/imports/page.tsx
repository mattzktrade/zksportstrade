import { requireCmsPermission } from "@/lib/admin/require-admin"
import {
  getCrmImportBatches,
  getCrmImportPreviewRows,
} from "@/lib/crm/imports/queries"
import { CrmImportsClient } from "./crm-imports-client"

export const dynamic = "force-dynamic"

export default async function CrmImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>
}) {
  await requireCmsPermission("settings.manage")
  const params = await searchParams
  const batches = await getCrmImportBatches()
  const selectedBatchId =
    batches.find((batch) => batch.id === params.batch)?.id ?? batches[0]?.id ?? null
  const previewRows = await getCrmImportPreviewRows(selectedBatchId)

  return (
    <div className="mx-auto max-w-[1540px] p-3 sm:p-5 lg:p-7">
      <CrmImportsClient
        batches={batches}
        selectedBatchId={selectedBatchId}
        previewRows={previewRows}
      />
    </div>
  )
}

