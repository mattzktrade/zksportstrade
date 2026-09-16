"use client"

import { useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { saveMarketingOutreachSequence } from "@/app/(admin)/admin/integrations/marketing-leads/outreach-actions"
import {
  outreachTemplateToMetaBody,
  outreachVarsFromSnapshot,
  renderOutreachTemplate,
} from "@/lib/integrations/marketing-leads/outreach-render"
import type { MarketingOutreachSettings, MarketingOutreachStep } from "@/lib/integrations/marketing-leads/outreach-types"

const SAMPLE = outreachVarsFromSnapshot({
  firstName: "Kary",
  fullName: "Kary Avs Di Angel",
  event: "2026 Mexico City Grand Prix",
  packageName: "3 Day Paddock Club (Club Suite)",
  quantity: 2,
})

function stageTitle(stage: number): string {
  if (stage === 1) return "Stage 1 — when the lead arrives"
  if (stage === 2) return "Stage 2 — if they have not replied"
  return "Stage 3 — last note, then stop"
}

export function SalesTemplatesEditor({
  settings,
  steps,
  missingTables,
}: {
  settings: MarketingOutreachSettings | null
  steps: MarketingOutreachStep[]
  missingTables: boolean
}) {
  const [enabled, setEnabled] = useState(settings?.enabled === true)
  const [drafts, setDrafts] = useState(steps)
  const [pending, startTransition] = useTransition()

  const preview = useMemo(() => {
    return drafts.map((step) => ({
      stage: step.stage,
      emailSubject: renderOutreachTemplate(step.email_subject, SAMPLE),
      emailBody: renderOutreachTemplate(step.email_body, SAMPLE),
      whatsappBody: renderOutreachTemplate(step.whatsapp_body, SAMPLE),
      metaBody: outreachTemplateToMetaBody(step.whatsapp_body),
    }))
  }, [drafts])

  if (missingTables) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
        Follow-up templates are not available yet. Ask an admin to finish the marketing outreach setup.
      </div>
    )
  }

  function updateStep(id: string, patch: Partial<MarketingOutreachStep>) {
    setDrafts((current) => current.map((step) => (step.id === id ? { ...step, ...patch } : step)))
  }

  function save() {
    startTransition(async () => {
      const result = await saveMarketingOutreachSequence({
        enabled,
        steps: drafts.map((step) => ({
          id: step.id,
          delayHours: step.delay_hours,
          emailEnabled: step.email_enabled,
          emailSubject: step.email_subject,
          emailBody: step.email_body,
          whatsappEnabled: step.whatsapp_enabled,
          whatsappBody: step.whatsapp_body,
          whatsappTemplateName: step.whatsapp_template_name,
          whatsappTemplateLanguage: step.whatsapp_template_language,
        })),
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
    })
  }

  if (drafts.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
        No follow-up stages were found. Ask an admin to check the marketing outreach setup.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Marketing lead follow-up</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Edit the three messages, then turn the sequence on and save. Nothing goes out until that box is ticked.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save templates"}
        </button>
      </div>

      {!enabled ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Automatic sending is off. New marketing leads still land on Enquiries, but no email or WhatsApp will go out
          until you tick the box below and save.
        </p>
      ) : (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Automatic sending is on. New marketing leads get these messages until they reply or someone on the team takes
          over.
        </p>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        Send this sequence automatically on new marketing leads
      </label>

      {drafts.map((step, index) => (
        <div key={step.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-foreground">{stageTitle(step.stage)}</p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Wait
              <input
                type="number"
                min={0}
                max={720}
                value={step.delay_hours}
                onChange={(event) => updateStep(step.id, { delay_hours: Number(event.target.value) || 0 })}
                className="h-8 w-20 rounded-md border px-2 text-sm"
              />
              hours {step.stage === 1 ? "after the lead arrives" : "after the previous stage"}
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={step.email_enabled}
                  onChange={(event) => updateStep(step.id, { email_enabled: event.target.checked })}
                />
                Email
              </label>
              <input
                value={step.email_subject}
                onChange={(event) => updateStep(step.id, { email_subject: event.target.value })}
                placeholder="Subject"
                className="h-9 w-full rounded-md border px-3 text-sm"
              />
              <textarea
                value={step.email_body}
                onChange={(event) => updateStep(step.id, { email_body: event.target.value })}
                rows={7}
                className="w-full rounded-md border p-3 text-sm"
              />
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">Preview</p>
                <p className="mt-1 font-medium">{preview[index]?.emailSubject}</p>
                <p className="mt-2 whitespace-pre-wrap">{preview[index]?.emailBody}</p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={step.whatsapp_enabled}
                  onChange={(event) => updateStep(step.id, { whatsapp_enabled: event.target.checked })}
                />
                WhatsApp
              </label>
              <textarea
                value={step.whatsapp_body}
                onChange={(event) => updateStep(step.id, { whatsapp_body: event.target.value })}
                rows={5}
                className="w-full rounded-md border p-3 text-sm"
              />
              <input
                value={step.whatsapp_template_name}
                onChange={(event) => updateStep(step.id, { whatsapp_template_name: event.target.value })}
                placeholder="Meta template name"
                className="h-9 w-full rounded-md border px-3 text-sm"
              />
              <input
                value={step.whatsapp_template_language}
                onChange={(event) => updateStep(step.id, { whatsapp_template_language: event.target.value })}
                placeholder="Language, e.g. en"
                className="h-9 w-full rounded-md border px-3 text-sm"
              />
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">Preview</p>
                <p className="mt-2 whitespace-pre-wrap">{preview[index]?.whatsappBody}</p>
                <p className="mt-3 font-medium text-slate-800">
                  Numbered version for Meta (uses {"{{1}}"} variables)
                </p>
                <p className="mt-1 whitespace-pre-wrap font-mono text-[11px]">{preview[index]?.metaBody}</p>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
