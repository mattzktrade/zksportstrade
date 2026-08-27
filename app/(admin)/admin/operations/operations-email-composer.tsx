"use client"

import { useEffect, useState, useTransition, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Mail, X } from "lucide-react"
import { toast } from "sonner"
import { previewOperationsEmail, sendOperationsEmail } from "@/app/(admin)/admin/operations/email-actions"
import {
  operationsEmailKindLabel,
  type OperationsEmailDraft,
  type OperationsEmailHistoryRow,
  type OperationsEmailKind,
} from "@/lib/operations/emails"

function BodyPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setTarget(document.body)
  }, [])
  if (!target) return null
  return createPortal(children, target)
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function OperationsEmailComposer({
  dealId,
  kind,
  onClose,
  onSent,
}: {
  dealId: string
  kind: OperationsEmailKind
  onClose: () => void
  onSent: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<OperationsEmailDraft | null>(null)
  const [history, setHistory] = useState<OperationsEmailHistoryRow[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    previewOperationsEmail({ dealId, kind }).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        toast.error(result.message)
        onClose()
        return
      }
      setDraft(result.draft)
      setHistory(result.history)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [dealId, kind, onClose])

  function update<K extends keyof OperationsEmailDraft>(key: K, value: OperationsEmailDraft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  function send() {
    if (!draft) return
    startTransition(async () => {
      const result = await sendOperationsEmail({
        dealId,
        kind,
        toEmail: draft.toEmail,
        toName: draft.toName,
        subject: draft.subject,
        body: draft.body,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      onSent()
    })
  }

  const title = operationsEmailKindLabel(kind)

  return (
    <BodyPortal>
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" data-escape-close="" onClick={onClose}>
        <div
          className="flex max-h-[94vh] min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b px-6 py-5">
            <div>
              <h2 className="text-lg font-bold">{title}</h2>
              <p className="mt-1 text-sm text-slate-500">
                Review the email, change anything you need, then send. A copy is kept on this deal.
              </p>
            </div>
            <button type="button" onClick={onClose}>
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            {loading || !draft ? (
              <p className="text-sm text-slate-500">Loading draft…</p>
            ) : (
              <>
                <label className="block text-sm font-semibold">
                  To
                  <input
                    type="email"
                    value={draft.toEmail}
                    onChange={(event) => update("toEmail", event.target.value)}
                    className="mt-2 h-11 w-full rounded-md border px-3 font-normal"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Recipient name
                  <input
                    value={draft.toName}
                    onChange={(event) => update("toName", event.target.value)}
                    className="mt-2 h-11 w-full rounded-md border px-3 font-normal"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Subject
                  <input
                    value={draft.subject}
                    onChange={(event) => update("subject", event.target.value)}
                    className="mt-2 h-11 w-full rounded-md border px-3 font-normal"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Message
                  <textarea
                    value={draft.body}
                    onChange={(event) => update("body", event.target.value)}
                    className="mt-2 min-h-72 w-full rounded-md border p-3 font-normal leading-6"
                  />
                </label>
                {history.length ? (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Previously sent
                    </p>
                    <ul className="mt-2 space-y-2">
                      {history.map((row) => (
                        <li key={row.id} className="text-[11px] text-slate-600">
                          <span className="font-medium">{formatWhen(row.sentAt)}</span>
                          {" · "}
                          {row.toEmail}
                          {row.sentByName ? ` · ${row.sentByName}` : ""}
                          <p className="text-slate-400">{row.subject}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">This email has not been sent on this deal yet.</p>
                )}
              </>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t px-6 py-4">
            <button type="button" onClick={onClose} className="h-10 rounded-md border px-4 text-sm">
              Cancel
            </button>
            <button
              type="button"
              disabled={pending || !draft}
              onClick={send}
              className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Mail className="h-4 w-4" />
              {pending ? "Sending…" : "Send email"}
            </button>
          </div>
        </div>
      </div>
    </BodyPortal>
  )
}
