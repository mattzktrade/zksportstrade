"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  DEFAULT_OPERATIONS_EMAIL_TEMPLATES,
  OPERATIONS_EMAIL_KINDS,
  operationsEmailKindLabel,
  type OperationsEmailKind,
  type OperationsEmailTemplate,
} from "@/lib/operations/emails"
import { saveOperationsEmailTemplate } from "@/app/(admin)/admin/operations/template-actions"

export function OperationsTemplates({
  templates,
  canManage,
}: {
  templates: OperationsEmailTemplate[]
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [kind, setKind] = useState<OperationsEmailKind>("guest_details")
  const current = templates.find((row) => row.kind === kind) ?? {
    kind,
    ...DEFAULT_OPERATIONS_EMAIL_TEMPLATES[kind],
  }
  const [subject, setSubject] = useState(current.subject)
  const [body, setBody] = useState(current.body)

  function select(next: OperationsEmailKind) {
    const template = templates.find((row) => row.kind === next) ?? {
      kind: next,
      ...DEFAULT_OPERATIONS_EMAIL_TEMPLATES[next],
    }
    setKind(next)
    setSubject(template.subject)
    setBody(template.body)
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div className="rounded-lg border bg-white p-2">
        {OPERATIONS_EMAIL_KINDS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => select(value)}
            className={`block w-full rounded-md px-3 py-2 text-left text-[11px] ${
              kind === value ? "bg-red-50 font-semibold text-primary" : "text-slate-600"
            }`}
          >
            {operationsEmailKindLabel(value)}
          </button>
        ))}
      </div>
      <div className="rounded-lg border bg-white p-4">
        <p className="text-[11px] text-slate-500">
          Placeholders: {"{{first_name}}"}, {"{{event}}"}, {"{{account_name}}"}, {"{{guests}}"}, {"{{guest_form_url}}"}, {"{{deadline}}"}, {"{{collection_point}}"}, {"{{collection_time}}"}. Sending still lets staff tweak one email.
        </p>
        <label className="mt-3 block text-[11px] font-semibold">
          Subject
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            disabled={!canManage}
            className="mt-1 h-10 w-full rounded-md border px-3 font-normal"
          />
        </label>
        <label className="mt-3 block text-[11px] font-semibold">
          Body
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={!canManage}
            className="mt-1 min-h-80 w-full rounded-md border p-3 font-normal leading-6"
          />
        </label>
        {canManage ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await saveOperationsEmailTemplate({ kind, subject, body })
                if (!result.ok) {
                  toast.error(result.message)
                  return
                }
                toast.success(result.message)
                router.refresh()
              })
            }
            className="mt-3 h-9 rounded-md bg-primary px-4 text-[11px] font-semibold text-white"
          >
            {pending ? "Saving…" : "Save template"}
          </button>
        ) : null}
      </div>
    </div>
  )
}
