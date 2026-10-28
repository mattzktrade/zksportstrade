import { requireCmsPermission } from "@/lib/admin/require-admin"
import { AdminPageHeader } from "@/components/admin/admin-page-kit"
import { MarketingCallStatsPanel } from "@/components/admin/marketing-call-stats"
import { loadMarketingCallStats } from "@/lib/crm/marketing-call-stats"
import { loadMarketingOutreachAdmin } from "@/lib/integrations/marketing-leads/outreach-store"
import { SalesTemplatesEditor } from "./templates-client"

export const dynamic = "force-dynamic"

export default async function SalesTemplatesPage() {
  await requireCmsPermission("deals.view")
  const [outreach, callStats] = await Promise.all([loadMarketingOutreachAdmin(), loadMarketingCallStats(30)])

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
            Website and Meta leads arrive on Sales → Enquiries. If the sequence is on, they get these three messages until
            they reply, book, or someone on the team speaks to them.
          </li>
          <li>
            Stage 1 waits the hours and minutes you set — five minutes by default, so it does not feel instant. Stages 2
            and 3 wait after the previous stage, and only send between 9:00 and 20:00 in the lead&apos;s local time
            (guessed from their phone number, Dubai if unknown).
          </li>
          <li>
            Leads stay on New until someone speaks to them. Use the Call list on Enquiries and log every call. A call
            where you spoke to them, a reply, a website booking, or moving the enquiry off New stops the sequence. No
            answer keeps it running and schedules the next call.
          </li>
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

      <MarketingCallStatsPanel stats={callStats} />

      <SalesTemplatesEditor
        settings={outreach.settings}
        steps={outreach.steps}
        missingTables={outreach.missingTables}
      />
    </div>
  )
}
