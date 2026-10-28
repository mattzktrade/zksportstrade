"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Phone } from "lucide-react"
import { toast } from "sonner"
import { logEnquiryCall } from "@/app/(admin)/admin/enquiries/call-actions"
import {
  CALL_LOST_REASON_LABELS,
  CALL_LOST_REASONS,
  CALL_OUTCOME_LABELS,
  MAX_CALL_ATTEMPTS,
  callOutcomeConnected,
  callOutcomeNeedsCallback,
  callOutcomeNeedsLostReason,
  type CallLostReason,
  type CallOutcome,
  type EnquiryCallSummary,
} from "@/lib/crm/call-outcomes"
import { relativeActivityTime } from "@/lib/crm/deal-pipeline"
import { cn } from "@/lib/utils"

const QUICK_OUTCOMES: CallOutcome[] = ["no_answer", "voicemail"]
const SPOKE_OUTCOMES: CallOutcome[] = [
  "connected_interested",
  "connected_callback",
  "connected_not_interested",
  "connected_booked",
]
const OTHER_OUTCOMES: CallOutcome[] = ["busy", "wrong_number", "do_not_contact", "unqualified"]

const SPOKE_LABELS: Partial<Record<CallOutcome, string>> = {
  connected_interested: "Interested",
  connected_callback: "Call back later",
  connected_not_interested: "Not interested",
  connected_booked: "Already booked",
}

