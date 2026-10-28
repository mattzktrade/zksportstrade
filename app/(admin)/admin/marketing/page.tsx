import Link from "next/link"
import { requireAdmin } from "@/lib/admin/require-admin"
import { AdminPageHeader } from "@/components/admin/admin-page-kit"
import {
  CAMPAIGNS_HREF,
  UNMATCHED_CAMPAIGN_ID,
  loadCampaignReports,
  type CampaignBreakdownRow,
  type CampaignReport,
} from "@/lib/crm/marketing-campaigns"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

function percent(part: number, whole: number): string {
  if (whole === 0) return "0%"
  return `${Math.round((part / whole) * 100)}%`
}

function minutes(value: number | null): string {
  if (value == null) return "—"
  if (value < 60) return `${value} min`
  const hours = value / 60
  return hours < 48 ? `${Math.round(hours * 10) / 10} hours` : `${Math.round(hours / 24)} days`
}

function shortDate(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function eventQuery(campaign: CampaignReport): string {
  return campaign.id === UNMATCHED_CAMPAIGN_ID ? "" : `&event=${campaign.id}`
}

function FunnelTile({
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  label: string
  value: number
  hint?: string
  href?: string
  tone?: "default" | "good" | "muted"
}) {
  const body = (
    <>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-[28px] font-semibold tabular-nums leading-none",
          tone === "good" ? "text-emerald-700" : tone === "muted" ? "text-slate-500" : "text-[#18191c]",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </>
  )
  const className = "block rounded-xl border border-border bg-card p-4"
  return href ? (
    <Link href={href} className={cn(className, "hover:border-slate-300")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

function ActionTile({ label, value, href, cta }: { label: string; value: number; href: string; cta: string }) {
  const urgent = value > 0
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border p-4",
        urgent ? "border-primary/40 bg-red-50" : "border-border bg-card",
      )}
    >
      <div>
        <p className={cn("text-[12px] font-semibold", urgent ? "text-primary" : "text-foreground")}>{label}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{urgent ? cta : "Nothing waiting"}</p>
      </div>
      <span className={cn("text-[28px] font-semibold tabular-nums", urgent ? "text-primary" : "text-slate-400")}>
        {value}
      </span>
    </Link>
  )
}

function BreakdownTable({ title, rows, firstColumn }: { title: string; rows: CampaignBreakdownRow[]; firstColumn: string }) {
  if (rows.length === 0) return null
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[13px] font-semibold text-foreground">{title}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[460px] text-[12px]">
          <thead className="text-[11px] text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-2 text-left font-medium">{firstColumn}</th>
              <th className="px-2 py-1.5 text-right font-medium">Leads</th>
              <th className="px-2 py-1.5 text-right font-medium">Called</th>
              <th className="px-2 py-1.5 text-right font-medium">Responded</th>
              <th className="py-1.5 pl-2 text-right font-medium">Booked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="max-w-[320px] truncate py-2 pr-2 text-foreground" title={row.label}>
                  {row.label}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{row.leads}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.called}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {row.responded} <span className="text-muted-foreground">({percent(row.responded, row.leads)})</span>
                </td>
                <td className="py-2 pl-2 text-right tabular-nums">{row.booked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default async function MarketingCampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>
}) {
  await requireAdmin()
  const { campaign: campaignParam } = await searchParams
  const campaigns = await loadCampaignReports()
  const selected = campaigns.find((row) => row.id === campaignParam) ?? campaigns[0] ?? null

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-3 sm:p-5 lg:p-7">
      <AdminPageHeader
        title="Campaigns"
        description="Results for each Meta lead campaign, grouped by event. Pick a campaign to see only its leads."
      />

      {campaigns.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-8 text-center text-[13px] text-muted-foreground">
          No marketing leads yet. They will appear here as soon as Meta sends the first one.
        </p>
      ) : null}

      {campaigns.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {campaigns.map((row) => (
            <Link
              key={row.id}
              href={`${CAMPAIGNS_HREF}?campaign=${row.id}`}
              className={cn(
                "rounded-lg border px-3 py-2 text-left",
                row.id === selected?.id ? "border-slate-900 bg-slate-900 text-white" : "border-border bg-card hover:border-slate-300",
              )}
            >
              <span className="block text-[12px] font-semibold">{row.name}</span>
              <span className={cn("block text-[11px]", row.id === selected?.id ? "text-white/70" : "text-muted-foreground")}>
                {row.counts.leads} lead{row.counts.leads === 1 ? "" : "s"}
                {row.counts.waitingForOurReply + row.counts.callsDueNow > 0
                  ? ` · ${row.counts.waitingForOurReply + row.counts.callsDueNow} to action`
                  : ""}
              </span>
            </Link>
          ))}
        </div>
      ) : null}

      {selected ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-[17px] font-semibold text-foreground">{selected.name}</h2>
              <p className="text-[11px] text-muted-foreground">
                Leads from {shortDate(selected.firstLeadAt)} to {shortDate(selected.lastLeadAt)}
                {selected.counts.newThisWeek > 0 ? ` · ${selected.counts.newThisWeek} new this week` : ""}
                {selected.eventDate ? ` · Event ${shortDate(selected.eventDate)}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/admin/enquiries?source=marketing${eventQuery(selected)}`}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium hover:border-slate-300"
              >
                Open these leads
              </Link>
              <Link
                href={`/admin/assistant?campaign=${selected.id}`}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium hover:border-slate-300"
              >
                Open their messages
              </Link>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ActionTile
              label="Waiting for our reply"
              value={selected.counts.waitingForOurReply}
              href={`/admin/assistant?view=needs_reply&campaign=${selected.id}`}
              cta="They messaged last. Reply in the Inbox."
            />
            <ActionTile
              label="Calls due now"
              value={selected.counts.callsDueNow}
              href={`/admin/enquiries?view=calls${eventQuery(selected)}`}
              cta="Open the call list for this campaign."
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <FunnelTile label="Leads" value={selected.counts.leads} hint={`${selected.counts.inSequence} still getting follow-ups`} />
            <FunnelTile
              label="Responded"
              value={selected.counts.responded}
              hint={`${percent(selected.counts.responded, selected.counts.leads)} · ${selected.counts.repliedByMessage} by message, ${selected.counts.spokeOnPhone} on the phone`}
            />
            <FunnelTile
              label="Booking form stage"
              value={selected.counts.bookingForm}
              hint="Sent or about to send"
            />
            <FunnelTile
              label="Booked"
              value={selected.counts.booked}
              tone="good"
              hint={`${percent(selected.counts.booked, selected.counts.leads)} of leads`}
            />
            <FunnelTile label="Not interested" value={selected.counts.notInterested} tone="muted" />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <FunnelTile
              label="Leads called"
              value={selected.counts.called}
              hint={`${percent(selected.counts.called, selected.counts.leads)} of leads`}
            />
            <FunnelTile
              label="Called within 15 minutes"
              value={selected.counts.calledWithin15}
              hint={`${percent(selected.counts.calledWithin15, selected.counts.leads)} of leads · aim for all of them`}
            />
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[11px] font-medium text-muted-foreground">Typical time to first call</p>
              <p className="mt-1 text-[28px] font-semibold leading-none text-[#18191c]">
                {minutes(selected.counts.medianFirstCallMinutes)}
              </p>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <BreakdownTable title="By ad" firstColumn="Meta campaign · ad set" rows={selected.byAd} />
            <BreakdownTable title="By salesperson" firstColumn="Owner" rows={selected.byOwner} />
          </div>

          <p className="text-[11px] text-muted-foreground">
            Responded means they replied on WhatsApp or email, or we spoke to them on the phone. Booked means a signed
            booking form, a paid order, or a call logged as already booked.
          </p>
        </>
      ) : null}
    </div>
  )
}
