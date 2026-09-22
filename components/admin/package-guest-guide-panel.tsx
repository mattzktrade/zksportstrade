"use client"

import { useEffect, useState, useTransition, type ReactNode } from "react"
import { toast } from "sonner"
import { savePackageGuestGuideContent } from "@/app/(admin)/admin/catalog/brochure-actions"
import { PackageGuestGuideActions } from "@/components/admin/package-guest-guide-actions"
import {
  emptyGuestGuideContent,
  matchesOfficialGuestGuide,
  officialSingaporeVelocityTerraceGuestGuide,
  parseGuestGuide,
} from "@/lib/brochures/guest-guide/content"
import type { GuestGuideContent, GuestGuidePage, GuestGuidePageKey } from "@/lib/brochures/guest-guide/types"

const PAGE_HINTS: Record<GuestGuidePageKey, string> = {
  welcome: "Opening welcome. This page is required. First line is usually Welcome to, second line is the venue name.",
  beforeWeekend: "Key dates before arrival. Use a date, title and body for each deadline.",
  digitalTicket: "How the TicketBud QR ticket works, plus the before-arrival checklist.",
  arriving: "Venue facts and numbered arrival steps.",
  experience: "What guests enjoy once they are in.",
  gettingThere: "Travel sections such as MRT, taxi and late arrival.",
  parking: "Parking notes and nearby car parks. This page stays text-only.",
  ticketHelp: "Door help plus on-ground contact. Leave [NAME] and [NUMBER] until you have real details.",
  thingsToKnow: "One fact per line as Label | Value.",
  closing: "Final welcome, event lines, then the Discover sentence, web link and QR. Do not repeat the product name as a Venue line.",
}

function paragraphsToText(values?: string[]): string {
  return (values ?? []).join("\n\n")
}

