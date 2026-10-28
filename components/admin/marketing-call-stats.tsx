import {
  CALL_LOST_REASON_LABELS,
  CALL_OUTCOME_LABELS,
  CALL_OUTCOMES,
  CALL_LOST_REASONS,
} from "@/lib/crm/call-outcomes"
import type { MarketingCallStats, MarketingCallStatsRow } from "@/lib/crm/marketing-call-stats"

function percent(part: number, whole: number): string {
  if (whole === 0) return "—"
  return `${Math.round((part / whole) * 100)}%`
}

function minutes(value: number | null): string {
  if (value == null) return "—"
  if (value < 60) return `${value} min`
  const hours = value / 60
  return hours < 48 ? `${Math.round(hours * 10) / 10} h` : `${Math.round(hours / 24)} days`
}

function StatsRow({ row, bold }: { row: MarketingCallStatsRow; bold?: boolean }) {
  return (
    <tr className={bold ? "font-semibold text-foreground" : "text-muted-foreground"}>
      <td className="px-2 py-1.5">{row.ownerName}</td>
      <td className="px-2 py-1.5 text-right">{row.leads}</td>
      <td className="px-2 py-1.5 text-right">{percent(row.calledWithin15, row.leads)}</td>
      <td className="px-2 py-1.5 text-right">{minutes(row.medianFirstCallMinutes)}</td>
      <td className="px-2 py-1.5 text-right">{percent(row.connected, row.leads)}</td>
      <td className="px-2 py-1.5 text-right">
        {row.called === 0 ? "—" : Math.round((row.attempts / row.called) * 10) / 10}
      </td>
      <td className="px-2 py-1.5 text-right">{row.purchases}</td>
    </tr>
  )
}

export function MarketingCallStatsPanel({ stats }: { stats: MarketingCallStats | null }) {
  if (!stats) return null
  const outcomes = CALL_OUTCOMES.filter((outcome) => (stats.outcomes[outcome] ?? 0) > 0)
  const lost = CALL_LOST_REASONS.filter((reason) => (stats.lostReasons[reason] ?? 0) > 0)
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
      <div>
        <p className="font-semibold text-foreground">Marketing lead calls · last {stats.days} days</p>
        <p className="text-xs text-muted-foreground">
          Aim to call within 15 minutes. Contact rate is leads someone has spoken to.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-left font-medium">Owner</th>
              <th className="px-2 py-1 text-right font-medium">Leads</th>
              <th className="px-2 py-1 text-right font-medium">Called in 15 min</th>
              <th className="px-2 py-1 text-right font-medium">Median first call</th>
              <th className="px-2 py-1 text-right font-medium">Contact rate</th>
              <th className="px-2 py-1 text-right font-medium">Calls per lead</th>
              <th className="px-2 py-1 text-right font-medium">Booked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <StatsRow row={stats.total} bold />
            {stats.byOwner.map((row) => (
              <StatsRow key={row.ownerId ?? "unassigned"} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      {outcomes.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Call outcomes: </span>
          {outcomes.map((outcome) => `${CALL_OUTCOME_LABELS[outcome]} ${stats.outcomes[outcome]}`).join(" · ")}
        </p>
      ) : null}
      {lost.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Lost reasons: </span>
          {lost.map((reason) => `${CALL_LOST_REASON_LABELS[reason]} ${stats.lostReasons[reason]}`).join(" · ")}
        </p>
      ) : null}
    </div>
  )
}