export function formatCallDue(value: string | number | null | undefined): string {
  if (value == null || value === "") return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function EnquiryCallLine({ summary }: { summary?: EnquiryCallSummary }) {
  if (!summary || summary.attempts === 0) return null
  return (
    <p className="mt-0.5 text-[8px] font-medium text-slate-500">
      {summary.attempts} call{summary.attempts === 1 ? "" : "s"}
      {summary.lastOutcome ? ` · ${CALL_OUTCOME_LABELS[summary.lastOutcome]}` : ""}
    </p>
  )
}

function CallProgress({ summary }: { summary?: EnquiryCallSummary }) {
  const done = [...(summary?.history ?? [])].sort((a, b) => a.attempt_no - b.attempt_no)
  const slots = Math.max(MAX_CALL_ATTEMPTS, done.length)
  return (
    <div className="mt-2 flex items-center gap-1" aria-label="Call attempts">
      {Array.from({ length: slots }, (_, index) => {
        const row = done[index]
        const current = !row && index === done.length && !summary?.connected
        return (
          <span
            key={index}
            title={row ? `Call ${row.attempt_no}: ${CALL_OUTCOME_LABELS[row.outcome]}` : `Call ${index + 1}`}
            className={cn(
              "flex h-6 min-w-6 flex-1 items-center justify-center rounded text-[9px] font-semibold",
              row
                ? callOutcomeConnected(row.outcome)
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-300 text-slate-700"
                : current
                  ? "border-2 border-primary text-primary"
                  : "border border-slate-200 text-slate-300",
            )}
          >
            {index + 1}
          </span>
        )
      })}
    </div>
  )
}

export function EnquiryCallPanel({
  deal,
  summary,
  canManage,
}: {
  deal: {
    id: string
    source: string
    contact_phone: string | null
    next_action: string | null
    next_action_due_at: string | null
  }
  summary?: EnquiryCallSummary
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [mode, setMode] = useState<"" | "spoke" | "other">("")
  const [outcome, setOutcome] = useState<CallOutcome | "">("")
  const [lostReason, setLostReason] = useState<CallLostReason | "">("")
  const [callbackAt, setCallbackAt] = useState("")
  const [notes, setNotes] = useState("")

  function reset() {
    setMode("")
    setOutcome("")
    setLostReason("")
    setCallbackAt("")
    setNotes("")
  }

  useEffect(reset, [deal.id])

  const attempts = summary?.attempts ?? 0

  function save(chosen: CallOutcome) {
    const callback = callbackAt ? new Date(callbackAt) : null
    startTransition(async () => {
      const result = await logEnquiryCall({
        dealId: deal.id,
        outcome: chosen,
        notes,
        lostReason: lostReason || null,
        callbackAt: callback && !Number.isNaN(callback.getTime()) ? callback.toISOString() : null,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      reset()
      router.refresh()
    })
  }

  function choose(next: CallOutcome) {
    if (next === "no_answer" || next === "voicemail" || next === "busy") {
      save(next)
      return
    }
    setOutcome(next)
  }

  const choices = mode === "spoke" ? SPOKE_OUTCOMES : mode === "other" ? OTHER_OUTCOMES : []

  return (
    <div className="rounded-lg border-2 border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold text-slate-800">Calls</h3>
        {deal.contact_phone ? (
          <a
            href={`tel:${deal.contact_phone}`}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-slate-900 px-3 text-[10px] font-semibold text-white"
          >
            <Phone className="h-3 w-3" /> Call {deal.contact_phone}
          </a>
        ) : (
          <span className="text-[8px] text-slate-400">No phone number</span>
        )}
      </div>

      <CallProgress summary={summary} />
      <p className="mt-1.5 text-[9px] text-slate-600">
        {summary?.connected
          ? "Spoken to"
          : attempts === 0
            ? "Not called yet"
            : `Last: ${summary?.lastOutcome ? CALL_OUTCOME_LABELS[summary.lastOutcome] : "—"}, ${relativeActivityTime(summary?.lastCalledAt)}`}
      </p>
      {deal.source === "marketing" && attempts === 0 ? (
        <p className="mt-0.5 text-[10px] font-semibold text-primary">Next: first call, as soon as you can</p>
      ) : attempts > 0 && deal.next_action ? (
        <p className="mt-0.5 text-[10px] font-semibold text-slate-800">
          Next: {deal.next_action}
          {deal.next_action_due_at ? ` · ${formatCallDue(deal.next_action_due_at)}` : ""}
        </p>
      ) : null}

      {canManage ? (
        <div className="mt-3 space-y-2">
          <p className="text-[8px] font-medium uppercase tracking-wide text-slate-400">After the call, tap what happened</p>
          <div className="grid grid-cols-3 gap-1.5">
            {QUICK_OUTCOMES.map((value) => (
              <button
                key={value}
                type="button"
                disabled={pending}
                onClick={() => choose(value)}
                className="min-h-10 rounded-md border border-slate-300 bg-white px-2 text-[10px] font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                {value === "voicemail" ? "Voicemail" : CALL_OUTCOME_LABELS[value]}
              </button>
            ))}
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setOutcome("")
                setMode((current) => (current === "spoke" ? "" : "spoke"))
              }}
              className={cn(
                "min-h-10 rounded-md px-2 text-[10px] font-semibold disabled:opacity-50",
                mode === "spoke" ? "bg-emerald-700 text-white" : "bg-emerald-600 text-white hover:bg-emerald-700",
              )}
            >
              Spoke to them
            </button>
          </div>

          {choices.length > 0 ? (
            <div className="grid grid-cols-2 gap-1.5">
              {choices.map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={pending}
                  onClick={() => choose(value)}
                  className={cn(
                    "min-h-9 rounded-md border px-2 py-1.5 text-left text-[9px] font-semibold disabled:opacity-50",
                    outcome === value ? "border-primary bg-red-50 text-primary" : "border-slate-200 text-slate-700 hover:bg-slate-50",
                  )}
                >
                  {SPOKE_LABELS[value] ?? CALL_OUTCOME_LABELS[value]}
                </button>
              ))}
            </div>
          ) : null}

          {outcome && callOutcomeNeedsLostReason(outcome) ? (
            <select
              value={lostReason}
              onChange={(event) => setLostReason(event.target.value as CallLostReason | "")}
              className="h-9 w-full rounded-md border bg-white px-2 text-[9px]"
              aria-label="Why they are not interested"
            >
              <option value="">Why not?</option>
              {CALL_LOST_REASONS.filter((value) => value !== "booked_direct").map((value) => (
                <option key={value} value={value}>{CALL_LOST_REASON_LABELS[value]}</option>
              ))}
            </select>
          ) : null}
          {outcome && callOutcomeNeedsCallback(outcome) ? (
            <label className="block text-[8px] font-medium text-slate-500">
              Call back at
              <input
                type="datetime-local"
                value={callbackAt}
                onChange={(event) => setCallbackAt(event.target.value)}
                className="mt-1 h-9 w-full rounded-md border bg-white px-2 text-[9px] text-slate-800"
              />
            </label>
          ) : null}
          {outcome ? (
            <>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Guests, days, budget, who decides…"
                className="min-h-14 w-full rounded-md border p-2 text-[9px]"
              />
              <button
                type="button"
                disabled={pending}
                onClick={() => save(outcome)}
                className="h-9 w-full rounded-md bg-slate-900 text-[9px] font-semibold text-white disabled:opacity-50"
              >
                Save: {SPOKE_LABELS[outcome] ?? CALL_OUTCOME_LABELS[outcome]}
              </button>
            </>
          ) : null}

          {mode !== "other" ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setOutcome("")
                setMode("other")
              }}
              className="text-[8px] font-semibold text-slate-500 hover:text-slate-800"
            >
              Busy, wrong number, do not contact…
            </button>
          ) : null}
        </div>
      ) : null}

      {summary && summary.history.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-2">
          {summary.history.slice(0, 6).map((row) => (
            <li key={row.id} className="text-[8px] text-slate-600">
              <span className="font-semibold text-slate-800">
                Call {row.attempt_no}: {CALL_OUTCOME_LABELS[row.outcome]}
              </span>
              {" · "}
              {row.actor_name || "Staff"} · {relativeActivityTime(row.created_at)}
              {row.notes ? <span className="block text-slate-500">{row.notes}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
