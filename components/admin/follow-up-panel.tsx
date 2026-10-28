import Link from "next/link"
import { ChevronRight, MessageSquare, Phone, PhoneCall } from "lucide-react"
import {
  CALL_LIST_HREF,
  INBOX_NEEDS_REPLY_HREF,
  INBOX_REPLIED_HREF,
  loadFollowUpSummary,
  type FollowUpCallRow,
} from "@/lib/admin/follow-up-summary"
import { CAMPAIGNS_HREF } from "@/lib/crm/marketing-campaigns"
import { cn } from "@/lib/utils"

function dueLabel(row: FollowUpCallRow, now: number): string {
  const minutes = Math.round((now - row.dueAt) / 60_000)
  if (minutes >= 0) {
    if (minutes < 1) return "due now"
    if (minutes < 60) return `overdue ${minutes} min`
    if (minutes < 48 * 60) return `overdue ${Math.round(minutes / 60)} h`
    return `overdue ${Math.round(minutes / (24 * 60))} days`
  }
  return `due ${new Date(row.dueAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" })}`
}

function Tile({
  href,
  value,
  label,
  hint,
  urgent,
  Icon,
}: {
  href: string
  value: number
  label: string
  hint: string
  urgent?: boolean
  Icon: typeof Phone
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-slate-50",
        urgent ? "border-primary/40 bg-red-50/50" : "border-[#eceff3]",
      )}
    >
      <span
        className={cn(
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          urgent ? "bg-primary text-white" : "bg-slate-100 text-slate-600",
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[18px] font-semibold leading-none tabular-nums text-[#17181b]">{value}</span>
        <span className="mt-1 block text-[12px] font-medium text-[#2c3036]">{label}</span>
        <span className="block text-[10px] text-[#8b9198]">{hint}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[#c5c9ce]" aria-hidden />
    </Link>
  )
}

/** "Your follow-ups" on the sales and director dashboards: inbox replies waiting on us and calls due. */
export async function FollowUpPanel({ ownerProfileId }: { ownerProfileId?: string | null }) {
  const summary = await loadFollowUpSummary({ ownerProfileId })
  const now = Date.now()
  return (
    <section className="rounded-xl border border-[#eceff3] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-start justify-between gap-3 px-4 pt-3">
        <div>
          <h2 className="text-[13px] font-semibold text-[#1b1c1f]">Follow-ups</h2>
          <p className="mt-0.5 text-[11px] text-[#8b9198]">Reply to anyone waiting on us, then work through the calls due.</p>
        </div>
        <Link href={CAMPAIGNS_HREF} className="shrink-0 text-[11px] font-medium text-primary hover:underline">
          Campaign results
        </Link>
      </div>
      <div className="grid gap-2 p-4 sm:grid-cols-3">
        <Tile
          href={INBOX_NEEDS_REPLY_HREF}
          value={summary.inboxNeedsReply}
          label="Waiting for our reply"
          hint="Inbox messages we have not answered"
          urgent={summary.inboxNeedsReply > 0}
          Icon={MessageSquare}
        />
        <Tile
          href={INBOX_REPLIED_HREF}
          value={summary.inboxRepliesThisWeek}
          label="Replies this week"
          hint="Clients who messaged us in the last 7 days"
          Icon={MessageSquare}
        />
        <Tile
          href={CALL_LIST_HREF}
          value={summary.callsDueNow}
          label="Calls due now"
          hint={`${summary.callsDueToday} due today in total`}
          urgent={summary.callsDueNow > 0}
          Icon={PhoneCall}
        />
      </div>
      {summary.calls.length > 0 ? (
        <div className="divide-y divide-[#f2f4f6] border-t border-[#f2f4f6]">
          {summary.calls.map((row) => {
            const overdue = row.dueAt <= now
            return (
              <div key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                <Link href={row.href} className="min-w-0 flex-1 hover:underline">
                  <span className="block truncate text-[12px] font-medium text-[#2c3036]">
                    {row.name}
                    <span className="font-normal text-[#8b9198]"> · {row.reference}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-[#8b9198]">
                    Call {row.attempts + 1}
                    {row.lastOutcome ? ` · last: ${row.lastOutcome}` : ""}
                    {row.interest ? ` · ${row.interest}` : ""}
                  </span>
                </Link>
                <span className={cn("shrink-0 text-[11px] font-medium", overdue ? "text-primary" : "text-[#6b7077]")}>
                  {dueLabel(row, now)}
                </span>
                {row.phone ? (
                  <a
                    href={`tel:${row.phone}`}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-slate-900 px-2.5 text-[11px] font-semibold text-white"
                  >
                    <Phone className="h-3 w-3" aria-hidden /> Call
                  </a>
                ) : null}
              </div>
            )
          })}
          <div className="px-4 py-2">
            <Link href={CALL_LIST_HREF} className="text-[11px] font-medium text-primary hover:underline">
              Open the call list
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  )
}
