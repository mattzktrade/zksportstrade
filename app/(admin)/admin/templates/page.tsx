import { requireCmsPermission } from "@/lib/admin/require-admin"
import { AdminPageHeader } from "@/components/admin/admin-page-kit"
import { loadMarketingOutreachAdmin } from "@/lib/integrations/marketing-leads/outreach-store"
import { SalesTemplatesEditor } from "./templates-client"

export const dynamic = "force-dynamic"

export default async function SalesTemplatesPage() {
  await requireCmsPermission("deals.view")
  const outreach = await loadMarketingOutreachAdmin()

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-3 sm:p-4 lg:p-5">
      <AdminPageHeader
        title="Templates"
        description="Email and WhatsApp follow-up for marketing leads that land on Enquiries."
      />

      <div className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
        <p className="font-semibold text-foreground">How it works</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            Meta form leads arrive on Sales → Enquiries. If the sequence is on, they get these three messages until
            they reply or someone on the team takes over.
          </li>
          <li>Stage 1 can send as soon as the lead arrives. Stages 2 and 3 wait the hours you set, and only if they have not replied.</li>
          <li>A reply, or moving the enquiry off New, stops the sequence so sales can continue by hand.</li>
          <li>
            Placeholders fill in from the lead:{" "}
            <span className="font-mono text-xs text-foreground">
              {"{{first_name}} {{event}} {{package}} {{quantity}}"}
            </span>
          </li>
          <li>
            WhatsApp must use an approved Meta template. If you change the WhatsApp wording, update that template in
            Meta so the two still match.
          </li>
        </ul>
      </div>

      <SalesTemplatesEditor
        settings={outreach.settings}
        steps={outreach.steps}
        missingTables={outreach.missingTables}
      />
    </div>
  )
}