function textToParagraphs(value: string): string[] {
  return value
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function listToText(values?: string[]): string {
  return (values ?? []).join("\n")
}

function textToList(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
}

function factsToText(values?: Array<{ label: string; value: string }>): string {
  return (values ?? [])
    .filter((item) => item.label.trim() || item.value.trim())
    .map((item) => `${item.label} | ${item.value}`)
    .join("\n")
}

function textToFacts(value: string): Array<{ label: string; value: string }> {
  return textToList(value).map((line) => {
    const split = line.split("|")
    if (split.length < 2) return { label: "", value: line }
    return { label: split[0]!.trim(), value: split.slice(1).join("|").trim() }
  })
}

function stepsToText(values?: Array<{ title: string; body: string }>): string {
  return (values ?? [])
    .filter((item) => item.title.trim() || item.body.trim())
    .map((item) => `${item.title} | ${item.body}`)
    .join("\n")
}

function textToSteps(value: string): Array<{ title: string; body: string }> {
  return textToList(value).map((line) => {
    const split = line.split("|")
    if (split.length < 2) return { title: line, body: "" }
    return { title: split[0]!.trim(), body: split.slice(1).join("|").trim() }
  })
}

function initialGuide(input: {
  stored: unknown
  productName: string
  raceName?: string | null
  location?: string | null
}): GuestGuideContent {
  return (
    parseGuestGuide(input.stored) ??
    (matchesOfficialGuestGuide(input) ? officialSingaporeVelocityTerraceGuestGuide() : emptyGuestGuideContent())
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-muted-foreground/80">{hint}</span> : null}
    </label>
  )
}

function PageEditor({
  page,
  onChange,
}: {
  page: GuestGuidePage
  onChange: (page: GuestGuidePage) => void
}) {
  const update = (patch: Partial<GuestGuidePage>) => onChange({ ...page, ...patch })

  return (
    <details className="rounded-lg border border-border bg-background px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        {page.title || page.key}
      </summary>
      <div className="mt-3 grid gap-3">
        <p className="text-[11px] leading-5 text-muted-foreground">{PAGE_HINTS[page.key]}</p>
        <Field label="Page title">
          <input
            value={page.title}
            onChange={(e) => update({ title: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </Field>
        {page.key === "welcome" || page.key === "closing" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title first line">
              <input
                value={page.titleLead ?? ""}
                onChange={(e) => update({ titleLead: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Title second line">
              <input
                value={page.titleAccent ?? ""}
                onChange={(e) => update({ titleAccent: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </Field>
          </div>
        ) : null}
        {page.key === "beforeWeekend" || page.key === "experience" || page.key === "gettingThere" ? (
          <Field label="Intro">
            <textarea
              value={page.intro ?? ""}
              onChange={(e) => update({ intro: e.target.value })}
              className="mt-1 min-h-[72px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
        ) : null}
        {page.key !== "closing" && page.key !== "thingsToKnow" && page.key !== "beforeWeekend" && page.key !== "gettingThere" ? (
          <Field label="Paragraphs" hint="Separate paragraphs with a blank line.">
            <textarea
              value={paragraphsToText(page.paragraphs)}
              onChange={(e) => update({ paragraphs: textToParagraphs(e.target.value) })}
              className="mt-1 min-h-[120px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
        ) : null}
        {page.key === "beforeWeekend" ? (
          <div className="grid gap-3">
            {(page.dateBlocks?.length ? page.dateBlocks : [{ date: "", title: "", body: "", bullets: [] }]).map(
              (block, index) => (
                <div key={index} className="grid gap-2 rounded-md border border-border/70 p-2">
                  <Field label={`Date ${index + 1}`}>
                    <input
                      value={block.date}
                      onChange={(e) => {
                        const dateBlocks = [...(page.dateBlocks ?? [])]
                        dateBlocks[index] = { ...block, date: e.target.value }
                        update({ dateBlocks })
                      }}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </Field>
                  <Field label="Title">
                    <input
                      value={block.title}
                      onChange={(e) => {
                        const dateBlocks = [...(page.dateBlocks ?? [])]
                        dateBlocks[index] = { ...block, title: e.target.value }
                        update({ dateBlocks })
                      }}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </Field>
                  <Field label="Body">
                    <textarea
                      value={block.body}
                      onChange={(e) => {
                        const dateBlocks = [...(page.dateBlocks ?? [])]
                        dateBlocks[index] = { ...block, body: e.target.value }
                        update({ dateBlocks })
                      }}
                      className="mt-1 min-h-[72px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </Field>
                  <Field label="Bullets" hint="One per line.">
                    <textarea
                      value={listToText(block.bullets)}
                      onChange={(e) => {
                        const dateBlocks = [...(page.dateBlocks ?? [])]
                        dateBlocks[index] = { ...block, bullets: textToList(e.target.value) }
                        update({ dateBlocks })
                      }}
                      className="mt-1 min-h-[56px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </Field>
                </div>
              ),
            )}
            <button
              type="button"
              className="text-left text-xs font-medium text-foreground underline-offset-4 hover:underline"
              onClick={() => update({ dateBlocks: [...(page.dateBlocks ?? []), { date: "", title: "", body: "", bullets: [] }] })}
            >
              Add another date
            </button>
          </div>
        ) : null}
        {page.key === "arriving" || page.key === "closing" || page.key === "thingsToKnow" ? (
          <Field
            label={page.key === "arriving" ? "Venue facts" : page.key === "closing" ? "Closing lines" : "Facts"}
            hint="One per line as Label | Value."
          >
            <textarea
              value={factsToText(page.facts)}
              onChange={(e) => update({ facts: textToFacts(e.target.value) })}
              className="mt-1 min-h-[120px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
        ) : null}
        {page.key === "arriving" ? (
          <Field label="Arrival steps" hint="One per line as Title | Body.">
            <textarea
              value={stepsToText(page.steps)}
              onChange={(e) => update({ steps: textToSteps(e.target.value) })}
              className="mt-1 min-h-[140px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
        ) : null}
        {page.key === "digitalTicket" || page.key === "experience" || page.key === "parking" ? (
          <Field label={page.key === "digitalTicket" ? "Before arriving checklist" : "Bullets"} hint="One per line.">
            <textarea
              value={listToText(page.bullets)}
              onChange={(e) => update({ bullets: textToList(e.target.value) })}
              className="mt-1 min-h-[88px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
        ) : null}
        {page.key === "gettingThere" ? (
          <div className="grid gap-3">
            {(page.sections?.length ? page.sections : [{ title: "", body: "", bullets: [] }]).map((section, index) => (
              <div key={index} className="grid gap-2 rounded-md border border-border/70 p-2">
                <Field label={`Section ${index + 1} title`}>
                  <input
                    value={section.title}
                    onChange={(e) => {
                      const sections = [...(page.sections ?? [])]
                      sections[index] = { ...section, title: e.target.value }
                      update({ sections })
                    }}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="Body">
                  <textarea
                    value={section.body}
                    onChange={(e) => {
                      const sections = [...(page.sections ?? [])]
                      sections[index] = { ...section, body: e.target.value }
                      update({ sections })
                    }}
                    className="mt-1 min-h-[72px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="Bullets" hint="One per line.">
                  <textarea
                    value={listToText(section.bullets)}
                    onChange={(e) => {
                      const sections = [...(page.sections ?? [])]
                      sections[index] = { ...section, bullets: textToList(e.target.value) }
                      update({ sections })
                    }}
                    className="mt-1 min-h-[56px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </Field>
              </div>
            ))}
            <button
              type="button"
              className="text-left text-xs font-medium text-foreground underline-offset-4 hover:underline"
              onClick={() => update({ sections: [...(page.sections ?? []), { title: "", body: "", bullets: [] }] })}
            >
              Add another section
            </button>
          </div>
        ) : null}
        {page.key === "digitalTicket" || page.key === "beforeWeekend" || page.key === "experience" || page.key === "parking" ? (
          <Field label="Notes" hint="Separate notes with a blank line.">
            <textarea
              value={paragraphsToText(page.notes)}
              onChange={(e) => update({ notes: textToParagraphs(e.target.value) })}
              className="mt-1 min-h-[72px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
        ) : null}
        {page.key === "ticketHelp" ? (
          <>
            <Field label="On-ground contact">
              <input
                value={page.contactName ?? ""}
                onChange={(e) => update({ contactName: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Telephone / WhatsApp">
              <input
                value={page.contactPhone ?? ""}
                onChange={(e) => update({ contactPhone: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </Field>
          </>
        ) : null}
        {page.key === "closing" ? (
          <>
            <Field label="Highlight line">
              <input
                value={page.highlight ?? ""}
                onChange={(e) => update({ highlight: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Discover sentence" hint="Separate paragraphs with a blank line.">
              <textarea
                value={paragraphsToText(page.paragraphs)}
                onChange={(e) => update({ paragraphs: textToParagraphs(e.target.value) })}
                className="mt-1 min-h-[72px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Link name">
              <input
                value={page.linkLabel ?? ""}
                onChange={(e) => update({ linkLabel: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Link URL" hint="Must be https. This becomes a clickable link in the PDF.">
              <input
                value={page.linkUrl ?? ""}
                onChange={(e) => update({ linkUrl: e.target.value })}
                placeholder="https://"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
              />
            </Field>
            <Field label="QR image path">
              <input
                value={page.qrImagePath ?? ""}
                onChange={(e) => update({ qrImagePath: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
              />
            </Field>
          </>
        ) : null}
      </div>
    </details>
  )
}

export function PackageGuestGuidePanel({
  packageId,
  productName,
  eventName,
  location,
  guestGuideUrl,
  storedGuide,
  onUrlChange,
}: {
  packageId: string
  productName: string
  eventName?: string | null
  location?: string | null
  guestGuideUrl: string | null
  storedGuide: unknown
  onUrlChange?: (url: string) => void
}) {
  const [pending, start] = useTransition()
  const [guide, setGuide] = useState(() =>
    initialGuide({ stored: storedGuide, productName, raceName: eventName, location }),
  )

  useEffect(() => {
    setGuide(initialGuide({ stored: storedGuide, productName, raceName: eventName, location }))
  }, [packageId, storedGuide, productName, eventName, location])

  function updatePage(index: number, page: GuestGuidePage) {
    setGuide((current) => ({
      pages: current.pages.map((item, itemIndex) => (itemIndex === index ? page : item)),
    }))
  }

  function saveCopy() {
    start(async () => {
      const result = await savePackageGuestGuideContent({ packageId, content: guide })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success("Guest guide copy saved.")
    })
  }

  function loadOfficial() {
    const ok = window.confirm(
      "Replace the editor with the official Velocity Terrace Singapore guest guide copy? Unsaved edits on these pages will be lost.",
    )
    if (!ok) return
    setGuide(officialSingaporeVelocityTerraceGuestGuide())
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Guest guide</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Separate from the sales brochure. Cover page stays the same; the following pages use the
            copy below. Empty pages are skipped. Needs at least 3 unique product photos. Only the ZK
            team can generate it — portal clients just download the finished file.
          </p>
        </div>
        <PackageGuestGuideActions
          packageId={packageId}
          guestGuideUrl={guestGuideUrl}
          productName={productName}
          eventName={eventName}
          content={guide}
          onUrlChange={onUrlChange}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={saveCopy}
          className="h-9 rounded-lg border border-border px-3 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
        >
          Save guide copy
        </button>
        <button
          type="button"
          onClick={loadOfficial}
          className="h-9 rounded-lg border border-border px-3 text-sm font-semibold text-foreground hover:bg-muted"
        >
          Load Velocity Terrace Singapore copy
        </button>
      </div>
      <div className="grid gap-2">
        {guide.pages.map((page, index) => (
          <PageEditor key={page.key} page={page} onChange={(next) => updatePage(index, next)} />
        ))}
      </div>
    </div>
  )
}
