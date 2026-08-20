"use client"

import { useState } from "react"
import { Plus, X } from "lucide-react"
import type { OperationsGuest } from "@/lib/admin/workflow-views"

export type GuestDraft = {
  key: string
  id?: string
  fullName: string
  email: string
  phone: string
  nationality: string
  dateOfBirth: string
  dietaryRequirements: string
  specialRequests: string
  isLeadGuest: boolean
}

function emptyDraft(isLeadGuest = false): GuestDraft {
  return {
    key: `new-${Math.random().toString(36).slice(2, 10)}`,
    fullName: "",
    email: "",
    phone: "",
    nationality: "",
    dateOfBirth: "",
    dietaryRequirements: "",
    specialRequests: "",
    isLeadGuest,
  }
}

function fromExisting(guest: OperationsGuest): GuestDraft {
  return {
    key: guest.id,
    id: guest.id,
    fullName: guest.fullName ?? "",
    email: guest.email ?? "",
    phone: guest.phone ?? "",
    nationality: guest.nationality ?? "",
    dateOfBirth: guest.dateOfBirth?.slice(0, 10) ?? "",
    dietaryRequirements: guest.dietaryRequirements ?? "",
    specialRequests: guest.specialRequests ?? "",
    isLeadGuest: guest.isLeadGuest,
  }
}

export function buildGuestDrafts(existing: OperationsGuest[], expectedCount: number): GuestDraft[] {
  const rows = [...existing]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(fromExisting)
  const target = Math.max(1, expectedCount || 1, rows.length)
  while (rows.length < target) {
    rows.push(emptyDraft(rows.length === 0))
  }
  if (!rows.some((row) => row.isLeadGuest) && rows.length) {
    rows[0] = { ...rows[0], isLeadGuest: true }
  }
  return rows
}

export function OperationsGuestEditor({
  title,
  subtitle,
  expectedCount,
  existing,
  pending,
  onClose,
  onSave,
  onDelete,
}: {
  title: string
  subtitle: string
  expectedCount: number
  existing: OperationsGuest[]
  pending: boolean
  onClose: () => void
  onSave: (guests: GuestDraft[]) => void
  onDelete: (guestId: string) => void
}) {
  const [drafts, setDrafts] = useState(() => buildGuestDrafts(existing, expectedCount))

  function update(key: string, patch: Partial<GuestDraft>) {
    setDrafts((current) =>
      current.map((row) => {
        if (row.key !== key) {
          return patch.isLeadGuest ? { ...row, isLeadGuest: false } : row
        }
        return { ...row, ...patch }
      }),
    )
  }

  const namedCount = drafts.filter((row) => row.fullName.trim()).length
  const needed = Math.max(0, expectedCount - namedCount)

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4">
      <div className="flex max-h-[92dvh] w-full max-w-3xl min-h-0 flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="mt-0.5 text-[9px] text-slate-400">{subtitle}</p>
            <p className="mt-1 text-[10px] text-slate-500">
              {namedCount}/{expectedCount || namedCount || 1} names entered
              {needed > 0 ? ` · ${needed} still to add` : ""}. Fill every guest below, then save once.
            </p>
          </div>
          <button type="button" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {drafts.map((draft, index) => (
            <div key={draft.key} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold text-slate-600">Guest {index + 1}</p>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[9px] font-medium">
                    <input
                      type="radio"
                      name="lead-guest"
                      checked={draft.isLeadGuest}
                      onChange={() => update(draft.key, { isLeadGuest: true })}
                    />
                    Lead guest
                  </label>
                  {draft.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm("Remove this guest?")) return
                        onDelete(draft.id!)
                        setDrafts((current) => current.filter((row) => row.key !== draft.key))
                      }}
                      className="text-[9px] font-semibold text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  ) : drafts.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setDrafts((current) => current.filter((row) => row.key !== draft.key))}
                      className="text-[9px] font-semibold text-slate-400 hover:underline"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
              <input
                value={draft.fullName}
                onChange={(event) => update(draft.key, { fullName: event.target.value })}
                placeholder="Full name"
                className="h-9 w-full rounded-md border px-3 text-[10px]"
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  type="email"
                  value={draft.email}
                  onChange={(event) => update(draft.key, { email: event.target.value })}
                  placeholder="Email"
                  className="h-9 rounded-md border px-3 text-[10px]"
                />
                <input
                  value={draft.phone}
                  onChange={(event) => update(draft.key, { phone: event.target.value })}
                  placeholder="Phone"
                  className="h-9 rounded-md border px-3 text-[10px]"
                />
                <input
                  value={draft.nationality}
                  onChange={(event) => update(draft.key, { nationality: event.target.value })}
                  placeholder="Nationality"
                  className="h-9 rounded-md border px-3 text-[10px]"
                />
                <input
                  type="date"
                  value={draft.dateOfBirth}
                  onChange={(event) => update(draft.key, { dateOfBirth: event.target.value })}
                  className="h-9 rounded-md border px-3 text-[10px]"
                />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  value={draft.dietaryRequirements}
                  onChange={(event) => update(draft.key, { dietaryRequirements: event.target.value })}
                  placeholder="Dietary requirements"
                  className="h-9 rounded-md border px-3 text-[10px]"
                />
                <input
                  value={draft.specialRequests}
                  onChange={(event) => update(draft.key, { specialRequests: event.target.value })}
                  placeholder="Special requests"
                  className="h-9 rounded-md border px-3 text-[10px]"
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDrafts((current) => [...current, emptyDraft()])}
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"
          >
            <Plus className="h-3.5 w-3.5" />
            Add another guest
          </button>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t px-5 py-4">
          <button type="button" onClick={onClose} className="h-9 rounded-md border px-4 text-[10px] font-semibold">
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onSave(drafts)}
            className="h-9 rounded-md bg-primary px-5 text-[10px] font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : namedCount > 1 ? `Save ${namedCount} guests` : "Save guests"}
          </button>
        </div>
      </div>
    </div>
  )
}
