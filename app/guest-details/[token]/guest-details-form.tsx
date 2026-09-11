"use client"

import { useMemo, useRef, useState } from "react"
import Image from "next/image"
import {
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Info,
  Plus,
  Ticket,
  Trash2,
  Upload,
} from "lucide-react"
import { toast, Toaster } from "sonner"
import { LOGO_WHITE } from "@/lib/branding"
import {
  guestDetailsFormCanSubmit,
  type GuestAttendanceMode,
  type GuestFormPerson,
} from "@/lib/guest-details/model"
import type { PublicGuestDetailsForm } from "@/lib/guest-details/public"
import { cn } from "@/lib/utils"

type Props = { initial: PublicGuestDetailsForm }

type LocalPerson = GuestFormPerson & {
  fileName?: string
  fileSize?: number
  previewUrl?: string
}

function clonePeople(people: GuestFormPerson[]): LocalPerson[] {
  return people.map((person) => ({ ...person }))
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function namedCount(people: LocalPerson[]): number {
  return people.filter((person) => person.fullName.trim()).length
}

function headshotUrl(token: string, path: string | null, previewUrl?: string): string | null {
  if (previewUrl) return previewUrl
  if (!path) return null
  return `/api/guest-details/${encodeURIComponent(token)}/headshot?p=${encodeURIComponent(path)}`
}

export function GuestDetailsForm({ initial }: Props) {
  const [form, setForm] = useState(initial)
  const [mode, setMode] = useState<GuestAttendanceMode>(initial.mode)
  const [sameGuests, setSameGuests] = useState<LocalPerson[]>(() => clonePeople(initial.sameGuests))
  const [perDayGuests, setPerDayGuests] = useState<Record<string, LocalPerson[]>>(() =>
    Object.fromEntries(Object.entries(initial.perDayGuests).map(([day, people]) => [day, clonePeople(people)])),
  )
  const [activeDay, setActiveDay] = useState(initial.places[0]?.day ?? "")
  const [pending, setPending] = useState<"save" | "submit" | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(
    initial.submitted ? "Guest details submitted. You can still make changes if needed." : null,
  )

  const dayCount = form.places.length
  const sameListLabel =
    dayCount <= 1 ? "Guest list" : `Guest list (same for all ${dayCount} days)`
  const sameRadioLabel =
    dayCount <= 1 ? "Same guest(s) for this day" : `Same guest(s) for all ${dayCount} days`
  const sameHelp =
    dayCount <= 1
      ? "These guests attend on the event day."
      : `The same guest list will be used for ${form.places.map((place) => place.shortLabel).join(", ").replace(/, ([^,]*)$/, " and $1")}.`
  const perDayHelp = `Enter a separate guest list for each day (${form.places.map((place) => place.shortLabel).join(", ").replace(/, ([^,]*)$/, " and $1")}).`

  const activePeople = mode === "per_day" ? perDayGuests[activeDay] ?? [] : sameGuests
  const canSubmit = guestDetailsFormCanSubmit({
    mode,
    sameGuests,
    perDayGuests,
    days: form.places.map((place) => place.day),
  })

  function setActivePeople(next: LocalPerson[] | ((current: LocalPerson[]) => LocalPerson[])) {
    if (mode === "per_day") {
      setPerDayGuests((current) => {
        const resolved = typeof next === "function" ? next(current[activeDay] ?? []) : next
        return { ...current, [activeDay]: resolved }
      })
      return
    }
    setSameGuests(next)
  }

  function switchMode(next: GuestAttendanceMode) {
    if (next === mode) return
    if (next === "per_day") {
      setPerDayGuests((current) => {
        const nextMap = { ...current }
        form.places.forEach((place, index) => {
          const existing = current[place.day] ?? []
          const hasContent = existing.some((person) => person.fullName.trim() || person.headshotPath || person.id)
          if (hasContent) return
          nextMap[place.day] = sameGuests.map((person) => ({
            ...person,
            id: index === 0 ? person.id : "",
            isLeadGuest: index === 0 && person.isLeadGuest,
          }))
        })
        return nextMap
      })
      setActiveDay(form.places[0]?.day ?? activeDay)
    } else {
      const first = form.places[0]?.day
      const fromDay = (first && perDayGuests[first]?.length ? perDayGuests[first] : sameGuests) ?? sameGuests
      setSameGuests(
        fromDay.map((person, index) => ({
          ...person,
          isLeadGuest: Boolean(person.isLeadGuest) || (index === 0 && !fromDay.some((row) => row.isLeadGuest)),
        })),
      )
    }
    setMode(next)
  }

  function updatePerson(index: number, patch: Partial<LocalPerson>) {
    if (patch.isLeadGuest) {
      setSameGuests((current) =>
        current.map((person, row) => ({
          ...person,
          ...(mode === "same" && row === index ? patch : {}),
          isLeadGuest: mode === "same" && row === index,
        })),
      )
      setPerDayGuests((current) =>
        Object.fromEntries(
          Object.entries(current).map(([day, people]) => [
            day,
            people.map((person, row) => ({
              ...person,
              ...(mode === "per_day" && day === activeDay && row === index ? patch : {}),
              isLeadGuest: mode === "per_day" && day === activeDay && row === index,
            })),
          ]),
        ),
      )
      return
    }
    setActivePeople((current) =>
      current.map((person, row) => (row === index ? { ...person, ...patch } : person)),
    )
  }

  function addPerson() {
    setActivePeople((current) => [
      ...current,
      { id: "", fullName: "", isLeadGuest: false, headshotPath: null },
    ])
  }

  function removePerson(index: number) {
    const apply = (current: LocalPerson[]) => {
      if (current.length <= 1) return current
      return current.filter((_, row) => row !== index)
    }
    if (mode === "per_day") {
      setPerDayGuests((current) => {
        const next = { ...current, [activeDay]: apply(current[activeDay] ?? []) }
        const all = Object.values(next).flat()
        if (all.some((person) => person.isLeadGuest) || !all[0]) return next
        const firstDay = form.places[0]?.day
        if (!firstDay || !next[firstDay]?.[0]) return next
        return {
          ...next,
          [firstDay]: next[firstDay]!.map((person, row) => ({ ...person, isLeadGuest: row === 0 })),
        }
      })
      return
    }
    setSameGuests((current) => {
      const next = apply(current)
      if (!next.some((person) => person.isLeadGuest) && next[0]) {
        next[0] = { ...next[0], isLeadGuest: true }
      }
      return next
    })
  }

  async function uploadHeadshot(index: number, file: File) {
    const body = new FormData()
    body.set("file", file)
    const response = await fetch(`/api/guest-details/${encodeURIComponent(form.token)}/headshot`, {
      method: "POST",
      body,
    })
    const payload = (await response.json().catch(() => ({}))) as { error?: string; path?: string; fileName?: string; size?: number }
    if (!response.ok || !payload.path) {
      throw new Error(payload.error || "Could not upload that photo.")
    }
    updatePerson(index, {
      headshotPath: payload.path,
      fileName: payload.fileName || file.name,
      fileSize: payload.size ?? file.size,
      previewUrl: URL.createObjectURL(file),
    })
  }

  async function persist(submit: boolean) {
    if (submit && !canSubmit.ok) {
      toast.error(canSubmit.message)
      return
    }
    setPending(submit ? "submit" : "save")
    try {
      const response = await fetch(`/api/guest-details/${encodeURIComponent(form.token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submit,
          mode,
          sameGuests,
          perDayGuests,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        message?: string
        form?: PublicGuestDetailsForm
      }
      if (!response.ok || !payload.form) {
        throw new Error(payload.error || "Could not save guest details.")
      }
      setForm(payload.form)
      setMode(payload.form.mode)
      setSameGuests(clonePeople(payload.form.sameGuests))
      setPerDayGuests(
        Object.fromEntries(Object.entries(payload.form.perDayGuests).map(([day, people]) => [day, clonePeople(people)])),
      )
      setSavedMessage(payload.message ?? (submit ? "Guest details submitted. Thank you." : "Progress saved."))
      toast.success(payload.message || "Saved.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save guest details.")
    } finally {
      setPending(null)
    }
  }

  const collapsedPerDayCount = useMemo(
    () => form.places.map((place) => namedCount(perDayGuests[place.day] ?? [])),
    [form.places, perDayGuests],
  )

  return (
    <div className="min-h-screen bg-[#f4f5f7] text-[#202124]">
      <Toaster richColors position="top-center" />
      <header className="bg-[#010101] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3">
          <Image
            src={LOGO_WHITE.src}
            alt="ZK Sports & Entertainment"
            width={168}
            height={42}
            className="h-8 w-auto"
            priority
          />
          <div className="flex items-center gap-4 text-[11px]">
            <span className="font-medium text-white/90">Guest details form</span>
            <span className="text-white/45">Step 1 of 1</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <section className="rounded-2xl border border-[#eceef1] bg-white p-5 shadow-sm sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">Guest Details</h1>
          <p className="mt-1 text-sm text-[#5f636b]">
            Please complete the guest information below for paddock pass creation. Each guest requires a full name and a
            clear headshot.
          </p>

          {savedMessage ? (
            <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {savedMessage}
            </p>
          ) : null}

          <div className="mt-6 grid gap-4 border-y border-[#f0f1f3] py-4 sm:grid-cols-4">
            <Meta icon={Building2} label="Company" value={form.companyName} />
            <Meta icon={CalendarDays} label="Event" value={form.eventLabel} />
            <Meta icon={Ticket} label="Package" value={form.packageName} />
            <Meta icon={CalendarDays} label="Dates" value={form.datesLabel} />
          </div>

          {form.showModePicker ? (
            <div className="mt-6">
              <h2 className="text-base font-semibold">Who is attending?</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {form.allowSameMode ? (
                  <button
                    type="button"
                    onClick={() => switchMode("same")}
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left transition",
                      mode === "same"
                        ? "border-[#F90202] bg-[#fff1f1]"
                        : "border-[#e5e7eb] bg-white hover:border-[#d0d5dd]",
                    )}
                  >
                    <span className="flex items-start gap-3">
                      <span
                        className={cn(
                          "mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border",
                          mode === "same" ? "border-[#F90202]" : "border-[#c4c7cc]",
                        )}
                      >
                        {mode === "same" ? <span className="h-2 w-2 rounded-full bg-[#F90202]" /> : null}
                      </span>
                      <span>
                        <span className="block text-sm font-semibold">{sameRadioLabel}</span>
                        <span className="mt-1 block text-xs text-[#5f636b]">{sameHelp}</span>
                      </span>
                    </span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => switchMode("per_day")}
                  className={cn(
                    "rounded-xl border px-4 py-3 text-left transition",
                    mode === "per_day"
                      ? "border-[#F90202] bg-[#fff1f1]"
                      : "border-[#e5e7eb] bg-white hover:border-[#d0d5dd]",
                    !form.allowSameMode && "md:col-span-2",
                  )}
                >
                  <span className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border",
                        mode === "per_day" ? "border-[#F90202]" : "border-[#c4c7cc]",
                      )}
                    >
                      {mode === "per_day" ? <span className="h-2 w-2 rounded-full bg-[#F90202]" /> : null}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">Different guests on different days</span>
                      <span className="mt-1 block text-xs text-[#5f636b]">{perDayHelp}</span>
                    </span>
                  </span>
                </button>
              </div>
            </div>
          ) : null}

          {mode === "same" || !form.showModePicker ? (
            <GuestListCard
              title={sameListLabel}
              count={namedCount(sameGuests)}
              people={sameGuests}
              token={form.token}
              pending={Boolean(pending)}
              onChange={updatePerson}
              onAdd={addPerson}
              onRemove={removePerson}
              onUpload={uploadHeadshot}
            />
          ) : (
            <div className="mt-5 rounded-xl border border-[#eceef1] bg-[#fafbfc] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Different guests by day</h3>
                  <p className="mt-0.5 text-xs text-[#5f636b]">Enter separate guest lists for each day of the event.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {form.places.map((place) => {
                    const count = namedCount(perDayGuests[place.day] ?? [])
                    const active = place.day === activeDay
                    return (
                      <button
                        key={place.day}
                        type="button"
                        onClick={() => setActiveDay(place.day)}
                        className={cn(
                          "rounded-lg border px-3 py-1.5 text-left text-xs",
                          active ? "border-[#202124] bg-white shadow-sm" : "border-transparent bg-white/70 text-[#5f636b]",
                        )}
                      >
                        <span className="flex items-center gap-1.5 font-semibold">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {place.shortLabel}
                        </span>
                        <span className="mt-0.5 block text-[11px] font-normal text-[#92969e]">
                          {count} {count === 1 ? "guest" : "guests"}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-[#eceef1] bg-white p-4">
                <GuestListFields
                  people={activePeople}
                  token={form.token}
                  pending={Boolean(pending)}
                  onChange={updatePerson}
                  onAdd={addPerson}
                  onRemove={removePerson}
                  onUpload={uploadHeadshot}
                />
              </div>
            </div>
          )}

          {mode === "same" && form.showModePicker ? (
            <button
              type="button"
              onClick={() => switchMode("per_day")}
              className="mt-4 flex w-full items-center justify-between gap-3 rounded-xl border border-[#eceef1] bg-[#fafbfc] px-4 py-3 text-left"
            >
              <span>
                <span className="block text-sm font-semibold">Different guests by day</span>
                <span className="mt-0.5 block text-xs text-[#5f636b]">Enter separate guest lists for each day of the event.</span>
              </span>
              <span className="flex items-center gap-3 text-[11px] text-[#5f636b]">
                {form.places.map((place, index) => (
                  <span key={place.day} className="hidden sm:flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {place.shortLabel}
                    <span className="text-[#92969e]">{collapsedPerDayCount[index] ?? 0} guests</span>
                  </span>
                ))}
                <ChevronDown className="h-4 w-4" />
              </span>
            </button>
          ) : null}

          <div className="mt-6 flex flex-col gap-3 border-t border-[#f0f1f3] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-xs text-[#5f636b]">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#92969e]" />
              Please ensure the guest name matches their ID and the photo is clear and recent. Tick one person as the
              lead guest if you want to submit before every name is ready.
            </p>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={Boolean(pending)}
                onClick={() => void persist(false)}
                className="h-10 rounded-lg border border-[#d0d5dd] bg-white px-4 text-sm font-semibold disabled:opacity-50"
              >
                {pending === "save" ? "Saving…" : "Save and finish later"}
              </button>
              <button
                type="button"
                disabled={Boolean(pending)}
                onClick={() => void persist(true)}
                className="h-10 rounded-lg bg-[#F90202] px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pending === "submit" ? "Submitting…" : "Submit guest details"}
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function Meta({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 text-[#92969e]" />
      <div>
        <p className="text-[11px] font-medium text-[#92969e]">{label}</p>
        <p className="text-sm font-semibold">{value}</p>
      </div>
    </div>
  )
}

function GuestListCard({
  title,
  count,
  people,
  token,
  pending,
  onChange,
  onAdd,
  onRemove,
  onUpload,
}: {
  title: string
  count: number
  people: LocalPerson[]
  token: string
  pending: boolean
  onChange: (index: number, patch: Partial<LocalPerson>) => void
  onAdd: () => void
  onRemove: (index: number) => void
  onUpload: (index: number, file: File) => Promise<void>
}) {
  return (
    <div className="mt-5 rounded-xl border border-[#eceef1] bg-[#fafbfc] p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-[#92969e]">
          {count} {count === 1 ? "guest" : "guests"} added
        </p>
      </div>
      <GuestListFields
        people={people}
        token={token}
        pending={pending}
        onChange={onChange}
        onAdd={onAdd}
        onRemove={onRemove}
        onUpload={onUpload}
      />
    </div>
  )
}

function GuestListFields({
  people,
  token,
  pending,
  onChange,
  onAdd,
  onRemove,
  onUpload,
}: {
  people: LocalPerson[]
  token: string
  pending: boolean
  onChange: (index: number, patch: Partial<LocalPerson>) => void
  onAdd: () => void
  onRemove: (index: number) => void
  onUpload: (index: number, file: File) => Promise<void>
}) {
  return (
    <div className="space-y-3">
      {people.map((person, index) => (
        <GuestRow
          key={`${person.id || "new"}-${index}`}
          index={index}
          person={person}
          token={token}
          pending={pending}
          canRemove={people.length > 1}
          onChange={onChange}
          onRemove={onRemove}
          onUpload={onUpload}
        />
      ))}
      <button
        type="button"
        disabled={pending}
        onClick={onAdd}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#F90202]/50 text-sm font-semibold text-[#F90202] hover:bg-[#fff1f1] disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        Add another guest
      </button>
    </div>
  )
}

function GuestRow({
  index,
  person,
  token,
  pending,
  canRemove,
  onChange,
  onRemove,
  onUpload,
}: {
  index: number
  person: LocalPerson
  token: string
  pending: boolean
  canRemove: boolean
  onChange: (index: number, patch: Partial<LocalPerson>) => void
  onRemove: (index: number) => void
  onUpload: (index: number, file: File) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const photo = headshotUrl(token, person.headshotPath, person.previewUrl)

  async function onFile(file: File | undefined) {
    if (!file) return
    setUploading(true)
    try {
      await onUpload(index, file)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload that photo.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="grid gap-4 rounded-xl border border-[#eceef1] bg-white px-4 py-3 sm:grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)_2rem] sm:items-center">
      <div>
        <p className="text-sm font-semibold">Guest {index + 1}</p>
        <label className="mt-1 flex items-center gap-1.5 text-[11px] text-[#5f636b]">
          <input
            type="checkbox"
            checked={person.isLeadGuest}
            disabled={pending}
            onChange={() => onChange(index, { isLeadGuest: true })}
          />
          Lead guest
        </label>
      </div>
      <label className="block">
        <span className="text-[11px] font-medium text-[#5f636b]">
          Full name <span className="text-[#F90202]">*</span>
        </span>
        <input
          value={person.fullName}
          disabled={pending}
          onChange={(event) => onChange(index, { fullName: event.target.value })}
          className="mt-1 h-10 w-full rounded-lg border border-[#e5e7eb] px-3 text-sm outline-none focus:border-[#202124]"
        />
      </label>
      <div>
        <p className="text-[11px] font-medium text-[#5f636b]">
          Headshot <span className="text-[#F90202]">*</span>
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
          className="hidden"
          onChange={(event) => void onFile(event.target.files?.[0])}
        />
        {photo ? (
          <div className="mt-1 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="" className="h-11 w-11 rounded-full object-cover" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{person.fileName || "Headshot uploaded"}</p>
              <p className="text-[11px] text-[#92969e]">
                {person.fileSize ? formatSize(person.fileSize) : "JPG or PNG"}
              </p>
            </div>
            <Check className="h-4 w-4 text-emerald-500" />
            <button
              type="button"
              disabled={pending || uploading}
              onClick={() => inputRef.current?.click()}
              className="text-[11px] font-semibold text-[#5f636b] hover:underline"
            >
              Replace
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={pending || uploading}
            onClick={() => inputRef.current?.click()}
            className="mt-1 flex h-14 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#d0d5dd] text-xs text-[#5f636b] hover:bg-[#fafbfc] disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {uploading ? "Uploading…" : "Upload headshot JPG or PNG"}
          </button>
        )}
      </div>
      <button
        type="button"
        disabled={pending || !canRemove}
        onClick={() => onRemove(index)}
        className="justify-self-end text-[#c4c7cc] hover:text-[#F90202] disabled:opacity-30"
        aria-label={`Remove guest ${index + 1}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}
