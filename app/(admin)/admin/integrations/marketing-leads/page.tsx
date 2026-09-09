import Link from "next/link"
import { requireCmsPermission } from "@/lib/admin/require-admin"
import {
  MARKETING_LEAD_PRODUCTION_URL,
  MARKETING_LEAD_WEBHOOK_PATH,
  isMarketingLeadWebhookConfigured,
} from "@/lib/integrations/marketing-leads/config"
import {
  MARKETING_LEAD_AGENCY_QUESTIONS,
  MARKETING_LEAD_EXAMPLE_PAYLOAD,
  marketingLeadCurlExample,
} from "@/lib/integrations/marketing-leads/contract"

export default async function MarketingLeadsIntegrationPage() {
  await requireCmsPermission("settings.manage")
  const configured = isMarketingLeadWebhookConfigured()

  return (
    <div className="max-w-3xl space-y-6 p-6 lg:p-8">
      <div>
        <Link href="/admin/settings?tab=integrations" className="text-sm text-muted-foreground hover:text-primary">
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">Marketing leads</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Meta Instant Form leads POST here and land on Sales → Enquiries as marketing enquiries. Keep the
          spreadsheet as a backup until the Zap has been stable for a few days.
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
        <p>
          <span className="text-muted-foreground">Webhook secret:</span>{" "}
          <span className="font-medium">{configured ? "Configured" : "Not set"}</span>
        </p>
        {!configured ? (
          <p className="rounded-lg bg-amber-50/80 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            Set <span className="font-mono">MARKETING_LEAD_WEBHOOK_SECRET</span> in staging and production, then
            give the agency the URL and secret. Do not put the secret in the Zap description.
          </p>
        ) : null}
        <p className="break-all font-mono text-xs">POST {MARKETING_LEAD_WEBHOOK_PATH}</p>
        <p className="text-xs text-muted-foreground">
          Staging: your preview / localhost origin + <span className="font-mono">{MARKETING_LEAD_WEBHOOK_PATH}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Production: <span className="font-mono">{MARKETING_LEAD_PRODUCTION_URL}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Auth header: <span className="font-mono">x-webhook-secret</span> (also accepts{" "}
          <span className="font-mono">Authorization: Bearer</span> or HMAC{" "}
          <span className="font-mono">x-webhook-signature</span>).
        </p>
        <p className="text-xs text-muted-foreground">
          Apply database migration <span className="font-mono">20260909120000_marketing_lead_ingest</span> before
          going live, then set the secret on staging and production.
        </p>
        <p className="text-xs text-muted-foreground">
          Same Meta lead id twice returns <span className="font-mono">200</span> with{" "}
          <span className="font-mono">{`{ "duplicate": true }`}</span>. Retry HTTP 5xx.
        </p>
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
        <p className="font-semibold">JSON the agency should send</p>
        <p className="text-xs text-muted-foreground">
          Nested fields below, or a flat Zapier/Meta <span className="font-mono">field_data</span> body. Required:
          leadId, name, and email or phone. Package and ticket quantity become notes; a catalog line is attached
          only when the package text matches.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-800">
          {JSON.stringify(MARKETING_LEAD_EXAMPLE_PAYLOAD, null, 2)}
        </pre>
        <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-800">
          {marketingLeadCurlExample()}
        </pre>
        <p className="text-xs text-muted-foreground">
          Local smoke test: <span className="font-mono">npx tsx scripts/marketing-lead-webhook-test.ts</span>
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-4 text-sm">
        <p className="font-semibold">Questions to send the agency</p>
        {MARKETING_LEAD_AGENCY_QUESTIONS.map((group) => (
          <div key={group.heading}>
            <p className="font-medium text-foreground">{group.heading}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
